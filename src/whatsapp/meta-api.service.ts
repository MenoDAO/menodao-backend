import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import * as crypto from 'crypto';

// ─── Payload interfaces ───────────────────────────────────────────────────────

export interface ButtonOption {
  id: string;
  title: string; // max 20 chars per Meta spec
}

export interface ListRow {
  id: string;
  title: string;
  description?: string;
}

export interface ListSection {
  title: string;
  rows: ListRow[];
}

export interface TemplateComponent {
  type: 'header' | 'body' | 'footer' | 'button';
  parameters?: Array<{
    type: 'text' | 'currency' | 'date_time';
    text?: string;
  }>;
}

// ─── MetaApiService ───────────────────────────────────────────────────────────

@Injectable()
export class MetaApiService {
  private readonly logger = new Logger(MetaApiService.name);
  private readonly baseUrl: string;
  private readonly phoneNumberId: string;
  private readonly accessToken: string;

  // Retry config: 3 attempts with 1s / 2s / 4s delays
  private readonly MAX_RETRIES = 3;
  private readonly RETRY_DELAYS_MS = [1000, 2000, 4000];

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    this.phoneNumberId = this.configService.get<string>(
      'WHATSAPP_PHONE_NUMBER_ID',
      '',
    );
    this.accessToken = this.configService.get<string>(
      'WHATSAPP_ACCESS_TOKEN',
      '',
    );
    this.baseUrl = `https://graph.facebook.com/v19.0/${this.phoneNumberId}`;
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  /** Send a plain text message. */
  async sendText(to: string, text: string): Promise<void> {
    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { preview_url: false, body: text },
    };
    await this.sendWithRetry(to, 'text', payload);
  }

  /**
   * Send an interactive button message (2–3 options).
   * Meta allows a maximum of 3 buttons per message.
   */
  async sendButtons(
    to: string,
    bodyText: string,
    buttons: ButtonOption[],
    headerText?: string,
    footerText?: string,
  ): Promise<void> {
    const payload: Record<string, unknown> = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'interactive',
      interactive: {
        type: 'button',
        ...(headerText && { header: { type: 'text', text: headerText } }),
        body: { text: bodyText },
        ...(footerText && { footer: { text: footerText } }),
        action: {
          buttons: buttons.map((b) => ({
            type: 'reply',
            reply: { id: b.id, title: b.title },
          })),
        },
      },
    };
    await this.sendWithRetry(to, 'buttons', payload);
  }

  /**
   * Send an interactive list message (4–10 options).
   * `buttonLabel` is the CTA text on the list-open button (max 20 chars).
   */
  async sendList(
    to: string,
    bodyText: string,
    sections: ListSection[],
    buttonLabel = 'View Options',
    headerText?: string,
    footerText?: string,
  ): Promise<void> {
    const payload: Record<string, unknown> = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'interactive',
      interactive: {
        type: 'list',
        ...(headerText && { header: { type: 'text', text: headerText } }),
        body: { text: bodyText },
        ...(footerText && { footer: { text: footerText } }),
        action: { button: buttonLabel, sections },
      },
    };
    await this.sendWithRetry(to, 'list', payload);
  }

  /**
   * Send a pre-approved template message (required outside the 24-hour window).
   * `languageCode` defaults to `'en'`; use `'sw'` for Swahili templates.
   */
  async sendTemplate(
    to: string,
    templateName: string,
    components: TemplateComponent[] = [],
    languageCode = 'en',
  ): Promise<void> {
    const payload = {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: templateName,
        language: { code: languageCode },
        components,
      },
    };
    await this.sendWithRetry(to, 'template', payload);
  }

  /**
   * Send a typing indicator ("read" + "typing_on") to signal the bot is processing.
   * Failures are swallowed — a missing indicator is non-critical.
   */
  async sendTypingIndicator(to: string): Promise<void> {
    try {
      // Mark the last message as read first (required by Meta before typing_on)
      await firstValueFrom(
        this.httpService.post(
          `${this.baseUrl}/messages`,
          {
            messaging_product: 'whatsapp',
            status: 'read',
            message_id: 'placeholder', // best-effort; real ID not always available here
          },
          this.buildHeaders(),
        ),
      );
    } catch {
      // Intentionally ignored — typing indicator is best-effort
    }

    try {
      await firstValueFrom(
        this.httpService.post(
          `${this.baseUrl}/messages`,
          {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to,
            type: 'reaction',
          },
          this.buildHeaders(),
        ),
      );
    } catch {
      // Intentionally ignored
    }
  }

  // ─── Retry logic ─────────────────────────────────────────────────────────────

  private async sendWithRetry(
    to: string,
    messageType: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const hashedPhone = this.hashPhone(to);
    let lastError: unknown;

    for (let attempt = 0; attempt < this.MAX_RETRIES; attempt++) {
      try {
        await firstValueFrom(
          this.httpService.post(
            `${this.baseUrl}/messages`,
            payload,
            this.buildHeaders(),
          ),
        );
        this.logger.log(
          `[MetaApi] Sent ${messageType} to ${hashedPhone} (attempt ${attempt + 1})`,
        );
        return; // success — exit immediately
      } catch (err: unknown) {
        lastError = err;
        const status = this.extractStatus(err);
        const isTransient = status === null || status >= 500;

        if (!isTransient) {
          // 4xx errors are permanent — no point retrying
          this.logger.error(
            `[MetaApi] Permanent error sending ${messageType} to ${hashedPhone}: HTTP ${status}`,
            this.extractBody(err),
          );
          throw err;
        }

        if (attempt < this.MAX_RETRIES - 1) {
          const delay = this.RETRY_DELAYS_MS[attempt];
          this.logger.warn(
            `[MetaApi] Transient error (attempt ${attempt + 1}/${this.MAX_RETRIES}) sending ${messageType} to ${hashedPhone}. Retrying in ${delay}ms…`,
          );
          await this.sleep(delay);
        }
      }
    }

    // All retries exhausted
    this.logger.error(
      `[MetaApi] Failed to send ${messageType} to ${hashedPhone} after ${this.MAX_RETRIES} attempts`,
      lastError instanceof Error ? lastError.message : String(lastError),
    );
    throw lastError;
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private buildHeaders() {
    return {
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
    };
  }

  /** One-way SHA-256 hash of the phone number for privacy-safe logging. */
  private hashPhone(phone: string): string {
    return crypto.createHash('sha256').update(phone).digest('hex').slice(0, 12);
  }

  private extractStatus(err: unknown): number | null {
    if (err && typeof err === 'object' && 'response' in err) {
      const response = (err as { response?: { status?: number } }).response;
      return response?.status ?? null;
    }
    return null;
  }

  private extractBody(err: unknown): string {
    if (err && typeof err === 'object' && 'response' in err) {
      const response = (err as { response?: { data?: unknown } }).response;
      return JSON.stringify(response?.data ?? {});
    }
    return '';
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
