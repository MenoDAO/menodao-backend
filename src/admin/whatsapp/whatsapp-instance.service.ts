import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { FlaresendApiClient } from '../../bot/whatsapp-clients/flaresend-api.client';
import { BotInstanceStore } from '../../bot/instances/bot-instance.store';
import type { BotInstanceView } from '../../bot/instances/bot-instance.store';

const PROVIDER_STATUS_MAP: Record<string, string> = {
  connected: 'CONNECTED',
  awaiting_scan: 'AWAITING_SCAN',
  qr: 'AWAITING_SCAN',
  initializing: 'INITIALIZING',
  disconnected: 'DISCONNECTED',
  not_found: 'DISCONNECTED',
  closed: 'DISCONNECTED',
};

export interface WhatsappInstanceOverview {
  instances: BotInstanceView[];
  activeInstanceId: string | null;
  plan: {
    name: string | null;
    maxInstances: number | null;
    maxApiCalls: number | null;
    status: string | null;
    endsAt: string | null;
  };
  slotsUsed: number;
  slotsRemaining: number | null;
  webhookUrl: string | null;
  webhookNote: string;
}

/**
 * Operator-facing control of the bot's WhatsApp instances.
 *
 * The provider dashboard is the only place a webhook URL can be set, so this
 * service surfaces the exact URL to paste there instead of pretending it can
 * configure it. Everything else — create, relink to another number, activate,
 * delete — goes through the API.
 */
@Injectable()
export class AdminWhatsappService {
  private readonly logger = new Logger(AdminWhatsappService.name);

  constructor(
    private readonly client: FlaresendApiClient,
    private readonly store: BotInstanceStore,
    private readonly configService: ConfigService,
  ) {}

  async overview(): Promise<WhatsappInstanceOverview> {
    const [rows, subscription] = await Promise.all([
      this.store.list(),
      this.client.getSubscription(),
    ]);
    const maxInstances = subscription?.plan?.maxInstances ?? null;
    return {
      instances: rows.map((row) => this.store.toView(row)),
      activeInstanceId: rows.find((row) => row.isActive)?.id ?? null,
      plan: {
        name: subscription?.plan?.name ?? null,
        maxInstances,
        maxApiCalls: subscription?.plan?.maxApiCalls ?? null,
        status: subscription?.status ?? null,
        endsAt: subscription?.endsAt ?? null,
      },
      slotsUsed: rows.length,
      slotsRemaining:
        maxInstances === null ? null : Math.max(maxInstances - rows.length, 0),
      webhookUrl: this.webhookUrl(),
      webhookNote:
        'FlareSend exposes no API for the instance webhook. Paste this URL in ' +
        'Your WhatsApp Instances → Edit Webhook in the FlareSend dashboard.',
    };
  }

  /** Imports whatever the provider knows about into the local table. */
  async sync(): Promise<WhatsappInstanceOverview> {
    const remote = await this.callProvider('importing instances', () =>
      this.client.listInstances(),
    );
    for (const instance of remote) {
      await this.store.upsertFromProvider({
        providerId: instance.id,
        status: this.mapStatus(instance.status),
        phoneNumber: this.phoneOf(instance),
        label: (instance.name as string | undefined) ?? null,
      });
    }
    this.logger.log(`Synced ${remote.length} instance(s) from FlareSend.`);
    return this.overview();
  }

