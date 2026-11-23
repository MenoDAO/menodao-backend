import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  buildVoucherCode,
  normalizeVoucherPrefix,
  VoucherService,
} from './voucher.service';

function build() {
  const rows: any[] = [];
  const prisma = {
    voucherBatch: {
      create: jest.fn().mockImplementation(({ data }) =>
        Promise.resolve({
          id: 'batch-1',
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      ),
    },
    voucher: {
      create: jest.fn().mockImplementation(({ data }) => {
        const row = {
          id: `v-${rows.length + 1}`,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        rows.push(row);
        return Promise.resolve(row);
      }),
      findUnique: jest.fn().mockImplementation(({ where }) => {
        const row = rows.find(
          (candidate) =>
            candidate.id === where.id || candidate.code === where.code,
        );
        return Promise.resolve(row ?? null);
      }),
      findMany: jest.fn().mockResolvedValue([]),
      groupBy: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      update: jest.fn().mockImplementation(({ where, data }) => {
        const row = rows.find(
          (candidate) =>
            candidate.id === where.id || candidate.code === where.code,
        );
        if (!row) return Promise.resolve(null);
        Object.assign(row, data);
        return Promise.resolve(row);
      }),
    },
  };
  const service = new VoucherService(prisma as unknown as PrismaService);
  return { service, prisma, rows };
}

const seed = (
  rows: any[],
  overrides: Record<string, unknown> = {},
): any => {
  const row = {
    id: `v-${rows.length + 1}`,
    code: `SMILE-AAAA${rows.length + 1}`,
    status: 'ISSUED',
    sharedChannels: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
  rows.push(row);
  return row;
};

describe('voucher code generation', () => {
  afterEach(() => jest.restoreAllMocks());

  it('uses the unambiguous uppercase alphabet with a hyphenated prefix', () => {
    jest.spyOn(Math, 'random').mockReturnValue(0);
    expect(buildVoucherCode('smile')).toBe('SMILE-AAAAA');
    expect(normalizeVoucherPrefix(' smile! ')).toBe('SMILE');
    expect(buildVoucherCode('')).toMatch(/^SMILE-[A-HJ-NP-Z2-9]{5}$/);
  });

  it('retries when the generated code already exists', async () => {
    const { service, prisma, rows } = build();
    seed(rows, { code: 'SMILE-AAAAA' });
    // First five draws -> AAAAA (taken); next five -> BBBBB.
    jest
      .spyOn(Math, 'random')
      .mockReturnValue(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValue(1 / 32);

    const batch = await service.createBatch({ count: 1, createdByAdminId: 'a1' });

    expect(batch.vouchers).toHaveLength(1);
    expect(batch.vouchers[0].code).toBe('SMILE-BBBBB');
    expect(prisma.voucher.findUnique).toHaveBeenCalledTimes(2);
    expect(prisma.voucherBatch.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          codePrefix: 'SMILE',
          totalInt: 1,
          createdByAdminId: 'a1',
        }),
      }),
    );
  });

  it('rejects batch sizes outside 1..500', async () => {
    const { service } = build();
    await expect(service.createBatch({ count: 0 })).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.createBatch({ count: 501 })).rejects.toThrow(
      BadRequestException,
    );
  });
});

describe('VoucherService lifecycle', () => {
  it('reports grouped stats and shared codes', async () => {
    const { service, prisma } = build();
    prisma.voucher.groupBy.mockResolvedValue([
      { status: 'ISSUED', _count: { _all: 4 } },
      { status: 'REDEEMED', _count: { _all: 2 } },
      { status: 'VOID', _count: { _all: 1 } },
    ]);
    prisma.voucher.count.mockResolvedValue(3);

    expect(await service.stats()).toEqual({
      total: 7,
      issued: 4,
      redeemed: 2,
      expired: 0,
      void: 1,
      shared: 3,
    });
    expect(prisma.voucher.count).toHaveBeenCalledWith({
      where: { sharedChannels: { isEmpty: false } },
    });
  });

  it('redeems once and returns the existing row on repeat calls', async () => {
    const { service, prisma, rows } = build();
    const row = seed(rows, { code: 'SMILE-K7Q2M' });

    const redeemed = await service.redeem(row.id, {
      adminId: 'admin-1',
      notes: ' Handed over at camp ',
    });
    expect(redeemed.status).toBe('REDEEMED');
    expect(redeemed.redeemedByAdminId).toBe('admin-1');
    expect(redeemed.redemptionNotes).toBe('Handed over at camp');
    expect(prisma.voucher.update).toHaveBeenCalledTimes(1);

    const again = await service.redeem(row.id, { adminId: 'admin-2' });
    expect(again).toBe(row);
    expect(prisma.voucher.update).toHaveBeenCalledTimes(1);
  });

  it('appends each sharing channel only once', async () => {
    const { service, prisma, rows } = build();
    const row = seed(rows);

    await service.share(row.id, 'whatsapp');
    expect(prisma.voucher.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { sharedChannels: ['WHATSAPP'] },
      }),
    );

    const unchanged = await service.share(row.id, 'WHATSAPP');
    expect(unchanged.sharedChannels).toEqual(['WHATSAPP']);
    expect(prisma.voucher.update).toHaveBeenCalledTimes(1);
    await expect(service.share(row.id, 'CARRIER_PIGEON')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('voids a voucher and accepts a repeated void', async () => {
    const { service, prisma, rows } = build();
    const row = seed(rows);
    expect((await service.void(row.id)).status).toBe('VOID');
    expect((await service.void(row.id)).status).toBe('VOID');
    expect(prisma.voucher.update).toHaveBeenCalledTimes(1);
  });

  it('lists vouchers with their batch and filters by status/query', async () => {
    const { service, prisma } = build();
    await service.listVouchers({ status: 'REDEEMED', search: 'k7', limit: 10 });
    expect(prisma.voucher.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'REDEEMED',
          OR: expect.any(Array),
        }),
        include: { batch: true },
        take: 10,
      }),
    );
  });

  it('verifies a code publicly without leaking personal or batch data', async () => {
    const { service, rows } = build();
    seed(rows, {
      code: 'SMILE-K7Q2M',
      issuedToName: 'Private Person',
      issuedToPhone: '254700000000',
      redeemedByAdminId: 'admin-1',
      batchId: 'batch-1',
    });

    expect(await service.verifyPublic(' smile-k7q2m ')).toEqual({
      valid: true,
      status: 'ISSUED',
      redeemedAt: null,
    });
    expect(await service.verifyPublic('NOPE')).toEqual({ valid: false });

    await service.redeem('v-1', { adminId: 'admin-1' });
    const verified = await service.verifyPublic('SMILE-K7Q2M');
    expect(verified.valid).toBe(false);
    expect(verified.status).toBe('REDEEMED');
    expect(typeof verified.redeemedAt).toBe('string');
    expect(Object.keys(verified)).toEqual(['valid', 'status', 'redeemedAt']);
  });
});
