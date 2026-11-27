import { ConfigService } from '@nestjs/config';
import { FieldDataService, normalizeFieldPhone } from './field-data.service';

function build(
  overrides: {
    contributor?: unknown;
    llmReply?: string;
    llmError?: Error;
  } = {},
) {
  const submissions = new Map<string, any>();
  const prisma = {
    fieldContributor: {
      findFirst: jest
        .fn()
        .mockResolvedValue(
          overrides.contributor === undefined
            ? { id: 'c1', phoneNumber: '254712345678', role: 'DOCTOR' }
            : overrides.contributor,
        ),
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
    },
    fieldSubmission: {
      create: jest.fn().mockImplementation(({ data }) => {
        const row = {
          id: data.id,
          ...data,
          status: data.status || 'PENDING',
        };
        submissions.set(row.id, row);
        return Promise.resolve(row);
      }),
      update: jest.fn().mockImplementation(({ where, data }) => {
        const row = { ...submissions.get(where.id), ...data };
        submissions.set(where.id, row);
        return Promise.resolve(row);
      }),
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUnique: jest
        .fn()
        .mockImplementation(({ where }) =>
          Promise.resolve(submissions.get(where.id) ?? null),
        ),
      delete: jest.fn(),
    },
  };
  const storage = {
    save: jest.fn().mockResolvedValue({
      key: 'field-data/raw/test/image.jpg',
      sha256: 'abc',
    }),
    read: jest.fn(),
    newSubmissionId: jest.fn(() => `sub-${submissions.size + 1}`),
  };
  const llm = {
    generateCompletion: jest.fn().mockImplementation(() => {
      if (overrides.llmError) throw overrides.llmError;
      return Promise.resolve(overrides.llmReply ?? '{}');
    }),
  };
  const config = {
    get: jest.fn().mockReturnValue(null),
  } as unknown as ConfigService;
  const service = new FieldDataService(
    prisma as never,
    storage as never,
    config,
    llm,
  );
  return { service, prisma, storage, llm };
}

const imageInput = {
  phoneCandidates: ['+254712345678'],
  kind: 'IMAGE' as const,
  mimeType: 'image/jpeg',
  buffer: Buffer.from('fake-image'),
  caption: 'Camp attendance',
};

