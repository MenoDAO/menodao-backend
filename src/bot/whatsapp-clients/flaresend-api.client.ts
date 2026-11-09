/* eslint-disable @typescript-eslint/require-await -- provider payloads are untyped JSON */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import { IWhatsappClient } from './whatsapp-provider.interface';

interface FlaresendSendResponse {
  success?: boolean;
  failed_recipients?: string[];
  invalid_recipients?: string[];
}

@Injectable()
export class FlaresendApiClient implements IWhatsappClient {
  private readonly logger = new Logger(FlaresendApiClient.name);
  private readonly http: AxiosInstance;
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(private readonly configService: ConfigService) {
    this.baseUrl =
      this.configService.get<string>('FLARESEND_BASE_URL') ??
      'https://api.flaresend.com';
    this.apiKey = this.configService.get<string>('FLARESEND_API_KEY') ?? '';

    this.http = axios.create({
      baseURL: this.baseUrl,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    });
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
      const response = await this.http.post<FlaresendSendResponse>(
        '/send-message',
        {
          recipients: [recipient],
          type: 'text',
          text: body,
        },
      );

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
