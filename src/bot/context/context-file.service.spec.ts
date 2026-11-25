import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import AdmZip from 'adm-zip';
import type { PrismaService } from '../../prisma/prisma.service';
import { BrandContextService } from './brand-context.service';
import { ContextFileExtractService } from './context-file-extract.service';
import { ContextFileService } from './context-file.service';
import { ContextFileStorageService } from './context-file-storage.service';

/**
 * Real extraction and real sectioning; only the two boundaries that talk to
 * the outside world (S3 and Postgres) are faked. That keeps the ordering and
 * unwind guarantees under test — the parts most likely to rot silently.
 */
describe('ContextFileService (upload ingest)', () => {
  let prisma: {
    botContextFile: {
      create: jest.Mock<Promise<unknown>, [{ data: Record<string, unknown> }]>;
      delete: jest.Mock<Promise<unknown>, [{ where: { id: string } }]>;
      findFirst: jest.Mock<Promise<unknown>, [unknown]>;
      findUnique: jest.Mock<Promise<unknown>, [unknown]>;
    };
    botContextDocument: {
      findUnique: jest.Mock<Promise<unknown>, []>;
      create: jest.Mock<Promise<unknown>, [{ data: Record<string, unknown> }]>;
      update: jest.Mock<
        Promise<unknown>,
        [{ where: { id: string }; data: Record<string, unknown> }]
      >;
      findMany: jest.Mock<Promise<unknown>, [unknown]>;
    };
    brandContextDocumentVersion: {
      create: jest.Mock<Promise<unknown>, [unknown]>;
      count: jest.Mock<Promise<number>, []>;
    };
  };
  let storage: ContextFileStorageService;
  let putRaw: jest.Mock<Promise<void>, [string, Buffer, string]>;
  let putText: jest.Mock<Promise<void>, [string, string]>;
  let remove: jest.Mock<Promise<void>, [...string[]]>;
  let svc: ContextFileService;

  /** Every document row written during a test, in order. */
  let createdDocuments: Array<Record<string, unknown>>;

  beforeEach(() => {
    createdDocuments = [];

    prisma = {
      botContextFile: {
        create: jest.fn(({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ id: 'file-1', ...data }),
        ),
        delete: jest.fn(({ where }: { where: { id: string } }) =>
          Promise.resolve({ id: where.id }),
        ),
        findFirst: jest.fn<Promise<unknown>, [unknown]>(() =>
          Promise.resolve(null),
        ),
        findUnique: jest.fn<Promise<unknown>, [unknown]>(() =>
          Promise.resolve(null),
        ),
      },
      botContextDocument: {
        findUnique: jest.fn(() => Promise.resolve(null)),
        create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
          createdDocuments.push(data);
          return Promise.resolve({
            id: `doc-${createdDocuments.length}`,
            ...data,
          });
        }),
        update: jest.fn(
          ({
            where,
            data,
          }: {
            where: { id: string };
            data: Record<string, unknown>;
          }) => Promise.resolve({ id: where.id, ...data }),
        ),
        findMany: jest.fn<Promise<unknown>, [unknown]>(() =>
          Promise.resolve([]),
        ),
      },
      brandContextDocumentVersion: {
        create: jest.fn<Promise<unknown>, [unknown]>(() => Promise.resolve({})),
        count: jest.fn<Promise<number>, []>(() => Promise.resolve(0)),
      },
    };

    const fakeConfig = {
      get: (key: string) =>
        key === 'BRAND_CONTEXT_S3_BUCKET' ? 'test-bucket' : undefined,
    } as unknown as ConfigService;

    storage = new ContextFileStorageService(fakeConfig);
    putRaw = jest.fn<Promise<void>, [string, Buffer, string]>();
    putRaw.mockResolvedValue(undefined);
    putText = jest.fn<Promise<void>, [string, string]>();
    putText.mockResolvedValue(undefined);
    remove = jest.fn<Promise<void>, [...string[]]>();
    remove.mockResolvedValue(undefined);
    // The service reaches S3 through the instance, so the fakes have to live on
    // it rather than on local variables.
    storage.putRaw = putRaw;
    storage.putText = putText;
    storage.remove = remove;

    svc = new ContextFileService(
      prisma as unknown as PrismaService,
      storage,
      new ContextFileExtractService(),
      new BrandContextService(prisma as unknown as PrismaService),
    );
  });

  const ingest = (filename: string, content: string | Buffer) =>
    svc.ingest({
      filename,
      contentType: 'application/octet-stream',
      buffer: Buffer.isBuffer(content) ? content : Buffer.from(content),
      actorAdminId: 'admin-1',
    });

  describe('happy path', () => {
    it('stores the raw bytes and the extracted text, then imports sections', async () => {
      const markdown = '# Voice\n\nWarm and plain, never clinical.';
      const result = await ingest('guide.md', markdown);

      expect(putRaw).toHaveBeenCalledTimes(1);
      const [rawKey, rawBody] = putRaw.mock.calls[0];
      expect(rawKey).toMatch(/^raw\/[0-9a-f]{64}\/guide\.md$/);
      expect(Buffer.from(rawBody).toString('utf8')).toBe(markdown);

      expect(putText).toHaveBeenCalledTimes(1);
      const [textKey, textBody] = putText.mock.calls[0];
      expect(textKey).toMatch(/^text\/[0-9a-f]{64}\/guide\.md\.md$/);
      expect(textBody).toBe(markdown);

      expect(result.sections).toBe(1);
      expect(result.created).toBe(1);
      expect(result.updated).toBe(0);
      expect(result.deactivated).toBe(0);
      expect(result.skipped).toEqual([]);
      expect(result.fileId).toBe('file-1');
    });

    it('records the upload with a stable filename-keyed identity', async () => {
      await ingest('Fees.md', 'Prices are published on the site.');

      const row = prisma.botContextFile.create.mock.calls[0][0].data;
      expect(row.filename).toBe('Fees.md');
      expect(row.status).toBe('EXTRACTED');
      expect(row.byteSize).toBe(
        Buffer.byteLength('Prices are published on the site.'),
      );
      expect(row.sha256).toHaveLength(64);
      expect(row.storageKey).toMatch(/^raw\//);
      expect(row.textStorageKey).toMatch(/^text\//);
      expect(row.extractedAt).toBeInstanceOf(Date);
      expect(row.uploadedByAdminId).toBe('admin-1');
      // Title is a fallback only — derived, not demanded of the admin.
      expect(row.title).toBeNull();
    });

    it('marks every produced section as an upload traceable to its file', async () => {
      await ingest('guide.md', '# Voice\n\nWarm.\n\n# Fees\n\nPublished.');

      expect(createdDocuments).toHaveLength(2);
      for (const doc of createdDocuments) {
        expect(doc.source).toBe('UPLOAD');
        expect(doc.fileId).toBe('file-1');
        expect(doc.active).toBe(true);
      }
      expect(createdDocuments.map((d) => d.title)).toEqual(['Voice', 'Fees']);
      // Filename-keyed: re-uploading the same name replaces rather than duplicates.
      expect(createdDocuments[0].externalId).toBe('upload:guide.md');
    });

    it('uses the same externalId for every re-upload of a filename', async () => {
      await ingest('guide.md', '# One\n\nFirst version.');
      await ingest('guide.md', '# One\n\nSecond version.');

      const externalIds = createdDocuments.map((d) => d.externalId);
      expect(externalIds).toEqual(['upload:guide.md', 'upload:guide.md']);
      // Two rows in the file table: one per physical upload.
      expect(prisma.botContextFile.create).toHaveBeenCalledTimes(2);
    });

    it('derives the fallback title from the filename when content has no headings', async () => {
      await ingest('q3-pricing_guide.md', 'Fees are payable before treatment.');

      expect(createdDocuments[0].title).toBe('Q3 Pricing Guide');
    });

    it('honours the kind and active flag passed through', async () => {
      await svc.ingest({
        filename: 'policy.md',
        contentType: 'text/markdown',
        buffer: Buffer.from('# Refunds\n\nWithin 14 days.'),
        kind: 'POLICY',
        active: false,
      });

      expect(prisma.botContextFile.create.mock.calls[0][0].data.kind).toBe(
        'POLICY',
      );
      expect(createdDocuments[0].kind).toBe('POLICY');
      expect(createdDocuments[0].active).toBe(false);
    });
  });

  describe('duplicate prevention', () => {
    it('does not save a second copy when title and content match', async () => {
      const markdown = '# Voice\n\nWarm and plain.';
      const first = await ingest('guide.md', markdown);
      const firstRow = {
        ...prisma.botContextFile.create.mock.calls[0][0].data,
        id: 'file-1',
      };
      prisma.botContextFile.findFirst.mockResolvedValueOnce(firstRow);

      const second = await ingest('guide.md', markdown);

      expect(second.duplicate).toBe(true);
      expect(second.fileId).toBe('file-1');
      expect(second.sections).toBe(first.sections);
      expect(second.created).toBe(0);
      expect(putRaw).toHaveBeenCalledTimes(1);
      expect(putText).toHaveBeenCalledTimes(1);
      expect(prisma.botContextFile.create).toHaveBeenCalledTimes(1);
      expect(createdDocuments).toHaveLength(1);
    });

    it('matches on title + content across different filenames and casing', async () => {
      const markdown = '# Voice\n\nWarm and plain.';
      await svc.ingest({
        filename: 'guide.md',
        contentType: 'text/markdown',
        buffer: Buffer.from(markdown),
        title: 'Voice Guide',
      });
      const firstRow = {
        ...prisma.botContextFile.create.mock.calls[0][0].data,
        id: 'file-1',
      };
      prisma.botContextFile.findFirst.mockResolvedValueOnce(firstRow);

      const result = await svc.ingest({
        filename: 'copy.md',
        contentType: 'text/markdown',
        buffer: Buffer.from(markdown),
        title: 'voice guide',
      });

      expect(result.duplicate).toBe(true);
      expect(result.filename).toBe('guide.md');
      expect(prisma.botContextFile.create).toHaveBeenCalledTimes(1);
    });

    it('still stores the same bytes under a different title', async () => {
      const markdown = '# Voice\n\nWarm and plain.';
      await ingest('guide.md', markdown);
      const result = await svc.ingest({
        filename: 'guide.md',
        contentType: 'text/markdown',
        buffer: Buffer.from(markdown),
        title: 'A Different Guide',
      });

      expect(result.duplicate).toBe(false);
      expect(prisma.botContextFile.create).toHaveBeenCalledTimes(2);
    });

    it('returns the winner when a concurrent insert hits the unique index', async () => {
      prisma.botContextFile.create.mockRejectedValueOnce({ code: 'P2002' });
      prisma.botContextFile.findUnique.mockResolvedValueOnce({
        id: 'winner',
        filename: 'guide.md',
        sectionCount: 3,
        storageKey: 'raw/winner/guide.md',
        textStorageKey: 'text/winner/guide.md.md',
      });

      const result = await ingest('guide.md', '# Voice\n\nWarm.');

      expect(result.duplicate).toBe(true);
      expect(result.fileId).toBe('winner');
      expect(result.sections).toBe(3);
      expect(prisma.botContextFile.delete).not.toHaveBeenCalled();
      // Our objects were not the winner's, so they must not be left behind.
      expect(remove).toHaveBeenCalledWith(
        putRaw.mock.calls[0][0],
        putText.mock.calls[0][0],
      );
    });
  });

  describe('archives', () => {
    const buildZip = (files: Record<string, string>) => {
      const zip = new AdmZip();
      for (const [name, content] of Object.entries(files)) {
        zip.addFile(name, Buffer.from(content, 'utf8'));
      }
      return zip.toBuffer();
    };

    it('imports one document per entry, naming heading-less ones after the entry', async () => {
      const buffer = buildZip({
        'brand.md': '# Voice\n\nWarm and plain.',
        'prices.txt': 'Consultation is five hundred shillings.',
      });

      const result = await ingest('bundle.zip', buffer);

      expect(result.sections).toBeGreaterThanOrEqual(2);
      expect(createdDocuments.map((d) => d.title)).toContain('Prices');
      // Everything in the archive hangs off one upload identity, so a re-upload
      // replaces the whole bundle rather than leaving orphaned sections.
      expect(new Set(createdDocuments.map((d) => d.externalId))).toEqual(
        new Set(['upload:bundle.zip']),
      );
    });

    it('keeps the archive itself as the single raw object', async () => {
      const buffer = buildZip({ 'a.md': '# A\n\nOne.' });
      await ingest('bundle.zip', buffer);

      const [rawKey, rawBody] = putRaw.mock.calls[0];
      expect(rawKey).toMatch(/\/bundle\.zip$/);
      expect(rawBody).toEqual(buffer);
    });
  });

  describe('failure and unwind', () => {
    it('writes nothing when the file cannot be extracted', async () => {
      await expect(ingest('logo.png', 'not a real png')).rejects.toThrow(
        BadRequestException,
      );

      expect(putRaw).not.toHaveBeenCalled();
      expect(putText).not.toHaveBeenCalled();
      expect(prisma.botContextFile.create).not.toHaveBeenCalled();
    });

    it('removes the stored objects and the row when section import fails', async () => {
      prisma.botContextDocument.create.mockRejectedValue(
        new Error('database went away'),
      );

      await expect(ingest('guide.md', '# Voice\n\nWarm.')).rejects.toThrow(
        'database went away',
      );

      // Extraction and both S3 writes happened first…
      expect(putRaw).toHaveBeenCalledTimes(1);
      expect(putText).toHaveBeenCalledTimes(1);
      // …then the row was created and everything was wound back.
      expect(prisma.botContextFile.create).toHaveBeenCalledTimes(1);
      expect(prisma.botContextFile.delete.mock.calls[0][0].where.id).toBe(
        'file-1',
      );
      expect(remove).toHaveBeenCalledTimes(1);
      const [rawKey, textKey] = remove.mock.calls[0];
      expect(rawKey).toMatch(/^raw\//);
      expect(textKey).toMatch(/^text\//);
    });

    it('removes the objects when the file row itself cannot be created', async () => {
      prisma.botContextFile.create.mockRejectedValue(
        new Error('row insert failed'),
      );

      await expect(ingest('guide.md', '# Voice\n\nWarm.')).rejects.toThrow(
        'row insert failed',
      );

      expect(remove).toHaveBeenCalledTimes(1);
      // Nothing to delete — the row never existed.
      expect(prisma.botContextFile.delete).not.toHaveBeenCalled();
      expect(createdDocuments).toHaveLength(0);
    });

    it('leaves no sections behind when a later section fails mid-import', async () => {
      prisma.botContextDocument.create
        .mockResolvedValueOnce({ id: 'doc-1' })
        .mockRejectedValueOnce(new Error('connection reset'));

      await expect(
        ingest('guide.md', '# One\n\nAlpha.\n\n# Two\n\nBeta.'),
      ).rejects.toThrow('connection reset');

      expect(prisma.botContextFile.delete.mock.calls[0][0].where.id).toBe(
        'file-1',
      );
      expect(remove).toHaveBeenCalledTimes(1);
    });
  });
});
