import type { PrismaService } from '../../prisma/prisma.service';
import {
  BOT_CONTEXT_MAX_INJECTED_CHARS,
  BotContextService,
} from './bot-context.service';

describe('BotContextService (retrieval + administration)', () => {
  const documents = [
    {
      id: 'doc-brushing',
      kind: 'BIBLE',
      title: 'Brushing Guide',
      content:
        'Brush twice daily with a soft bristle toothbrush and fluoride toothpaste. ' +
        'Replace the brush head every three months.',
      active: true,
      source: 'MANUAL',
      externalId: null,
      externalUrl: null,
      lastSyncedAt: null,
      version: 1,
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
    },
    {
      id: 'doc-insurance',
      kind: 'BIBLE',
      title: 'Membership Tiers',
      content:
        'The Gold membership tier includes orthodontic coverage and family add-ons.',
      active: true,
      source: 'MANUAL',
      externalId: null,
      externalUrl: null,
      lastSyncedAt: null,
      version: 1,
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
    },
    {
      id: 'doc-other-kind',
      kind: 'ETHICS',
      title: 'Escalation Boundaries',
      content: 'Escalation guide content stored under a different kind.',
      active: true,
      source: 'MANUAL',
      externalId: null,
      externalUrl: null,
      lastSyncedAt: null,
      version: 1,
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
    },
    {
      id: 'doc-inactive',
      kind: 'BIBLE',
      title: 'Archived Guide',
      content: 'Archived content about toothbrush replacement schedules.',
      active: false,
      source: 'MANUAL',
      externalId: null,
      externalUrl: null,
      lastSyncedAt: null,
      version: 1,
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
    },
  ];

  const findMany = jest.fn(
    ({ where }: { where: { kind?: string; active?: boolean } }) =>
      Promise.resolve(
        documents.filter(
          (doc) =>
            (where.kind === undefined || doc.kind === where.kind) &&
            (where.active === undefined || doc.active === where.active),
        ),
      ),
  );

  const prisma = {
    botContextDocument: {
      findMany,
      findUnique: jest.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(documents.find((d) => d.id === where.id) ?? null),
      ),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({
          id: 'created',
          ...data,
          active: true,
          source: 'MANUAL',
          version: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      ),
      update: jest.fn(
        ({
          where,
          data,
        }: {
          where: { id: string };
          data: Record<string, unknown>;
        }) =>
          Promise.resolve({
            id: where.id,
            kind: 'BIBLE',
            title: null,
            content: '',
            active: true,
            source: 'MANUAL',
            externalId: null,
            externalUrl: null,
            lastSyncedAt: null,
            version: 2,
            createdAt: new Date(),
            updatedAt: new Date(),
            ...data,
          }),
      ),
      delete: jest.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(
          documents.find((d) => d.id === where.id) ?? { id: where.id },
        ),
      ),
    },
  } as unknown as PrismaService;

  const svc = new BotContextService(prisma);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('retrieval', () => {
    it('returns the most relevant document for a matching query', async () => {
      const results = await svc.retrieve('when should I replace my toothbrush');
      expect(results).toHaveLength(1);
      expect(results[0].documentId).toBe('doc-brushing');
      expect(results[0].score).toBeGreaterThan(0);
    });

    it('does not match a query with no relevant terms', async () => {
      const results = await svc.retrieve(
        'what is the weather in Mombasa tomorrow',
      );
      expect(results).toHaveLength(0);
    });

    it('ignores stopwords when scoring', async () => {
      const results = await svc.retrieve('and the for with');
      expect(results).toHaveLength(0);
    });

    it('skips inactive documents', async () => {
      const results = await svc.retrieve(
        'archived toothbrush replacement schedules',
      );
      expect(results.map((r) => r.documentId)).not.toContain('doc-inactive');
    });

    it('only retrieves documents of the requested kind', async () => {
      const results = await svc.retrieve('escalation guide content', 'ETHICS');
      expect(results.map((r) => r.documentId)).toEqual(['doc-other-kind']);
    });

    it('searches every kind by default', async () => {
      const results = await svc.retrieve('escalation guide content');
      expect(results.map((r) => r.documentId)).toContain('doc-other-kind');
      expect(results.map((r) => r.kind)).toContain('ETHICS');
    });

    it('caps results at the requested top-K', async () => {
      const results = await svc.retrieve(
        'brushing toothbrush membership gold',
        'BIBLE',
        1,
      );
      expect(results.length).toBeLessThanOrEqual(1);
    });
  });

  describe('caching', () => {
    it('reads the documents once and serves later queries from cache', async () => {
      await svc.retrieve('replace my toothbrush');
      const callsAfterFirst = findMany.mock.calls.length;
      await svc.retrieve('membership tiers');
      expect(findMany.mock.calls.length).toBe(callsAfterFirst);
    });

    it('re-reads the documents after a write invalidates the cache', async () => {
      await svc.retrieve('replace my toothbrush');
      const before = findMany.mock.calls.length;
      await svc.create({ content: 'A new guide', title: 'New' });
      await svc.retrieve('replace my toothbrush');
      expect(findMany.mock.calls.length).toBe(before + 1);
    });
  });

  describe('prompt budget', () => {
    it('caps the injected context so the prompt cannot balloon', () => {
      const big = 'x'.repeat(5_000);
      const block = svc.renderPromptBlock([
        {
          documentId: 'a',
          kind: 'BIBLE',
          title: 'First',
          content: big,
          score: 1,
        },
        {
          documentId: 'b',
          kind: 'BIBLE',
          title: 'Second',
          content: big,
          score: 0.9,
        },
        {
          documentId: 'c',
          kind: 'BIBLE',
          title: 'Third',
          content: big,
          score: 0.8,
        },
      ]);
      expect(block.length).toBeLessThanOrEqual(BOT_CONTEXT_MAX_INJECTED_CHARS);
      expect(block).toContain('### First');
      expect(block).toContain('### Second');
      expect(block).not.toContain('### Third');
    });

    it('renders nothing when there is no context', () => {
      expect(svc.renderPromptBlock([])).toBe('');
    });
  });

  describe('section splitting', () => {
    it('splits a guide on markdown headings', () => {
      const sections = svc.splitIntoSections(
        '# Ethics\nFirst rule.\n\n## Escalation\nSecond rule.\n\n## Referral\nThird rule.',
        'Guide',
      );
      expect(sections.map((s) => s.title)).toEqual([
        'Ethics',
        'Escalation',
        'Referral',
      ]);
      expect(sections[1].content).toContain('Second rule.');
    });

    it('keeps short sections separate so their heading survives', () => {
      const sections = svc.splitIntoSections(
        '# Ethics\n' + 'a'.repeat(200) + '\n\n## Tiny\nshort',
        'Guide',
      );
      expect(sections.map((s) => s.title)).toEqual(['Ethics', 'Tiny']);
    });

    it('falls back to paragraph chunks when there are no headings', () => {
      const paragraphs = Array.from(
        { length: 12 },
        (_, i) => `Paragraph ${i} ${'word '.repeat(60)}`,
      ).join('\n\n');
      const sections = svc.splitIntoSections(paragraphs, 'Guide');
      expect(sections.length).toBeGreaterThan(1);
      expect(sections[0].title).toContain('Guide');
    });
  });
});
