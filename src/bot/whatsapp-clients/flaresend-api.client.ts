/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return -- provider payloads are untyped JSON */
import { createDecipheriv, createHmac, hkdfSync } from 'crypto';
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

  /**
   * Media downloads are instance-scoped. Try the configured instance key first
   * and the account session JWT second, because different FlareSend versions
   * accept one or the other on their media endpoint.
   */
  private async mediaHeaderCandidates(): Promise<Array<Record<string, string>>> {
    const candidates: Array<Record<string, string>> = [];
    try {
      const token = await this.resolveSendToken();
      if (token) candidates.push({ Authorization: `Bearer ${token}` });
    } catch {
      /* fall through to the account session */
    }
    try {
      const session = await this.accountHeaders();
      if (!candidates.some((item) => item.Authorization === session.Authorization)) {
        candidates.push(session);
      }
    } catch {
      /* the first candidate may still work */
    }
    return candidates.length ? candidates : [{}];
  }

  private async getWithMediaHeaders(
    url: string,
    timeout = 30_000,
  ): Promise<AxiosResponse<ArrayBuffer> | null> {
    for (const headers of await this.mediaHeaderCandidates()) {
      try {
        return await axios.get<ArrayBuffer>(url, {
          responseType: 'arraybuffer',
          timeout,
          maxContentLength: 30 * 1024 * 1024,
          headers,
        });
      } catch (error) {
        const status = axios.isAxiosError(error) ? error.response?.status : undefined;
        if (status === 401 || status === 403) continue;
        throw error;
      }
    }
    return null;
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

  private looksLikeTextPayload(buffer: Buffer): boolean {
    const head = buffer.subarray(0, 96).toString('utf8').trimStart().toLowerCase();
    return head.startsWith('{') || head.startsWith('[') || head.startsWith('<');
  }

  private whatsappMediaInfo(mimeType: string): string {
    const mime = (mimeType || '').toLowerCase();
    if (mime.startsWith('image/')) return 'WhatsApp Image Keys';
    if (mime.startsWith('video/')) return 'WhatsApp Video Keys';
    if (mime.startsWith('audio/')) return 'WhatsApp Audio Keys';
    return 'WhatsApp Document Keys';
  }

  /**
   * WhatsApp CDN media is encrypted. If the descriptor carries a mediaKey
   * (Baileys-style), decrypt before handing to STT/vision.
   */
  private maybeDecryptWhatsappMedia(
    buffer: Buffer,
    descriptor: Record<string, any>,
    mimeType: string,
  ): Buffer {
    const mediaKeyRaw = descriptor?.mediaKey ?? descriptor?.mediakey;
    if (!mediaKeyRaw) {
      const keys = Object.keys(descriptor || {})
        .filter((k) => /key|enc|sha256|direct/i.test(k))
        .slice(0, 2)
        .join('+')
        .slice(0, 16);
      (buffer as any)._waDecrypt = keys ? `no-key-${keys}` : 'no-key';
      return buffer;
    }
    try {
      const mediaKey = Buffer.isBuffer(mediaKeyRaw)
        ? mediaKeyRaw
        : Array.isArray(mediaKeyRaw)
          ? Buffer.from(mediaKeyRaw)
          : typeof mediaKeyRaw === 'object' && mediaKeyRaw?.type === 'Buffer'
            ? Buffer.from(mediaKeyRaw.data)
            : Buffer.from(
                String(mediaKeyRaw)
                  .replace(/-/g, '+')
                  .replace(/_/g, '/')
                  .replace(/\s/g, ''),
                'base64',
              );
      if (mediaKey.length !== 32) {
        (buffer as any)._waDecrypt = `bad-keylen-${mediaKey.length}`;
        return buffer;
      }
      const info = this.whatsappMediaInfo(mimeType);
      const expanded = Buffer.from(
        hkdfSync('sha256', mediaKey, Buffer.alloc(0), info, 112),
      );
      if (buffer.length <= 10) return buffer;
      const file = buffer.subarray(0, buffer.length - 10);
      const mac = buffer.subarray(buffer.length - 10);
      const layouts = [
        { iv: [0, 16], cipherKey: [16, 48], macKey: [48, 80] },
        { iv: [0, 16], cipherKey: [32, 64], macKey: [64, 96] },
      ] as const;
      const tryDecrypt = (layout: (typeof layouts)[number]) => {
        const iv = expanded.subarray(layout.iv[0], layout.iv[1]);
        const cipherKey = expanded.subarray(
          layout.cipherKey[0],
          layout.cipherKey[1],
        );
        const macKey = expanded.subarray(layout.macKey[0], layout.macKey[1]);
        const expectedMacIv = createHmac('sha256', macKey)
          .update(Buffer.concat([iv, file]))
          .digest()
          .subarray(0, 10);
        const expectedMacNoIv = createHmac('sha256', macKey)
          .update(file)
          .digest()
          .subarray(0, 10);
        const macOk = mac.equals(expectedMacIv) || mac.equals(expectedMacNoIv);
        const decipher = createDecipheriv('aes-256-cbc', cipherKey, iv);
        const decrypted = Buffer.concat([decipher.update(file), decipher.final()]);
        return { decrypted, macOk };
      };
      const hasAudioMagic = (buf: Buffer) => {
        const head = buf.subarray(0, 16).toString('hex');
        return (
          buf.length > 4 &&
          (head.startsWith('4f676753') ||
            head.startsWith('52494646') ||
            head.startsWith('494433') ||
            head.startsWith('664c6143') ||
            head.startsWith('1a45dfa3') ||
            head.startsWith('2321414d52') ||
            (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) ||
            buf.subarray(4, 8).toString('hex') === '66747970')
        );
      };
      for (const layout of layouts) {
        try {
          const { decrypted, macOk } = tryDecrypt(layout);
          if (macOk || hasAudioMagic(decrypted)) {
            if (!macOk) {
              this.logger.warn(
                'WhatsApp media MAC mismatch but decrypted audio looks valid; accepting',
              );
            }
            return decrypted;
          }
        } catch {
          // try next layout
        }
      }
      // Last resort: return first-layout decrypt if it produced bytes, else original
      try {
        const { decrypted } = tryDecrypt(layouts[0]);
        if (decrypted.length > 0) {
          this.logger.warn(
            'WhatsApp media MAC mismatch; returning decrypted bytes as last resort',
          );
          (decrypted as any)._waDecrypt = 'mac-mismatch-decrypted';
          return decrypted;
        }
      } catch {
        // ignore
      }
      this.logger.warn('WhatsApp media MAC mismatch; using original buffer');
      (buffer as any)._waDecrypt = 'mac-mismatch';
      return buffer;
    } catch (error) {
      this.logger.warn(
        `WhatsApp media decrypt failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      (buffer as any)._waDecrypt = 'error';
      return buffer;
    }
  }

  private async resolveDownloadedBuffer(
    buffer: Buffer,
    contentType: string | undefined,
    expectedMimeType: string,
    descriptor: Record<string, any> = {},
  ): Promise<{ buffer: Buffer; mimeType: string } | null> {
    const mime = (contentType || '').split(';')[0].trim().toLowerCase();
    const declaredMime = expectedMimeType.split(';')[0].trim().toLowerCase();
    // The CDN can label encrypted voice notes as generic binary. The audio
    // descriptor determines which WhatsApp keys were used to encrypt them.
    const audioMime = declaredMime.startsWith('audio/') ? declaredMime : null;
    const isTextLike =
      mime.includes('json') ||
      mime.startsWith('text/') ||
      this.looksLikeTextPayload(buffer);
    if (!isTextLike) {
      const out = this.maybeDecryptWhatsappMedia(
        buffer,
        descriptor,
        audioMime ?? (mime || expectedMimeType),
      );
      const waStatus = (out as any)._waDecrypt;
      if (
        waStatus === 'mac-mismatch' ||
        waStatus === 'mac-mismatch-decrypted' ||
        waStatus === 'error'
      ) {
        const head = out.subarray(0, 16).toString('hex');
        const hasKnownAudioMagic =
          out.length > 4 &&
          (head.startsWith('4f676753') ||
            head.startsWith('52494646') ||
            head.startsWith('494433') ||
            head.startsWith('664c6143') ||
            head.startsWith('1a45dfa3') ||
            head.startsWith('2321414d52') ||
            (out[0] === 0xff && (out[1] & 0xe0) === 0xe0) ||
            out.subarray(4, 8).toString('hex') === '66747970');
        if (!hasKnownAudioMagic) return null;
      }
      return { buffer: out, mimeType: audioMime ?? (mime || expectedMimeType) };
    }

    // Some FlareSend endpoints return JSON containing a signed URL or base64.
    try {
      const parsed = JSON.parse(buffer.toString('utf8'));
      const obj =
        parsed && typeof parsed === 'object'
          ? ((parsed.data && typeof parsed.data === 'object' ? parsed.data : parsed) as Record<
              string,
              any
            >)
          : null;
      if (!obj) return null;
      const url = [
        obj.url,
        obj.mediaUrl,
        obj.downloadUrl,
        obj.fileUrl,
        obj.signedUrl,
        obj.link,
      ].find((v): v is string => typeof v === 'string' && /^https?:\/\//i.test(v));
      if (url && this.isSafeMediaUrl(url)) {
        const resp = this.isOwnBaseUrl(url)
          ? await this.getWithMediaHeaders(url)
          : await axios.get<ArrayBuffer>(url, {
              responseType: 'arraybuffer',
              timeout: 30_000,
              maxContentLength: 30 * 1024 * 1024,
            });
        const b = resp ? Buffer.from(resp.data) : Buffer.alloc(0);
        if (b.length > 0 && !this.looksLikeTextPayload(b)) {
          const mime =
            audioMime ??
            ((resp?.headers['content-type'] as string | undefined)?.split(';')[0] ||
              expectedMimeType);
          return {
            buffer: this.maybeDecryptWhatsappMedia(b, descriptor, mime),
            mimeType: mime,
          };
        }
      }
      const base64Value = [obj.base64, obj.data, obj.file, obj.media].find(
        (v): v is string => typeof v === 'string' && v.length > 32 && !/^https?:\/\//i.test(v),
      );
      if (base64Value) {
        const cleaned = base64Value.includes(',')
          ? base64Value.slice(base64Value.indexOf(',') + 1)
          : base64Value;
        const b = Buffer.from(cleaned.replace(/\s/g, ''), 'base64');
        if (b.length > 0) {
          const mime =
            audioMime ??
            ((typeof obj.mimetype === 'string' && obj.mimetype) ||
              (typeof obj.mimeType === 'string' && obj.mimeType) ||
              expectedMimeType);
          return {
            buffer: this.maybeDecryptWhatsappMedia(b, descriptor, mime),
            mimeType: mime,
          };
        }
      }
    } catch {
      return null;
    }
    return null;
  }

  /**
   * Downloads inbound media using any of the shapes FlareSend/Baileys payloads
   * use in practice: a signed URL, inline base64, or a media id that can be
   * fetched from the authenticated API. We try all three rather than guessing
   * which one a particular webhook version exposes.
   */
  async downloadMediaDescriptor(
    descriptor: any,
    fallbackMediaId?: string,
    expectedMimeType?: string,
  ): Promise<{
    buffer: Buffer;
    mimeType: string;
    originalFilename?: string;
  } | null> {
    if (!descriptor || typeof descriptor !== 'object') return null;
    const mimeType =
      (typeof descriptor.mimetype === 'string' && descriptor.mimetype) ||
      (typeof descriptor.mimeType === 'string' && descriptor.mimeType) ||
      expectedMimeType ||
      'application/octet-stream';

    const candidateIds = [
      descriptor.id,
      descriptor.mediaId,
      descriptor.media_id,
      descriptor.fileId,
      descriptor.file_id,
      fallbackMediaId,
    ].filter((value): value is string => typeof value === 'string' && Boolean(value.trim()));

    const base64Value = [
      descriptor.base64,
      descriptor.data,
      descriptor.file,
      descriptor.fileBase64,
      descriptor.media,
    ].find(
      (value) =>
        typeof value === 'string' && value.trim().length > 0 && !/^https?:\/\//i.test(value.trim()),
    ) as string | undefined;
    if (base64Value) {
      try {
        const cleaned = base64Value.includes(',')
          ? base64Value.slice(base64Value.indexOf(',') + 1)
          : base64Value;
        const buffer = Buffer.from(cleaned.replace(/\s/g, ''), 'base64');
        if (buffer.length > 0) {
          return {
            buffer,
            mimeType,
            originalFilename: this.mediaFilename(descriptor, mimeType),
          };
        }
      } catch (error) {
        this.logger.warn(
          `Invalid inline base64 media: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    const rawUrls = [
      descriptor.url,
      descriptor.mediaUrl,
      descriptor.media_url,
      descriptor.downloadUrl,
      descriptor.download_url,
      descriptor.link,
      descriptor.fileUrl,
      descriptor.signedUrl,
      descriptor.directPath,
      descriptor.file?.url,
      descriptor.media?.url,
      descriptor.audio?.url,
    ];
    const candidateUrls = [
      ...new Set(
        rawUrls
          .filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))
          .map((value) => {
            const trimmed = value.trim();
            if (trimmed.startsWith('/')) {
              try {
                return new URL(trimmed, 'https://mmg.whatsapp.net').toString();
              } catch {
                return trimmed;
              }
            }
            return trimmed;
          })
          .filter((value) => /^https?:\/\//i.test(value)),
      ),
    ];

    for (const url of candidateUrls) {
      if (!this.isSafeMediaUrl(url)) {
        this.logger.warn('Rejected an unsafe FlareSend media URL.');
        continue;
      }
      try {
        const response = this.isOwnBaseUrl(url)
          ? await this.getWithMediaHeaders(url)
          : await axios.get<ArrayBuffer>(url, {
              responseType: 'arraybuffer',
              timeout: 30_000,
              maxContentLength: 30 * 1024 * 1024,
            });
        const buffer = response ? Buffer.from(response.data) : Buffer.alloc(0);
        if (buffer.length > 0) {
          const resolved = await this.resolveDownloadedBuffer(
            buffer,
            response?.headers['content-type'] as string | undefined,
            mimeType,
            descriptor,
          );
          if (resolved) {
            return {
              buffer: resolved.buffer,
              mimeType: resolved.mimeType || mimeType,
              originalFilename: this.mediaFilename(descriptor, mimeType),
            };
          }
        }
      } catch (error) {
        this.logger.warn(
          `FlareSend media URL download failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    for (const mediaId of candidateIds) {
      for (const path of this.mediaDownloadPaths()) {
        try {
          const url = new URL(path.replace('{id}', encodeURIComponent(mediaId)), this.baseUrl).toString();
          const response = await this.getWithMediaHeaders(url);
          const buffer = response ? Buffer.from(response.data) : Buffer.alloc(0);
          if (buffer.length > 0) {
            const resolved = await this.resolveDownloadedBuffer(
              buffer,
              response?.headers['content-type'] as string | undefined,
              mimeType,
              descriptor,
            );
            if (resolved) {
              return {
                buffer: resolved.buffer,
                mimeType: resolved.mimeType || mimeType,
                originalFilename: this.mediaFilename(descriptor, mimeType),
              };
            }
          }
        } catch (error) {
          this.logger.debug(
            `FlareSend media endpoint ${path} failed for ${mediaId.slice(0, 8)}…: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
    }
    return null;
  }

  /** Backwards-compatible wrapper for consumers that only have a media id. */
  async downloadMedia(mediaId: string): Promise<Buffer> {
    const result = await this.downloadMediaDescriptor(
      { id: mediaId, mimetype: 'application/octet-stream' },
      mediaId,
    );
    if (!result) {
      throw new Error(`Could not download FlareSend media ${mediaId}.`);
    }
    return result.buffer;
  }

  private mediaDownloadPaths(): string[] {
    const configured = this.configService
      .get<string>('FLARESEND_MEDIA_DOWNLOAD_PATHS')
      ?.split(',')
      .map((path) => path.trim())
      .filter(Boolean);
    return configured?.length
      ? configured
      : [
          '/media/{id}',
          '/download-media/{id}',
          '/media/download/{id}',
          '/download/{id}',
          '/get-media/{id}',
          '/files/{id}',
        ];
  }

  private isOwnBaseUrl(url: string): boolean {
    try {
      return new URL(url).host === new URL(this.baseUrl).host;
    } catch {
      return false;
    }
  }

  /** Blocks loopback/link-local/private targets even with a valid webhook token. */
  private isSafeMediaUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
      const host = parsed.hostname.toLowerCase();
      return !(
        host === 'localhost' ||
        host === '0.0.0.0' ||
        host === '::1' ||
        host.endsWith('.localhost') ||
        host.endsWith('.local') ||
        /^10\./.test(host) ||
        /^192\.168\./.test(host) ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
        /^127\./.test(host) ||
        /^169\.254\./.test(host)
      );
    } catch {
      return false;
    }
  }

  private mediaFilename(descriptor: any, mimeType: string): string {
    const candidate =
      descriptor.fileName ||
      descriptor.filename ||
      descriptor.name ||
      descriptor.fileNameFromClient;
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
    const extension = mimeType.split('/')[1]?.replace(/[^a-z0-9]/gi, '') || 'bin';
    return `field-upload.${extension}`;
  }
}