  async detail(id: string) {
    const row = await this.store.get(id);
    let live: { status?: string; phoneNumber?: string | null } | null = null;
    try {
      live = await this.client.getInstanceStatus(row.providerId);
      if (live.status) {
        const refreshed = await this.store.updateStatus(
          row.id,
          this.mapStatus(live.status),
          live.phoneNumber ?? undefined,
        );
        return this.store.toView(refreshed);
      }
    } catch (error) {
      this.logger.warn(
        `Cannot read live status for instance ${row.providerId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    return this.store.toView(row);
  }

  async create(input: {
    label?: string;
    phoneNumber?: string;
  }): Promise<BotInstanceView> {
    const [rows, subscription] = await Promise.all([
      this.store.list(),
      this.client.getSubscription(),
    ]);
    const maxInstances = subscription?.plan?.maxInstances;
    if (typeof maxInstances === 'number' && rows.length >= maxInstances) {
      throw new ConflictException(
        `The ${subscription?.plan?.name ?? 'current'} plan allows ${maxInstances} ` +
          'WhatsApp instance(s) and one is already in use. Upgrade the plan in ' +
          'FlareSend before adding another, or relink the existing instance to a ' +
          'different number instead.',
      );
    }

    const created = await this.callProvider('creating an instance', () =>
      this.client.createInstance(input.label),
    );
    const row = await this.store.upsertFromProvider({
      providerId: created.instanceId,
      status: 'INITIALIZING',
      label: input.label ?? null,
      phoneNumber: input.phoneNumber ?? null,
    });

    if (!created.apiKey) {
      this.logger.warn(
        `Instance ${created.instanceId} was created but FlareSend returned no key; ` +
          'store it with PATCH /admin/whatsapp/instances/:id/key before activating.',
      );
    } else {
      await this.store.storeApiKey(row.id, created.apiKey);
    }

    // A brand-new instance is only useful once it is the sender, so activate it
    // when it is the only one or the caller asked for it implicitly by creating.
    if (rows.length === 0) {
      await this.store.activate(row.id);
    }

    return this.store.toView(await this.store.get(row.id));
  }

  async refreshStatus(id: string): Promise<BotInstanceView> {
    const row = await this.store.get(id);
    const status = await this.callProvider('reading the instance status', () =>
      this.client.getInstanceStatus(row.providerId),
    );
    const updated = await this.store.updateStatus(
      row.id,
      this.mapStatus(status.status),
      status.phoneNumber ?? undefined,
    );
    return this.store.toView(updated);
  }

  async reconnect(id: string): Promise<BotInstanceView> {
    const row = await this.store.get(id);
    await this.callProvider('reconnecting the instance', () =>
      this.client.reconnectInstance(row.providerId),
    );
    const updated = await this.store.updateStatus(row.id, 'INITIALIZING');
    return this.store.toView(updated);
  }

  /**
   * Points an existing instance at a different WhatsApp number: drop the current
   * session, reconnect, then issue a pairing code for the new number. The
   * instance id and its key survive, so no secret rotation is needed.
   */
  async relink(
    id: string,
    phoneNumber: string,
  ): Promise<{
    instance: BotInstanceView;
    pairingCode: string | null;
    phoneNumber: string;
    next: string;
  }> {
    const row = await this.store.get(id);
    const digits = phoneNumber.replace(/[^\d]/g, '');
    if (digits.length < 8) {
      throw new BadRequestException(
        'phoneNumber must be international digits, e.g. 254713278107',
      );
    }

    await this.client.resetInstanceSession(row.providerId);
    await this.callProvider('reconnecting the instance', () =>
      this.client.reconnectInstance(row.providerId),
    );
    const pairing = await this.client.requestPairingCode(
      row.providerId,
      digits,
    );
    const updated = await this.store.updateStatus(
      row.id,
      'AWAITING_SCAN',
      digits,
    );

    return {
      instance: this.store.toView(updated),
      pairingCode: pairing.code,
      phoneNumber: digits,
      next:
        'On that phone: WhatsApp → Linked devices → Link with phone number, ' +
        'then enter the pairing code. Poll GET /admin/whatsapp/instances/:id ' +
        'until status is CONNECTED.',
    };
  }

  async pairingCode(
    id: string,
    phoneNumber?: string,
  ): Promise<{ pairingCode: string | null; status: string }> {
    const row = await this.store.get(id);
    const digits = (phoneNumber ?? row.phoneNumber ?? '').replace(/[^\d]/g, '');
    if (!digits) {
      throw new BadRequestException(
        'A phone number is required: pass phoneNumber or set it on the instance.',
      );
    }
    const pairing = await this.callProvider('requesting a pairing code', () =>
      this.client.requestPairingCode(row.providerId, digits),
    );
    return { pairingCode: pairing.code, status: row.status };
  }

  async qr(id: string): Promise<{ qr: string | null; status: string | null }> {
    const row = await this.store.get(id);
    const result = await this.callProvider('reading the instance QR', () =>
      this.client.getInstanceQr(row.providerId),
    );
    return { qr: result.qr, status: result.status ?? null };
  }

  async storeKey(id: string, apiKey: string): Promise<BotInstanceView> {
    const trimmed = (apiKey ?? '').trim();
    if (trimmed.length < 16) {
      throw new BadRequestException(
        'apiKey does not look like an instance key.',
      );
    }
    const updated = await this.store.storeApiKey(id, trimmed);
    return this.store.toView(updated);
  }

  async activate(id: string): Promise<BotInstanceView> {
    const row = await this.store.get(id);
    if (!row.apiKeyCipher) {
      throw new ConflictException(
        'This instance has no stored key. Store it with ' +
          'PATCH /admin/whatsapp/instances/:id/key first, otherwise outbound ' +
          'sends would keep using the previous instance.',
      );
    }
    const activated = await this.store.activate(row.id);
    this.logger.log(`Bot now sends from instance ${activated.providerId}.`);
    return this.store.toView(activated);
  }

  async remove(id: string): Promise<void> {
    const row = await this.store.get(id);
    try {
      await this.client.deleteInstance(row.providerId);
    } catch (error) {
      // Already gone on the provider side is fine; the local row must still go.
      this.logger.warn(
        `FlareSend delete failed for ${row.providerId} (continuing): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    await this.store.remove(id);
  }

  async setLabel(id: string, label: string | null): Promise<BotInstanceView> {
    const row = await this.store.get(id);
    const updated = await this.store.setLabel(row.id, label);
    return this.store.toView(updated);
  }

  async setWebhookUrl(
    id: string,
    webhookUrl: string | null,
  ): Promise<BotInstanceView> {
    const row = await this.store.get(id);
    const updated = await this.store.setWebhookUrl(row.id, webhookUrl);
    return this.store.toView(updated);
  }

  /** The URL to paste into the FlareSend dashboard for this environment. */
  webhookUrl(): string | null {
    const token = this.configService
      .get<string>('FLARESEND_WEBHOOK_PATH_TOKEN')
      ?.trim();
    if (!token) return null;
    const base =
      this.configService.get<string>('API_BASE_URL')?.replace(/\/+$/, '') ??
      'https://api.menodao.org';
    return `${base}/bot/webhook/flaresend/${token}`;
  }

  /**
   * Turns provider failures into an answer the dashboard can act on.
   *
   * A raw AxiosError becomes "unexpected error occurred"; operators need to
   * know whether FlareSend refused the session, the instance is gone, or the
   * provider is down. Our own HttpExceptions pass through untouched.
   */
  private async callProvider<T>(
    action: string,
    run: () => Promise<T>,
  ): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof HttpException) throw error;

      const status = axios.isAxiosError(error)
        ? error.response?.status
        : undefined;
      const payload = axios.isAxiosError(error)
        ? (error.response?.data as
            | { error?: string; message?: string }
            | undefined)
        : undefined;
      const detail =
        payload?.error ??
        payload?.message ??
        (error instanceof Error ? error.message : String(error));

      this.logger.warn(
        `FlareSend failed while ${action}: HTTP ${status ?? 'n/a'} — ${detail}`,
      );

      if (status === 404) {
        throw new NotFoundException(
          `FlareSend does not know this instance any more (${detail}). ` +
            'Sync from FlareSend to refresh the list, then link the number again.',
        );
      }
      if (status === 401 || status === 403) {
        throw new BadGatewayException(
          `FlareSend refused ${action} (HTTP ${status}). The account session ` +
            'could not be refreshed; check FLARESEND_EMAIL / FLARESEND_PASSWORD ' +
            'and the plan status in the FlareSend dashboard.',
        );
      }
      throw new BadGatewayException(
        status
          ? `FlareSend refused ${action} (HTTP ${status}): ${detail}`
          : `FlareSend did not answer while ${action}: ${detail}`,
      );
    }
  }

  private mapStatus(status?: string): string {
    if (!status) return 'UNKNOWN';
    return PROVIDER_STATUS_MAP[status.toLowerCase()] ?? status.toUpperCase();
  }

  private phoneOf(instance: Record<string, unknown>): string | null {
    const raw =
      (instance.phone_number as string | undefined) ??
      (instance.phoneNumber as string | undefined) ??
      (instance.whatsapp_user_id as string | undefined) ??
      null;
    if (!raw) return null;
    const digits = String(raw).replace(/[^\d]/g, '');
    return digits || null;
  }
}
