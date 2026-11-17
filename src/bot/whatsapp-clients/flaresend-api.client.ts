/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return -- provider payloads are untyped JSON */
import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance, AxiosResponse } from 'axios';
import { IWhatsappClient } from './whatsapp-provider.interface';
import { BotInstanceStore } from '../instances/bot-instance.store';

interface FlaresendSendResponse {
  success?: boolean;
  failed_recipients?: string[];
  invalid_recipients?: string[];
}

interface FlaresendLoginResponse {
  success?: boolean;
  /** Current API returns the session JWT here. */
  apiKey?: string;
  /** Older docs call the same value access_token. */
  access_token?: string;
  expires_in?: number;
  subscription?: FlaresendSubscription;
}

export interface FlaresendSubscriptionPlan {
  id?: number;
  name?: string;
  maxInstances?: number;
  maxApiCalls?: number;
}

export interface FlaresendSubscription {
  id?: number;
  status?: string;
  startsAt?: string;
  endsAt?: string;
  plan?: FlaresendSubscriptionPlan;
}

export interface FlaresendInstanceSummary {
  id: string;
  status?: string;
  phone_number?: string | null;
  phoneNumber?: string | null;
  whatsapp_user_id?: string | null;
  user_jid?: string | null;
  name?: string | null;
  connected_at?: string | null;
  disconnected_at?: string | null;
  created_at?: string | null;
  [key: string]: unknown;
}

const TOKEN_REFRESH_MARGIN_MS = 60_000;
const DEFAULT_TOKEN_TTL_SECONDS = 3_600;
/**
 * WhatsApp session operations wait on the phone/provider bridge, which is much
 * slower than an ordinary REST call (and slower still right after a reset).
 * The generic 15s timeout turned a slow-but-healthy pairing into a 504.
 */
const SESSION_TIMEOUT_MS = 30_000;
const PAIRING_TIMEOUT_MS = 45_000;
/** Status polling runs on a timer; do not let one hung check stall the page. */
const STATUS_TIMEOUT_MS = 6_000;

@Injectable()
export class FlaresendApiClient implements IWhatsappClient {
  private readonly logger = new Logger(FlaresendApiClient.name);
  private readonly http: AxiosInstance;
  private readonly loginHttp: AxiosInstance;
  private readonly apiKey: string;
  private readonly email: string;
  private readonly password: string;
  private readonly baseUrl: string;

