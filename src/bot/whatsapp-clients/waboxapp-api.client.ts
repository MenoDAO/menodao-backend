/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/require-await -- provider payloads are untyped JSON */
import { randomUUID } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import { IWhatsappClient } from './whatsapp-provider.interface';

interface WaboxappSendResponse {
  success?: boolean;
}

const OUTBOUND_ECHO_TTL_MS = 60_000;
const MAX_TRACKED_OUTBOUND_MESSAGES = 1_000;

@Injectable()
export class WaboxappApiClient implements IWhatsappClient {
  private readonly logger = new Logger(WaboxappApiClient.name);
  private readonly http: AxiosInstance;
  private readonly apiToken: string;
  private readonly accountPhoneNumber: string;
  private readonly recentOutboundMessages = new Map<string, number>();

  constructor(private readonly configService: ConfigService) {
    this.apiToken = this.configService.get<string>('WABOXAPP_API_TOKEN') ?? '';
    this.accountPhoneNumber =
      this.configService.get<string>('WABOXAPP_PHONE_NUMBER') ?? '';

    this.http = axios.create({
      baseURL:
        this.configService.get<string>('WABOXAPP_BASE_URL') ??
        'https://www.waboxapp.com/api',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      timeout: 15000,
    });
  }

  private formatPhoneNumber(phone: string): string {
    return phone
      .replace(/@s\.whatsapp\.net$/i, '')
      .replace(/@g\.us$/i, '')
      .replace(/[^\d]/g, '');
  }

  private maskPhoneNumber(phone: string): string {
    return `***${phone.slice(-4)}`;
  }

  private redactRequestData(details: string, message: string): string {
    let redacted = details.split(this.apiToken).join('[TOKEN REDACTED]');
    if (message) {
      redacted = redacted.split(message).join('[MESSAGE REDACTED]');
    }
    return redacted;
  }

  private getOutboundMessageKey(to: string, body: string): string {
    return `${this.formatPhoneNumber(to)}:${body}`;
  }

  private pruneRecentOutboundMessages(now: number): void {
    for (const [key, expiresAt] of this.recentOutboundMessages) {
      if (expiresAt <= now) {
        this.recentOutboundMessages.delete(key);
      }
    }

    while (this.recentOutboundMessages.size >= MAX_TRACKED_OUTBOUND_MESSAGES) {
      const oldestKey = this.recentOutboundMessages.keys().next().value;
      if (oldestKey === undefined) {
        return;
      }
      this.recentOutboundMessages.delete(oldestKey);
    }
  }

  isRecentlySentTextMessage(to: string, body: string): boolean {
    const now = Date.now();
    this.pruneRecentOutboundMessages(now);
    return (
      (this.recentOutboundMessages.get(this.getOutboundMessageKey(to, body)) ??
        0) > now
    );
  }

  async sendTextMessage(to: string, body: string): Promise<void> {
    const recipient = this.formatPhoneNumber(to);
    const accountPhoneNumber = this.formatPhoneNumber(this.accountPhoneNumber);

    if (!this.apiToken) {
      this.logger.error(
        'Cannot send Waboxapp message: API token is not configured.',
      );
      throw new Error('WABOXAPP_API_TOKEN is not configured.');
    }

    if (!accountPhoneNumber) {
      this.logger.error(
        'Cannot send Waboxapp message: account phone number is not configured.',
      );
      throw new Error('WABOXAPP_PHONE_NUMBER is not configured.');
    }

    if (!recipient) {
      this.logger.error('Cannot send Waboxapp message: recipient is invalid.');
      throw new Error('Invalid recipient phone number.');
    }

    const customUid = randomUUID();
    const formData = new URLSearchParams({
      token: this.apiToken,
      uid: accountPhoneNumber,
      to: recipient,
      custom_uid: customUid,
      text: body,
    });
    const outboundMessageKey = this.getOutboundMessageKey(recipient, body);
    this.pruneRecentOutboundMessages(Date.now());
    this.recentOutboundMessages.set(
      outboundMessageKey,
      Date.now() + OUTBOUND_ECHO_TTL_MS,
    );

    try {
      this.logger.log(
        `Sending Waboxapp text message: account=${this.maskPhoneNumber(accountPhoneNumber)}, ` +
          `recipient=${this.maskPhoneNumber(recipient)}, textLength=${body.length}, customUid=${customUid}.`,
      );
      const response = await this.http.post<WaboxappSendResponse>(
        '/send/chat',
        formData.toString(),
      );

      if (response.data?.success !== true) {
        throw new Error(
          `Waboxapp did not confirm the message was accepted: ${JSON.stringify(response.data)}`,
        );
      }

      this.logger.log(
        `Waboxapp accepted message customUid=${customUid} for ${this.maskPhoneNumber(recipient)} ` +
          `(HTTP ${response.status}).`,
      );
    } catch (error) {
      let details: string;
      if (axios.isAxiosError(error)) {
        const responseDetails = error.response?.data;
        const serializedDetails = JSON.stringify(
          responseDetails ?? error.message,
        );
        details = this.redactRequestData(serializedDetails, body);
        this.logger.error(
          `Waboxapp request failed for customUid=${customUid} ` +
            `(HTTP ${error.response?.status ?? 'no response'}): ${details}`,
        );
      } else {
        details = this.redactRequestData(
          error instanceof Error ? error.message : String(error),
          body,
        );
        this.logger.error(
          `Waboxapp request failed for customUid=${customUid}: ${details}`,
        );
      }
      this.recentOutboundMessages.delete(outboundMessageKey);
      throw error;
    }
  }

  async markMessageAsRead(messageId: string): Promise<void> {
    this.logger.debug(
      `Waboxapp does not expose a mark-as-read endpoint for message ${messageId}.`,
    );
  }

  async downloadMedia(mediaId: string): Promise<Buffer> {
    const errorMsg = `Media download is not supported by Waboxapp for media ID: ${mediaId}.`;
    this.logger.warn(errorMsg);
    throw new Error(errorMsg);
  }
}
