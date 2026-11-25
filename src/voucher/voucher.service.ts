import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export const VOUCHER_STATUSES = [
  'ISSUED',
  'REDEEMED',
  'EXPIRED',
  'VOID',
] as const;
export type VoucherStatusValue = (typeof VOUCHER_STATUSES)[number];

/** Channels an admin can record when a voucher is handed out. */
export const VOUCHER_CHANNELS = [
  'WHATSAPP',
  'SMS',
  'EMAIL',
  'IN_PERSON',
  'POSTER',
  'FACEBOOK',
  'INSTAGRAM',
  'X',
  'TIKTOK',
  'REFERRAL',
  'OTHER',
] as const;
export type VoucherChannel = (typeof VOUCHER_CHANNELS)[number];

// No O/0/I/1 — codes are read aloud and copied by hand.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 5;
const MAX_CODE_ATTEMPTS = 25;
const DEFAULT_PREFIX = 'SMILE';

export interface CreateVoucherBatchInput {
  count: number;
  prefix?: string | null;
  note?: string | null;
  expiresAt?: string | Date | null;
  createdByAdminId?: string | null;
  name?: string;
}

export interface ListVouchersInput {
  status?: string;
  search?: string;
  limit?: number;
}

export interface RedeemVoucherInput {
  redeemedBy?: string | null;
  notes?: string | null;
  adminId?: string | null;
}

export interface VerifyVoucherResult {
  valid: boolean;
  status?: VoucherStatusValue;
  redeemedAt?: string | null;
}

/** Uppercase, alphanumeric, bounded prefix used in every code. */
export function normalizeVoucherPrefix(prefix?: string | null): string {
  const cleaned = String(prefix ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 10);
  return cleaned || DEFAULT_PREFIX;
}

/** e.g. SMILE-K7Q2M — pure so it can be unit tested with a seeded random. */
export function buildVoucherCode(
  prefix?: string | null,
  random: () => number = Math.random,
): string {
  let suffix = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    const index = Math.min(
      CODE_ALPHABET.length - 1,
      Math.max(0, Math.floor(random() * CODE_ALPHABET.length)),
    );
    suffix += CODE_ALPHABET[index];
  }
  return `${normalizeVoucherPrefix(prefix)}-${suffix}`;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: string }).code === 'P2002'
  );
}

@Injectable()
export class VoucherService {
  private readonly logger = new Logger(VoucherService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a batch and its codes. Codes are checked against the database before
   * insertion (and a unique-constraint race is retried) so a printed code never
   * points at two vouchers.
   */
  private mapBatch(batch: any) {
    if (!batch) return batch;
    const { totalInt, ...rest } = batch;
    return { ...rest, total: totalInt ?? rest.total ?? 0 };
  }

  private mapVoucher(voucher: any) {
    if (!voucher) return voucher;
    return {
      ...voucher,
      sharedChannels: Array.isArray(voucher.sharedChannels)
        ? voucher.sharedChannels
        : [],
      batch: voucher.batch ? this.mapBatch(voucher.batch) : voucher.batch,
    };
  }

  async createBatch(input: CreateVoucherBatchInput) {
    const count = Number(input?.count);
    if (!Number.isInteger(count) || count < 1 || count > 500) {
      throw new BadRequestException('Batch size must be between 1 and 500.');
    }
    const prefix = normalizeVoucherPrefix(input?.prefix);
    const expiresAt = input?.expiresAt ? new Date(input.expiresAt) : null;
    if (expiresAt && Number.isNaN(expiresAt.getTime())) {
      throw new BadRequestException('Enter a valid expiry date.');
    }

    const batch = await this.prisma.voucherBatch.create({
      data: {
        name:
          input?.name?.trim() ||
          `${prefix} ${new Date().toISOString().slice(0, 10)}`,
        codePrefix: prefix,
        note: input?.note?.trim() || null,
        totalInt: count,
        createdByAdminId: input?.createdByAdminId || null,
      },
    });

    const vouchers: any[] = [];
    const allocated = new Set<string>();
    for (let index = 0; index < count; index += 1) {
      let created: any = null;
      for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt += 1) {
        const code = buildVoucherCode(prefix);
        if (allocated.has(code)) continue;
        const existing = await this.prisma.voucher.findUnique?.({
          where: { code },
        });
        if (existing) continue;
        try {
          created = await this.prisma.voucher.create({
            data: {
              code,
              batchId: batch.id,
              status: 'ISSUED',
              expiresAt,
            },
          });
          allocated.add(code);
          break;
        } catch (error) {
          if (isUniqueViolation(error)) continue;
          throw error;
        }
      }
      if (!created) {
        // Should be astronomically unlikely; fail loudly rather than return a
        // batch that is missing codes.
        this.logger.error(`Could not allocate a unique voucher code for batch ${batch.id}`);
        throw new ConflictException('Could not allocate a unique voucher code.');
      }
      vouchers.push(created);
    }

    return {
      batch: this.mapBatch(batch),
      vouchers: vouchers.map((voucher) => this.mapVoucher(voucher)),
    };
  }