describe('FieldDataService', () => {
  it('normalises Kenyan phone numbers to one canonical form', () => {
    expect(normalizeFieldPhone('+254712345678')).toBe('254712345678');
    expect(normalizeFieldPhone('0712345678')).toBe('254712345678');
    expect(normalizeFieldPhone('712345678')).toBe('254712345678');
  });

  it('rejects uploads from senders who are not authorised contributors', async () => {
    const { service, storage, llm } = build({ contributor: null });
    const result = await service.ingestMedia(imageInput);
    expect(result.accepted).toBe(false);
    expect(result.reply).toContain('authorised');
    expect(storage.save).not.toHaveBeenCalled();
    expect(llm.generateCompletion).not.toHaveBeenCalled();
  });

  it('waits for a label before using an uncaptioned attachment', async () => {
    const { service, llm } = build();
    const result = await service.ingestMedia({ ...imageInput, caption: '  ' });
    expect(result.reply).toContain('What is this attachment about?');
    expect(result.status).toBe('PENDING');
    expect(llm.generateCompletion).not.toHaveBeenCalled();
  });

  it('ties a follow-up caption to the original author and attachment', async () => {
    const { service, prisma, llm, storage } = build();
    prisma.fieldSubmission.findMany.mockResolvedValue([
      {
        id: '1234abcd-0000-0000-0000-000000000000',
        fileKey: 'private',
        kind: 'IMAGE',
        mimeType: 'image/jpeg',
      },
    ]);
    storage.read.mockResolvedValue({ body: Buffer.from('photo') });
    await service.addCaption(
      ['254712345678'],
      '254712345678',
      'Caption 1234abcd outreach register',
    );
    expect(prisma.fieldSubmission.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          contributorId: 'c1',
          whatsappId: '254712345678',
        }),
      }),
    );
    expect(prisma.fieldSubmission.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { caption: 'outreach register', captionRequestedAt: null },
      }),
    );
    expect(llm.generateCompletion).toHaveBeenCalledTimes(1);
  });

  it('routes clinical imagery to authorised human review without model processing', async () => {
    const { service, llm, prisma } = build();
    const result = await service.ingestMedia({
      ...imageInput,
      caption: 'X-ray: lower molar',
    });
    expect(result.status).toBe('NEEDS_REVIEW');
    expect(prisma.fieldSubmission.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { clinicalImage: true },
      }),
    );
    expect(llm.generateCompletion).not.toHaveBeenCalled();
  });

  it('saves a high-confidence image extraction as PARSED', async () => {
    const { service, llm } = build({
      llmReply: JSON.stringify({
        reportType: 'Clinic camp register',
        eventDate: '2026-11-20',
        location: 'Mikindani',
        patientCount: 42,
        peopleSeen: 42,
        summary: 'Forty-two members attended the dental camp.',
        observations: ['Register was legible'],
        confidence: 0.92,
        unclear: [],
      }),
    });
    const result = await service.ingestMedia(imageInput);
    expect(result.accepted).toBe(true);
    expect(result.status).toBe('PARSED');
    expect(llm.generateCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'field_data.parse',
        responseFormat: 'json',
        images: [expect.objectContaining({ mimeType: 'image/jpeg' })],
      }),
    );
  });

  it('stores numeric people metrics in the extracted payload', async () => {
    const { service, prisma, llm } = build({
      llmReply: JSON.stringify({
        summary: 'Camp register was legible.',
        peopleReached: '42',
        peopleScreened: 38,
        treatmentsDone: 31,
        referrals: 5,
        confidence: 0.95,
        unclear: [],
      }),
    });

    const result = await service.ingestMedia(imageInput);

    expect(result.status).toBe('PARSED');
    const updateCall = (prisma.fieldSubmission.update as jest.Mock).mock
      .calls[0][0];
    expect(updateCall.data.extracted).toMatchObject({
      peopleReached: 42,
      peopleScreened: 38,
      treatmentsDone: 31,
      referrals: 5,
    });
    const promptCall = (llm.generateCompletion as jest.Mock).mock.calls[0][0];
    expect(promptCall.systemPrompt).toContain('peopleReached');
    expect(promptCall.systemPrompt).toContain('treatmentsDone');
  });

  it('maps legacy count aliases into peopleReached', async () => {
    const { service, prisma } = build({
      llmReply: JSON.stringify({
        summary: 'Legacy register.',
        peopleSeen: 22,
        patientCount: 20,
        confidence: 0.9,
        unclear: [],
      }),
    });

    await service.ingestMedia(imageInput);

    const updateCall = (prisma.fieldSubmission.update as jest.Mock).mock
      .calls[0][0];
    expect(updateCall.data.extracted.peopleReached).toBe(22);
    expect(updateCall.data.extracted.peopleSeen).toBe(22);
  });

  it('routes low-confidence extractions to the admin review queue', async () => {
    const { service } = build({
      llmReply: JSON.stringify({
        summary: 'Some text was hard to read',
        confidence: 0.31,
        unclear: ['patient count'],
      }),
    });
    const result = await service.ingestMedia(imageInput);
    expect(result.status).toBe('NEEDS_REVIEW');
    expect(result.reply).toContain('administrator');
  });

  it('falls back to admin when the model returns invalid JSON', async () => {
    const { service } = build({ llmReply: 'I cannot read this image.' });
    const result = await service.ingestMedia(imageInput);
    expect(result.status).toBe('NEEDS_REVIEW');
  });

  it('falls back to admin when the model call fails', async () => {
    const { service } = build({ llmError: new Error('quota') });
    const result = await service.ingestMedia(imageInput);
    expect(result.status).toBe('NEEDS_REVIEW');
  });

  it.each(['application/pdf', 'application/octet-stream'])(
    'extracts a PDF sent as %s through the same review workflow as images',
    async (mimeType) => {
      const { service, llm } = build({
        llmReply: JSON.stringify({
          summary: 'Synthetic report',
          confidence: 0.95,
        }),
      });
      const buffer = Buffer.from('%PDF-1.7 synthetic report');
      const result = await service.ingestMedia({
        ...imageInput,
        kind: 'DOCUMENT',
        mimeType,
        buffer,
      });
      expect(result.status).toBe('PARSED');
      expect(llm.generateCompletion).toHaveBeenCalledWith(
        expect.objectContaining({ pdfBase64: buffer.toString('base64') }),
      );
    },
  );

  it('keeps video in admin review', async () => {
    const { service, llm } = build();
    const result = await service.ingestMedia({
      ...imageInput,
      kind: 'VIDEO',
      mimeType: 'video/mp4',
    });
    expect(result.status).toBe('NEEDS_REVIEW');
    expect(llm.generateCompletion).not.toHaveBeenCalled();
  });
});
