/* eslint-disable @typescript-eslint/require-await -- provider payloads are untyped JSON */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance, AxiosResponse } from 'axios';
import { IWhatsappClient } from './whatsapp-provider.interface';

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
}

const TOKEN_REFRESH_MARGIN_MS = 60_000;
const DEFAULT_TOKEN_TTL_SECONDS = 3_600;

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

  constructor(private readonly configService: ConfigService) {
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
    this.logger.log('FlareSend session token refreshed.');
    return token;
  }

  private async postSendMessage(
    recipient: string,
    body: string,
  ): Promise<AxiosResponse<FlaresendSendResponse>> {
    const token = await this.getBearerToken();
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
        response = await this.postSendMessage(recipient, body);
      } catch (error) {
        // The session JWT lasts an hour. If it expired between refreshes,
        // log in again and retry once before failing the send.
        if (axios.isAxiosError(error) && error.response?.status === 401) {
          this.logger.warn(
            'FlareSend rejected the bearer token; refreshing and retrying once.',
          );
          await this.getBearerToken(true);
          response = await this.postSendMessage(recipient, body);
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
      const details = axios.isAxiosError(error)
        ? `HTTP ${error.response?.status ?? 'no response'}`
        : error instanceof Error
          ? error.message
          : 'Unknown error';
      this.logger.error(
        `Failed to send FlareSend WhatsApp message to ${this.maskRecipient(recipient)}: ${details}`,
      );
      throw error;
    }
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
