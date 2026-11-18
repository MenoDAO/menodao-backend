import type { PrismaService } from '../../prisma/prisma.service';
import {
  BRAND_CONTEXT_MAX_INJECTED_CHARS,
  BrandContextService,
} from './brand-context.service';

describe('BrandContextService (retrieval + administration)', () => {
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
    brandContextDocumentVersion: {
      create: jest.fn(() => Promise.resolve({})),
      count: jest.fn(() => Promise.resolve(0)),
      findMany: jest.fn(() => Promise.resolve([])),
      deleteMany: jest.fn(() => Promise.resolve({ count: 0 })),
    },
  } as unknown as PrismaService;

  const svc = new BrandContextService(prisma);

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
      expect(block.length).toBeLessThanOrEqual(
        BRAND_CONTEXT_MAX_INJECTED_CHARS,
      );
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

  describe('versioning and import upsert', () => {
    interface StoredDoc {
      id: string;
      kind: string;
      title: string | null;
      content: string;
      contentHash: string | null;
      active: boolean;
      source: string;
      externalId: string | null;
      externalUrl: string | null;
      sectionKey: string | null;
      externalRevision: string | null;
      sourceModifiedAt: Date | null;
      lastSyncedAt: Date | null;
      version: number;
      createdAt: Date;
      updatedAt: Date;
    }

    let docs: StoredDoc[];
    let versions: Array<Record<string, unknown>>;
    let seq: number;

    interface DocWhere {
      id?: string;
      source?: string;
      externalId?: string | null;
      active?: boolean;
      sectionKey?: { notIn: Array<string | null> };
      source_externalId_sectionKey?: {
        source: string;
        externalId: string;
        sectionKey: string;
      };
    }

    interface VersionWhere {
      documentId?: string;
      documentId_version?: { documentId: string; version: number };
    }

    const applyData = (doc: StoredDoc, data: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(data)) {
        if (
          value &&
          typeof value === 'object' &&
          'increment' in (value as Record<string, unknown>)
        ) {
          (doc as unknown as Record<string, number>)[key] =
            ((doc as unknown as Record<string, number>)[key] ?? 0) +
            (value as { increment: number }).increment;
        } else {
          (doc as unknown as Record<string, unknown>)[key] = value;
        }
      }
      doc.updatedAt = new Date();
    };

    const versionedPrisma = {
      botContextDocument: {
        create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
          const doc: StoredDoc = {
            id: `doc-${++seq}`,
            kind: 'BIBLE',
            title: null,
            content: '',
            contentHash: null,
            active: true,
            source: 'MANUAL',
            externalId: null,
            externalUrl: null,
            sectionKey: null,
            externalRevision: null,
            sourceModifiedAt: null,
            lastSyncedAt: null,
            version: 1,
            createdAt: new Date(),
            updatedAt: new Date(),
            ...(data as unknown as Partial<StoredDoc>),
          } as StoredDoc;
          docs.push(doc);
          return Promise.resolve(doc);
        }),
        findUnique: jest.fn(({ where }: { where: DocWhere }) =>
          Promise.resolve(
            docs.find((doc) => {
              if (where.id) return doc.id === where.id;
              const key = where.source_externalId_sectionKey;
              if (!key) return false;
              return (
                doc.source === key.source &&
                doc.externalId === key.externalId &&
                doc.sectionKey === key.sectionKey
              );
            }) ?? null,
          ),
        ),
        findMany: jest.fn(({ where }: { where: DocWhere }) =>
          Promise.resolve(
            docs.filter((doc) => {
              if (where.source !== undefined && doc.source !== where.source) {
                return false;
              }
              if (
                where.externalId !== undefined &&
                doc.externalId !== where.externalId
              ) {
                return false;
              }
              if (where.active !== undefined && doc.active !== where.active) {
                return false;
              }
              if (where.sectionKey?.notIn) {
                return !where.sectionKey.notIn.includes(doc.sectionKey);
              }
              return true;
            }),
          ),
        ),
        update: jest.fn(
          ({
            where,
            data,
          }: {
            where: { id: string };
            data: Record<string, unknown>;
          }) => {
            const doc = docs.find((entry) => entry.id === where.id);
            if (!doc) return Promise.reject(new Error('not found'));
            applyData(doc, data);
            return Promise.resolve(doc);
          },
        ),
        delete: jest.fn(),
      },
      brandContextDocumentVersion: {
        create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
          versions.push(data);
          return Promise.resolve(data);
        }),
        findMany: jest.fn(
          ({
            where,
            orderBy,
          }: {
            where: VersionWhere;
            orderBy?: { version?: 'asc' | 'desc' };
          }) => {
            const rows = versions.filter(
              (entry) => entry.documentId === where.documentId,
            );
            if (orderBy?.version === 'desc') {
              rows.sort((a, b) => Number(b.version) - Number(a.version));
            }
            return Promise.resolve(rows);
          },
        ),
        findUnique: jest.fn(({ where }: { where: VersionWhere }) => {
          const key = where.documentId_version;
          if (!key) return Promise.resolve(null);
          return Promise.resolve(
            versions.find(
              (entry) =>
                entry.documentId === key.documentId &&
                entry.version === key.version,
            ) ?? null,
          );
        }),
        count: jest.fn(({ where }: { where: VersionWhere }) =>
          Promise.resolve(
            versions.filter((entry) => entry.documentId === where.documentId)
              .length,
          ),
        ),
        deleteMany: jest.fn(() => Promise.resolve({ count: 0 })),
      },
    } as unknown as PrismaService;

    const versionedSvc = new BrandContextService(versionedPrisma);

    beforeEach(() => {
      docs = [];
      versions = [];
      seq = 0;
      jest.clearAllMocks();
    });

    it('snapshots a created document with its content hash', async () => {
      const doc = await versionedSvc.create({ content: 'Be kind.' });

      expect(doc.version).toBe(1);
      expect(doc.contentHash).toMatch(/^[a-f0-9]{64}$/);
      expect(versions).toHaveLength(1);
      expect(versions[0]).toMatchObject({
        documentId: doc.id,
        version: 1,
        changeType: 'CREATE',
      });
    });

    it('does not bump the version when the content is unchanged', async () => {
      const doc = await versionedSvc.create({ content: 'Be kind.' });
      const updated = await versionedSvc.update(doc.id, {
        content: 'Be kind.',
      });

      expect(updated.version).toBe(1);
      expect(versions).toHaveLength(1);
    });

    it('bumps the version and snapshots a real content change', async () => {
      const doc = await versionedSvc.create({ content: 'Be kind.' });
      const updated = await versionedSvc.update(doc.id, {
        content: 'Be very kind.',
      });

      expect(updated.version).toBe(2);
      expect(versions).toHaveLength(2);
      expect(versions[1]).toMatchObject({
        documentId: doc.id,
        version: 2,
        changeType: 'UPDATE',
      });
    });

    it('re-importing the same guide upserts instead of duplicating', async () => {
      const guide = '# Ethics\nFirst rule.\n\n## Escalation\nSecond rule.';

      const first = await versionedSvc.importSections({
        kind: 'ETHICS',
        title: 'Guide',
        content: guide,
      });
      const second = await versionedSvc.importSections({
        kind: 'ETHICS',
        title: 'Guide',
        content: guide,
      });

      expect(first.created).toBe(2);
      expect(second.created).toBe(0);
      expect(second.updated).toBe(0);
      expect(docs).toHaveLength(2);
      expect(docs.every((doc) => doc.sectionKey)).toBe(true);
    });

    it('updates changed sections and soft-deactivates removed ones', async () => {
      const first = await versionedSvc.importSections({
        kind: 'ETHICS',
        title: 'Guide',
        content: '# Ethics\nFirst rule.\n\n## Escalation\nSecond rule.',
      });
      const ethics = first.documents.find((doc) => doc.title === 'Ethics');

      const second = await versionedSvc.importSections({
        kind: 'ETHICS',
        title: 'Guide',
        content: '# Ethics\nFirst rule, clarified.',
      });

      expect(second.updated).toBe(1);
      expect(second.deactivated).toBe(1);
      const stored = docs.find((doc) => doc.id === ethics?.id);
      expect(stored?.content).toContain('clarified');
      expect(stored?.version).toBe(2);
      expect(docs.find((doc) => doc.title === 'Escalation')?.active).toBe(
        false,
      );
    });

    it('restores a version as a new, append-only version', async () => {
      const doc = await versionedSvc.create({ content: 'Version one.' });
      await versionedSvc.update(doc.id, { content: 'Version two.' });

      const restored = await versionedSvc.restoreVersion(doc.id, 1);

      expect(restored.content).toBe('Version one.');
      expect(restored.version).toBe(3);
      expect(
        versions.some(
          (entry) => entry.changeType === 'ROLLBACK' && entry.version === 3,
        ),
      ).toBe(true);
    });
  });
});
