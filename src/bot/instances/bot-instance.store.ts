import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { BotWhatsappInstance } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BotInstanceSecretService } from './bot-instance-secret.service';

const CREDENTIAL_CACHE_TTL_MS = 60_000;

export interface BotInstanceView {
  id: string;
  provider: string;
  providerId: string;
  label: string | null;
  phoneNumber: string | null;
  status: string;
  isActive: boolean;
  webhookUrl: string | null;
  hasStoredKey: boolean;
  keyFingerprint: string | null;
  lastCheckedAt: Date | null;
  lastConnectedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SendCredentials {
  providerId: string;
  apiKey: string;
  source: 'db' | 'env';
}

/**
 * Persistence + credential resolution for WhatsApp instances.
 *
 * Deliberately does not depend on the provider client, so the client can depend
 * on this store for outbound credentials without a circular module.
 */
@Injectable()
export class BotInstanceStore {
  private readonly logger = new Logger(BotInstanceStore.name);
  private cached: { at: number; credentials: SendCredentials } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly secrets: BotInstanceSecretService,
    private readonly configService: ConfigService,
  ) {}

  toView(row: BotWhatsappInstance): BotInstanceView {
    let keyFingerprint: string | null = null;
    if (row.apiKeyCipher && this.secrets.isConfigured()) {
      try {
        keyFingerprint = this.secrets.fingerprint(
          this.secrets.decrypt(row.apiKeyCipher),
        );
      } catch {
        keyFingerprint = 'unreadable';
      }
    }
    return {
      id: row.id,
      provider: row.provider,
      providerId: row.providerId,
      label: row.label,
      phoneNumber: row.phoneNumber,
      status: row.status,
      isActive: row.isActive,
      webhookUrl: row.webhookUrl,
      hasStoredKey: Boolean(row.apiKeyCipher),
      keyFingerprint,
      lastCheckedAt: row.lastCheckedAt,
      lastConnectedAt: row.lastConnectedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async list(): Promise<BotWhatsappInstance[]> {
    return this.prisma.botWhatsappInstance.findMany({
      orderBy: [{ isActive: 'desc' }, { createdAt: 'asc' }],
    });
  }

  async get(id: string): Promise<BotWhatsappInstance> {
    const row = await this.prisma.botWhatsappInstance.findUnique({
      where: { id },
    });
    if (!row) throw new NotFoundException(`WhatsApp instance ${id} not found`);
    return row;
  }

  async findByProviderId(
    providerId: string,
  ): Promise<BotWhatsappInstance | null> {
    return this.prisma.botWhatsappInstance.findFirst({
      where: { provider: 'flaresend', providerId },
    });
  }

  /** Inserts or refreshes a provider-side instance without clobbering local state. */
  async upsertFromProvider(input: {
    providerId: string;
    status?: string;
    phoneNumber?: string | null;
    label?: string | null;
    webhookUrl?: string | null;
  }): Promise<BotWhatsappInstance> {
    const existing = await this.findByProviderId(input.providerId);
    const checkedAt = new Date();
    if (existing) {
      return this.prisma.botWhatsappInstance.update({
        where: { id: existing.id },
        data: {
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.phoneNumber !== undefined
            ? { phoneNumber: input.phoneNumber }
            : {}),
          ...(input.label !== undefined ? { label: input.label } : {}),
          ...(input.webhookUrl !== undefined
            ? { webhookUrl: input.webhookUrl }
            : {}),
          lastCheckedAt: checkedAt,
          ...(input.status === 'CONNECTED'
            ? { lastConnectedAt: checkedAt }
            : {}),
        },
      });
    }

    // First instance we learn about becomes the sender, so a fresh environment
    // keeps working without an extra activation step.
    const count = await this.prisma.botWhatsappInstance.count();
    return this.prisma.botWhatsappInstance.create({
      data: {
        provider: 'flaresend',
        providerId: input.providerId,
        status: input.status ?? 'UNKNOWN',
        phoneNumber: input.phoneNumber ?? null,
        label: input.label ?? null,
        webhookUrl: input.webhookUrl ?? null,
        isActive: count === 0,
        lastCheckedAt: checkedAt,
        ...(input.status === 'CONNECTED' ? { lastConnectedAt: checkedAt } : {}),
      },
    });
  }

  async updateStatus(
    id: string,
    status: string,
    phoneNumber?: string | null,
  ): Promise<BotWhatsappInstance> {
    const checkedAt = new Date();
    return this.prisma.botWhatsappInstance.update({
      where: { id },
      data: {
        status,
        lastCheckedAt: checkedAt,
        ...(phoneNumber !== undefined ? { phoneNumber } : {}),
        ...(status === 'CONNECTED' ? { lastConnectedAt: checkedAt } : {}),
      },
    });
  }

  async setLabel(
    id: string,
    label: string | null,
  ): Promise<BotWhatsappInstance> {
    return this.prisma.botWhatsappInstance.update({
      where: { id },
      data: { label },
    });
  }

  async setWebhookUrl(
    id: string,
    webhookUrl: string | null,
  ): Promise<BotWhatsappInstance> {
    return this.prisma.botWhatsappInstance.update({
      where: { id },
      data: { webhookUrl },
    });
  }

  async storeApiKey(id: string, apiKey: string): Promise<BotWhatsappInstance> {
    const updated = await this.prisma.botWhatsappInstance.update({
      where: { id },
      data: { apiKeyCipher: this.secrets.encrypt(apiKey) },
    });
    this.cached = null;
    return updated;
  }

  async activate(id: string): Promise<BotWhatsappInstance> {
    const row = await this.get(id);
    if (
      !row.apiKeyCipher &&
      !this.configService.get<string>('FLARESEND_API_KEY')
    ) {
      throw new Error(
        'This instance has no stored key and no environment key is configured.',
      );
    }
    await this.prisma.$transaction([
      this.prisma.botWhatsappInstance.updateMany({ data: { isActive: false } }),
      this.prisma.botWhatsappInstance.update({
        where: { id },
        data: { isActive: true },
      }),
    ]);
    this.cached = null;
    return this.get(id);
  }

  async remove(id: string): Promise<void> {
    await this.get(id);
    await this.prisma.botWhatsappInstance.delete({ where: { id } });
    this.cached = null;
  }

  /**
   * Credentials for outbound sends: the active instance's stored key when there
   * is one, otherwise the environment pair. Cached for a minute so a send never
   * pays a database round trip, while an activation still propagates quickly.
   */
  async getSendCredentials(): Promise<SendCredentials | null> {
    if (this.cached && Date.now() - this.cached.at < CREDENTIAL_CACHE_TTL_MS) {
      return this.cached.credentials;
    }

    const active = await this.prisma.botWhatsappInstance.findFirst({
      where: { isActive: true },
    });

    if (active?.apiKeyCipher) {
      try {
        const credentials: SendCredentials = {
          providerId: active.providerId,
          apiKey: this.secrets.decrypt(active.apiKeyCipher),
          source: 'db',
        };
        this.cached = { at: Date.now(), credentials };
        return credentials;
      } catch (error) {
        this.logger.error(
          `Cannot decrypt the stored key for instance ${active.providerId}; falling back to the environment key: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    const envKey = this.configService.get<string>('FLARESEND_API_KEY');
    if (!envKey) return null;
    const credentials: SendCredentials = {
      providerId: this.configService.get<string>('FLARESEND_INSTANCE_ID') ?? '',
      apiKey: envKey,
      source: 'env',
    };
    this.cached = { at: Date.now(), credentials };
    return credentials;
  }

  invalidateCredentialCache(): void {
    this.cached = null;
  }
}
