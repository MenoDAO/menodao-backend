import type { PrismaService } from '../../prisma/prisma.service';
import { BotContextService } from './bot-context.service';

describe('BotContextService (retrieval)', () => {
  const documents = [
    {
      id: 'doc-brushing',
      kind: 'BIBLE',
      title: 'Brushing Guide',
      content:
        'Brush twice daily with a soft bristle toothbrush and fluoride toothpaste. ' +
        'Replace the brush head every three months.',
      active: true,
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
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
    },
    {
      id: 'doc-other-kind',
      kind: 'TEST',
      title: 'Brushing Guide (other kind)',
      content: 'Brushing guide content stored under a different kind.',
      active: true,
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
    },
    {
      id: 'doc-inactive',
      kind: 'BIBLE',
      title: 'Archived Guide',
      content: 'Archived content about toothbrush replacement schedules.',
      active: false,
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
    },
  ];

  const prisma = {
    botContextDocument: {
      findMany: jest.fn(
        ({ where }: { where: { kind: string; active?: boolean } }) =>
          Promise.resolve(
            documents.filter(
              (doc) =>
                doc.kind === where.kind &&
                (where.active === undefined || doc.active === where.active),
            ),
          ),
      ),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({
          id: 'created',
          ...data,
          active: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      ),
      delete: jest.fn(({ where }: { where: { id: string } }) => {
        const doc = documents.find((d) => d.id === where.id);
        if (!doc) throw new Error('not found');
        return Promise.resolve(doc);
      }),
    },
  } as unknown as PrismaService;

  const svc = new BotContextService(prisma);

  beforeEach(() => {
    jest.clearAllMocks();
  });

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
    const results = await svc.retrieve('brushing guide content', 'TEST');
    expect(results.map((r) => r.documentId)).toEqual(['doc-other-kind']);
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