  private bearerToken: string | null = null;
  private bearerExpiresAt = 0;
  private loginInFlight: Promise<string> | null = null;
  private subscription: FlaresendSubscription | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly instanceStore: BotInstanceStore,
  ) {
    this.baseUrl =
      this.configService.get<string>('FLARESEND_BASE_URL') ??
      'https://api.flaresend.com';
    this.apiKey = this.configService.get<string>('FLARESEND_API_KEY') ?? '';
    this.email = this.configService.get<string>('FLARESEND_EMAIL') ?? '';
    this.password = this.configService.get<string>('FLARESEND_PASSWORD') ?? '';

    this.http = axios.create({
      baseURL: this.baseUrl,
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    });

    // The dashboard's 64-char key is an account key for the `api-key` header
    // on /login, not a bearer token. Only a JWT can be sent as Bearer.
    this.loginHttp = axios.create({
      baseURL: this.baseUrl,
      headers: {
        'Content-Type': 'application/json',
        ...(this.apiKey ? { 'api-key': this.apiKey } : {}),
      },
      timeout: 15000,
    });

    if (this.looksLikeJwt(this.apiKey)) {
      this.bearerToken = this.apiKey;
      this.bearerExpiresAt = this.jwtExpiresAt(this.apiKey);
    }
  }

  /**
   * Cleans a phone number / JID into pure international digits without '+' or '@s.whatsapp.net'
   * e.g., "254712345678@s.whatsapp.net" or "+254712345678" -> "254712345678"
   */
  private formatRecipient(to: string): string {
    return to
      .replace(/@s\.whatsapp\.net$/i, '')
      .replace(/@g\.us$/i, '')
      .replace(/[^\d]/g, '');
  }

  private maskRecipient(recipient: string): string {
    return `***${recipient.slice(-4)}`;
  }

  private looksLikeJwt(value: string): boolean {
    return /^eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/.test(value);
  }

  private jwtExpiresAt(token: string): number {
    try {
      const payload = JSON.parse(
        Buffer.from(token.split('.')[1], 'base64url').toString('utf8'),
      ) as { exp?: number };
      return typeof payload.exp === 'number' ? payload.exp * 1000 : 0;
    } catch {
      return 0;
    }
  }

  private async getBearerToken(forceRefresh = false): Promise<string> {
    if (
      !forceRefresh &&
      this.bearerToken &&
      this.bearerExpiresAt - Date.now() > TOKEN_REFRESH_MARGIN_MS
    ) {
      return this.bearerToken;
    }

    // Collapse concurrent refreshes into one login call.
    if (!this.loginInFlight) {
      this.loginInFlight = this.login().finally(() => {
        this.loginInFlight = null;
      });
    }

    return this.loginInFlight;
  }

  private async login(): Promise<string> {
    if (!this.email || !this.password) {
      throw new Error(
        'FlareSend credentials are not configured: set FLARESEND_EMAIL and FLARESEND_PASSWORD, or provide a JWT in FLARESEND_API_KEY.',
      );
    }

    const response = await this.loginHttp.post<FlaresendLoginResponse>(
      '/login',
      {
        email: this.email,
        password: this.password,
      },
    );

    const token = response.data?.apiKey ?? response.data?.access_token;
    if (!token) {
      throw new Error('FlareSend login did not return a bearer token.');
    }

    const jwtExpiry = this.jwtExpiresAt(token);
    const ttlMs =
      typeof response.data?.expires_in === 'number' &&
      response.data.expires_in > 0
        ? response.data.expires_in * 1000
        : jwtExpiry > Date.now()
          ? jwtExpiry - Date.now()
          : DEFAULT_TOKEN_TTL_SECONDS * 1000;

    this.bearerToken = token;
    this.bearerExpiresAt = Date.now() + ttlMs;
    if (response.data?.subscription) {
      this.subscription = response.data.subscription;
    }
    this.logger.log('FlareSend session token refreshed.');
    return token;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Account-level instance management (session JWT, not the instance key)
  // ───────────────────────────────────────────────────────────────────────────

  private async accountHeaders(): Promise<Record<string, string>> {
    return { Authorization: `Bearer ${await this.getBearerToken()}` };
  }

  private isUnauthorized(error: unknown): boolean {
    return axios.isAxiosError(error) && error.response?.status === 401;
  }

  /**
   * Runs an account-level call with the session JWT.
   *
   * FlareSend can invalidate a session while its `exp` is still in the future
   * (plan rollover, password change, session limits), so a cached token that
   * looks fresh may already be dead. On a 401 we log in again once and retry
   * instead of surfacing an opaque 500 to the dashboard.
   */
  private async accountRequest<T>(
    run: (headers: Record<string, string>) => Promise<T>,
    action: string,
  ): Promise<T> {
    try {
      return await run(await this.accountHeaders());
    } catch (error) {
      if (!this.isUnauthorized(error)) throw error;

      this.logger.warn(
        `FlareSend rejected the session during ${action}; retrying with a fresh login.`,
      );
      this.bearerToken = null;
      this.bearerExpiresAt = 0;

      try {
        const token = await this.getBearerToken(true);
        return await run({ Authorization: `Bearer ${token}` });
      } catch (retryError) {
        if (!this.isUnauthorized(retryError)) throw retryError;
        throw new ServiceUnavailableException(
          'FlareSend rejected the account session twice while ' +
            `${action}. Check FLARESEND_EMAIL / FLARESEND_PASSWORD and that ` +
            'the subscription is still active in the FlareSend dashboard.',
        );
      }
    }
  }

  /** Plan limits ride along on the login response. */
  async getSubscription(): Promise<FlaresendSubscription | null> {
    try {
      await this.getBearerToken();
    } catch (error) {
      this.logger.warn(
        `Cannot read the FlareSend subscription: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
    return this.subscription;
  }

  async listInstances(): Promise<FlaresendInstanceSummary[]> {
    const response = await this.accountRequest(
      (headers) =>
        this.http.get<{ instances?: FlaresendInstanceSummary[] }>(
          '/instances',
          {
            headers,
          },
        ),
      'listing instances',
    );
    return response.data?.instances ?? [];
  }

  async getInstance(id: string): Promise<Record<string, unknown>> {
    const response = await this.accountRequest(
      (headers) => this.http.get(`/instances/${id}`, { headers }),
      'reading an instance',
    );
    return response.data;
  }

  async getInstanceStatus(id: string): Promise<{
    status?: string;
    phoneNumber?: string | null;
  }> {
    const response = await this.accountRequest(
      (headers) =>
        this.http.get<Record<string, any>>(`/instances/${id}/status`, {
          headers,
          timeout: STATUS_TIMEOUT_MS,
        }),
      'reading the instance status',
    );
    const data = response.data ?? {};
    return {
      status: typeof data.status === 'string' ? data.status : undefined,
      phoneNumber: this.phoneFromStatus(data),
    };
  }

  /**
   * The status payload calls the linked number `whatsappUserId`
   * ("254765440035:6@s.whatsapp.net"); other shapes use phone_number or a JID.
   * Only the leading country-code digits are the number.
   */
  private phoneFromStatus(data: Record<string, any>): string | null {
    const raw =
      data.phoneNumber ??
      data.phone_number ??
      data.whatsappUserId ??
      data.whatsapp_user_id ??
      data.userJid ??
      data.user_jid ??
      null;
    if (!raw) return null;
    const match = String(raw).match(/^\+?(\d{6,})/);
    return match ? match[1] : null;
  }

  /** Creates an instance. The instance-scoped key is only returned here. */
  async createInstance(name?: string): Promise<{
    instanceId: string;
    apiKey: string | null;
    raw: Record<string, unknown>;
  }> {
    const response = await this.accountRequest(
      (headers) =>
        this.http.post<Record<string, any>>(
          '/instances',
          name ? { name } : {},
          { headers },
        ),
      'creating an instance',
    );
    const data = response.data ?? {};
    const instanceId =
      data.instance?.id ?? data.id ?? data.instanceId ?? data.instance_id;
    const apiKey =
      data.apiKey ??
      data.api_key ??
      data.instance?.apiKey ??
      data.instance?.api_key ??
      data.key ??
      null;
    if (!instanceId) {
      throw new Error(
        'FlareSend did not return an instance id when creating the instance.',
      );
    }
    return {
      instanceId: String(instanceId),
      apiKey: apiKey ? String(apiKey) : null,
      raw: data,
    };
  }

  async reconnectInstance(id: string): Promise<Record<string, unknown>> {
    const response = await this.accountRequest(
      (headers) =>
        this.http.post(
          `/instances/${id}/reconnect`,
          {},
          { headers, timeout: SESSION_TIMEOUT_MS },
        ),
      'reconnecting the instance',
    );
    return response.data ?? {};
  }

  /** Drops the WhatsApp session but keeps the instance and its key. */
  async resetInstanceSession(id: string): Promise<Record<string, unknown>> {
    const response = await this.accountRequest(
      (headers) =>
        this.http.post(
          `/instances/${id}/reset-session`,
          {},
          { headers, timeout: SESSION_TIMEOUT_MS },
        ),
      'resetting the instance session',
    );
    return response.data ?? {};
  }

  async deleteInstance(id: string): Promise<void> {
    await this.accountRequest(
      (headers) => this.http.delete(`/instances/${id}`, { headers }),
      'deleting the instance',
    );
  }

  async requestPairingCode(
    id: string,
    phoneNumber: string,
  ): Promise<{ code: string | null; raw: Record<string, unknown> }> {
    const response = await this.accountRequest(
      (headers) =>
        this.http.post<Record<string, any>>(
          `/instances/${id}/pairing-code`,
          { phone_number: phoneNumber },
          { headers, timeout: PAIRING_TIMEOUT_MS },
        ),
      'requesting a pairing code',
    );
    const data = response.data ?? {};
    const code =
      data.pairingCode ?? data.pairing_code ?? data.code ?? data.pairingCode;
    return { code: code ? String(code) : null, raw: data };
  }

  /** Raw QR payload. Render it with any QR encoder; the payload rotates. */
  async getInstanceQr(id: string): Promise<{
    status?: string;
    qr: string | null;
  }> {
    const response = await this.accountRequest(
      (headers) =>
        this.http.get<{ status?: string; qr?: string }>(`/instances/${id}/qr`, {
          headers,
        }),
      'reading the instance QR',
    );
    return {
      status: response.data?.status,
      qr: response.data?.qr ?? null,
    };
  }

  private async postSendMessage(
    recipient: string,
    body: string,
    token: string,
  ): Promise<AxiosResponse<FlaresendSendResponse>> {
    // /send-message requires an instance-scoped key. The dashboard's 64-char
    // key is exactly that, so prefer it and only fall back to a session JWT.
    return this.http.post<FlaresendSendResponse>(
      '/send-message',
      {
        recipients: [recipient],
        type: 'text',
        text: body,
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    );
  }

  private async resolveSendToken(): Promise<string> {
    // The instance activated in the dashboard wins; the environment key is the
    // fallback so a fresh deploy keeps sending before anyone activates one.
    const credentials = await this.instanceStore.getSendCredentials();
    if (credentials?.apiKey) return credentials.apiKey;
    if (this.apiKey) return this.apiKey;
    return this.getBearerToken();
  }

  /**
   * Sends a plain text message to a WhatsApp user via the FlareSend API.
   * Endpoint: POST /send-message
   */
  async sendTextMessage(to: string, body: string): Promise<void> {
    const recipient = this.formatRecipient(to);

    if (!recipient) {
      this.logger.error('Cannot send message: invalid recipient phone.');
      throw new Error('Invalid recipient phone.');
    }

    try {
      let response: AxiosResponse<FlaresendSendResponse>;
      try {
        response = await this.postSendMessage(
          recipient,
          body,
          await this.resolveSendToken(),
        );
      } catch (error) {
        // The configured key was rejected as a bearer token. Retry once with a
        // freshly minted session JWT so a rotated/expired key cannot wedge
        // every outbound message.
        if (axios.isAxiosError(error) && error.response?.status === 401) {
          this.logger.warn(
            'FlareSend rejected the instance key; retrying with a session token.',
          );
          response = await this.postSendMessage(
            recipient,
            body,
            await this.getBearerToken(true),
          );
        } else {
          throw error;
        }
      }

      const data = response.data;
      const matchesRecipient = (entries: string[] | undefined) =>
        entries?.some((entry) => this.formatRecipient(entry) === recipient) ??
        false;

      if (matchesRecipient(data?.invalid_recipients)) {
        this.logger.warn(
          `FlareSend recipient ${this.maskRecipient(recipient)} is not registered on WhatsApp.`,
        );
        throw new Error('Recipient is not registered on WhatsApp.');
      }

      if (matchesRecipient(data?.failed_recipients)) {
        this.logger.error(
          `FlareSend message delivery failed for ${this.maskRecipient(recipient)}.`,
        );
        throw new Error('WhatsApp message delivery failed.');
      }

      if (data?.success !== true) {
        throw new Error('FlareSend did not confirm the message was sent.');
      }

      this.logger.log(
        `FlareSend sent a text message to ${this.maskRecipient(recipient)}.`,
      );
    } catch (error) {
      const details = this.describeSendFailure(error);
      this.logger.error(
        `Failed to send FlareSend WhatsApp message to ${this.maskRecipient(recipient)}: ${details}`,
      );
      throw error;
    }
  }

  /** Turns FlareSend error responses into an actionable operator message. */
  private describeSendFailure(error: unknown): string {
    if (!axios.isAxiosError(error)) {
      return error instanceof Error ? error.message : 'Unknown error';
    }
    const status = error.response?.status;
    const apiMessage =
      (error.response?.data as { message?: string } | undefined)?.message ?? '';
    if (status === 425) {
      return `instance not connected to WhatsApp yet (${
        apiMessage || 'scan the QR code or link the number'
      })`;
    }
    if (status === 400 && /instance-scoped/i.test(apiMessage)) {
      return 'FLARESEND_API_KEY must be an instance-scoped key (FlareSend dashboard → Your WhatsApp Instances)';
    }
    if (status === 401) {
      return `bearer token rejected (${apiMessage || 'check FLARESEND_API_KEY'})`;
    }
    return `HTTP ${status ?? 'no response'}${
      apiMessage ? `: ${apiMessage}` : ''
    }`;
  }

  /**
   * Marks an inbound message as read.
   * FlareSend handles session state internally or does not expose a mark-as-read endpoint.
   */
  async markMessageAsRead(messageId: string): Promise<void> {
    this.logger.debug(
      `FlareSend does not require manual mark-as-read for message ${messageId}.`,
    );
  }

  /**
   * FlareSend API does not currently expose an endpoint to download inbound media.
   */
  async downloadMedia(mediaId: string): Promise<Buffer> {
    const errorMsg = `Media download is not supported by FlareSend API for media ID: ${mediaId}.`;
    this.logger.warn(errorMsg);
    throw new Error(errorMsg);
  }
}