  async listVouchers(params: ListVouchersInput = {}) {
    const status = VOUCHER_STATUSES.includes(params.status as VoucherStatusValue)
      ? (params.status as VoucherStatusValue)
      : undefined;
    const search = params.search?.trim();
    const limit = Math.min(200, Math.max(1, Number(params.limit) || 50));

    const vouchers = await this.prisma.voucher.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(search
          ? {
              OR: [
                { code: { contains: search, mode: 'insensitive' as const } },
                {
                  issuedToName: {
                    contains: search,
                    mode: 'insensitive' as const,
                  },
                },
                {
                  issuedToPhone: {
                    contains: search,
                    mode: 'insensitive' as const,
                  },
                },
              ],
            }
          : {}),
      },
      include: { batch: true },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return vouchers.map((voucher) => this.mapVoucher(voucher));
  }

  async stats() {
    const [grouped, shared] = await Promise.all([
      this.prisma.voucher.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
      this.prisma.voucher.count({
        where: { sharedChannels: { isEmpty: false } },
      }),
    ]);

    const stats = {
      total: 0,
      issued: 0,
      redeemed: 0,
      expired: 0,
      void: 0,
      shared: shared ?? 0,
    };
    for (const row of grouped) {
      const amount = row?._count?._all ?? 0;
      stats.total += amount;
      switch (row?.status) {
        case 'ISSUED':
          stats.issued += amount;
          break;
        case 'REDEEMED':
          stats.redeemed += amount;
          break;
        case 'EXPIRED':
          stats.expired += amount;
          break;
        case 'VOID':
          stats.void += amount;
          break;
      }
    }
    return stats;
  }

  async get(id: string) {
    const voucher = await this.prisma.voucher.findUnique({
      where: { id },
      include: { batch: true },
    });
    if (!voucher) throw new NotFoundException('Voucher not found.');
    return this.mapVoucher(voucher);
  }

  private async getRaw(id: string) {
    const voucher = await this.prisma.voucher.findUnique({
      where: { id },
      include: { batch: true },
    });
    if (!voucher) throw new NotFoundException('Voucher not found.');
    return voucher;
  }

  /** Redeeming the same voucher twice is safe and returns the existing row. */
  async redeem(id: string, input: RedeemVoucherInput = {}) {
    const voucher = await this.getRaw(id);
    if (voucher.status === 'REDEEMED') return this.mapVoucher(voucher);
    if (voucher.status === 'VOID' || voucher.status === 'EXPIRED') {
      throw new BadRequestException(`Voucher is ${voucher.status.toLowerCase()}.`);
    }
    const updated = await this.prisma.voucher.update({
      where: { id },
      data: {
        status: 'REDEEMED',
        redeemedAt: new Date(),
        redeemedByAdminId: input.adminId || input.redeemedBy || null,
        redemptionNotes: input.notes?.trim() || null,
      },
      include: { batch: true },
    });
    return this.mapVoucher(updated);
  }

  async share(id: string, channel: string) {
    const normalized = String(channel ?? '')
      .trim()
      .toUpperCase();
    if (!VOUCHER_CHANNELS.includes(normalized as VoucherChannel)) {
      throw new BadRequestException('Unknown sharing channel.');
    }
    const voucher = await this.getRaw(id);
    const channels = Array.isArray(voucher.sharedChannels)
      ? voucher.sharedChannels
      : [];
    if (channels.includes(normalized)) return this.mapVoucher(voucher);

    const updated = await this.prisma.voucher.update({
      where: { id },
      data: {
        sharedChannels: [...channels, normalized],
      },
      include: { batch: true },
    });
    return this.mapVoucher(updated);
  }

  async void(id: string) {
    const voucher = await this.getRaw(id);
    if (voucher.status === 'VOID') return this.mapVoucher(voucher);
    const updated = await this.prisma.voucher.update({
      where: { id },
      data: { status: 'VOID' },
      include: { batch: true },
    });
    return this.mapVoucher(updated);
  }

  /**
   * Redeem a voucher by human-entered code. Used by bot/admin flows where the
   * code is the natural identifier. Idempotent for already-redeemed codes.
   */
  async redeemByCode(code: string, input: RedeemVoucherInput = {}) {
    const normalized = String(code ?? '').trim().toUpperCase();
    if (!normalized) throw new BadRequestException('Voucher code is required.');
    const voucher = await this.prisma.voucher.findUnique({
      where: { code: normalized },
      include: { batch: true },
    });
    if (!voucher) throw new NotFoundException('Voucher not found.');
    if (voucher.status === 'REDEEMED') return this.mapVoucher(voucher);
    const now = new Date();
    const result = await this.prisma.voucher.updateMany({
      where: {
        id: voucher.id,
        status: 'ISSUED',
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      data: {
        status: 'REDEEMED',
        redeemedAt: now,
        redeemedByAdminId: input.adminId || input.redeemedBy || null,
        redemptionNotes: input.notes?.trim() || null,
      },
    });
    if (result.count !== 1) throw new BadRequestException('Voucher is no longer available.');
    const updated = await this.prisma.voucher.findUniqueOrThrow({
      where: { id: voucher.id },
      include: { batch: true },
    });
    return this.mapVoucher(updated);
  }

  /**
   * Public check: never returns the batch, recipient, or any admin metadata.
   */
  async verifyPublic(code: string): Promise<VerifyVoucherResult> {
    const normalized = String(code ?? '')
      .trim()
      .toUpperCase();
    if (!normalized || normalized.length > 64) return { valid: false };

    const voucher = await this.prisma.voucher.findUnique({
      where: { code: normalized },
    });
    if (!voucher) return { valid: false };

    const expiresAt = voucher.expiresAt ? new Date(voucher.expiresAt) : null;
    const isExpired =
      Boolean(expiresAt) &&
      !Number.isNaN(expiresAt!.getTime()) &&
      expiresAt!.getTime() <= Date.now();
    const status: VoucherStatusValue =
      isExpired && voucher.status === 'ISSUED' ? 'EXPIRED' : voucher.status;
    const redeemedAt = voucher.redeemedAt
      ? new Date(voucher.redeemedAt).toISOString()
      : null;

    return { valid: status === 'ISSUED', status, redeemedAt };
  }
}
