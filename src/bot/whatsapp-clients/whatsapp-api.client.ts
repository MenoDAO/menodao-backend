/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument -- provider payloads are untyped JSON */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';

import { IWhatsappClient } from './whatsapp-provider.interface';

/**
 * Official Meta WhatsApp Cloud / Graph API Client.
 * Preserved for direct Meta API integration.
 */
@Injectable()
export class WhatsappApiClient implements IWhatsappClient {
  private readonly logger = new Logger(WhatsappApiClient.name);
  private readonly http: AxiosInstance;
  private readonly phoneNumberId: string;

  constructor(private readonly configService: ConfigService) {
    const apiVersion =
      this.configService.get<string>('WHATSAPP_GRAPH_API_VERSION') ?? 'v20.0';
    const accessToken = this.configService.get<string>('WHATSAPP_ACCESS_TOKEN');
    this.phoneNumberId =
      this.configService.get<string>('WHATSAPP_PHONE_NUMBER_ID') ?? '';

    this.http = axios.create({
      baseURL: `https://graph.facebook.com/${apiVersion}`,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      timeout: 10000,
    });
  }

  /**
   * Sends a plain text message to a WhatsApp user via the Meta Graph API.
   */
  async sendTextMessage(to: string, body: string): Promise<void> {
    try {
      await this.http.post(`/${this.phoneNumberId}/messages`, {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'text',
        text: {
          preview_url: false,
          body,
        },
      });
      this.logger.log(`Message sent to ${to}.`);
    } catch (error) {
      const details = axios.isAxiosError(error)
        ? JSON.stringify(error.response?.data ?? error.message)
        : String(error);
      this.logger.error(`Failed to send WhatsApp message to ${to}: ${details}`);
      throw error;
    }
  }

  /**
   * Marks an inbound message as read (blue ticks) via the Graph API.
   */
  async markMessageAsRead(messageId: string): Promise<void> {
    try {
      await this.http.post(`/${this.phoneNumberId}/messages`, {
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId,
      });
    } catch (error) {
      const details = axios.isAxiosError(error)
        ? JSON.stringify(error.response?.data ?? error.message)
        : String(error);
      this.logger.warn(
        `Failed to mark message ${messageId} as read: ${details}`,
      );
    }
  }

  /**
   * Downloads media content (such as an audio voice note) given its Meta media ID.
   */
  async downloadMedia(mediaId: string): Promise<Buffer> {
    try {
      // Step 1: Retrieve temporary media URL
      const metaRes = await this.http.get(`/${mediaId}`);
      const mediaUrl = metaRes.data?.url;
      if (!mediaUrl) {
        throw new Error(`No media URL found for ID: ${mediaId}`);
      }

      // Step 2: Download raw binary stream using authorization header
      const accessToken = this.configService.get<string>(
        'WHATSAPP_ACCESS_TOKEN',
      );
      const response = await axios.get(mediaUrl, {
        responseType: 'arraybuffer',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      return Buffer.from(response.data);
    } catch (error) {
      const details = axios.isAxiosError(error)
        ? JSON.stringify(error.response?.data ?? error.message)
        : String(error);
      this.logger.error(
        `Failed to download WhatsApp media [${mediaId}]: ${details}`,
      );
      throw error;
    }
  }
}
