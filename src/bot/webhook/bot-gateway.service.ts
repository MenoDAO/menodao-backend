/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return -- provider payloads are untyped JSON */
import { createHash } from 'crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { VoicePipelineService } from '../voice-pipeline/voice-pipeline.service';
import type { IWhatsappClient } from '../whatsapp-clients/whatsapp-provider.interface';
import { WHATSAPP_CLIENT } from '../whatsapp-clients/whatsapp-provider.interface';
import { FlaresendApiClient } from '../whatsapp-clients/flaresend-api.client';
import { WaboxappApiClient } from '../whatsapp-clients/waboxapp-api.client';
import { WhatsappApiClient } from '../whatsapp-clients/whatsapp-api.client';
import { BotIdentityService } from '../identity/bot-identity.service';
import { FlaresendWebhookPayload } from './flaresend-webhook.types';
import { WaboxappWebhookPayload } from './waboxapp-webhook.types';
import { WhatsappWebhookPayload } from './whatsapp-webhook.types';

const WABOXAPP_INBOUND_DEDUPE_TTL_MS = 30_000;
const MAX_TRACKED_WABOXAPP_INBOUND_MESSAGES = 1_000;

/**
 * BotGatewayService — port of menobot WhatsappService dispatch, backed by
 * Member (not a separate bot User). Alternate gateways (FlareSend / Waboxapp)
 * route here; Meta Cloud API stays on the existing backend
 * /whatsapp/webhook (signature-guarded) unless explicitly routed through
 * BOT_META_WEBHOOK_ENABLED.
 */
@Injectable()
export class BotGatewayService {
  private readonly logger = new Logger(BotGatewayService.name);
  private readonly recentWaboxappInboundMessages = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly voicePipelineService: VoicePipelineService,
    private readonly identity: BotIdentityService,
    @Inject(WHATSAPP_CLIENT)
    private readonly whatsappClient: IWhatsappClient,
    private readonly metaApiClient: WhatsappApiClient,
    private readonly flaresendClient: FlaresendApiClient,
    private readonly waboxappClient: WaboxappApiClient,
  ) {}

  public normalizePhoneNumber(phone: string): string {
    return (phone || '')
      .replace(/@s\.whatsapp\.net$/i, '')
      .replace(/@g\.us$/i, '')
      .replace(/[^\d]/g, '');
  }

  private normalizeWhatsappIdentity(value: string): string {
    const identity = value.trim();
    return identity.toLowerCase().endsWith('@lid')
      ? identity.toLowerCase()
      : this.normalizePhoneNumber(identity);
  }

  private isLid(identity: string): boolean {
    return identity.endsWith('@lid');
  }

  async processWebhookPayload(payload: any): Promise<void> {
    if (!payload || typeof payload !== 'object') {
      this.logger.warn('Received empty or invalid webhook payload.');
      return;
    }
    if (payload.event === 'message') {
      await this.processWaboxappWebhook(payload as WaboxappWebhookPayload);
      return;
    }
    if (payload.event === 'ack') {
      return; // acknowledgements are logged-only upstream
    }
    if (
      payload.event === 'message_received' ||
      (payload.data && payload.data.from)
    ) {
      await this.processFlaresendWebhook(payload as FlaresendWebhookPayload);
      return;
    }
    if (payload.object === 'whatsapp_business_account') {
      await this.processMetaWebhook(payload as WhatsappWebhookPayload);
      return;
    }
    this.logger.warn(
      `Ignoring webhook: unrecognized structure (event=${payload.event}, object=${payload.object})`,
    );
  }

  private async processWaboxappWebhook(
    payload: WaboxappWebhookPayload,
  ): Promise<void> {
    const expectedToken = this.configService.get<string>('WABOXAPP_API_TOKEN');
    if (!expectedToken) {
      this.logger.warn(
        'Rejecting Waboxapp webhook: WABOXAPP_API_TOKEN is not configured.',
      );
      return;
    }
    if (payload.token !== expectedToken) {
      this.logger.warn('Rejecting Waboxapp webhook: API token mismatch.');
      return;
    }
    const sender = payload.contact?.uid;
    if (!sender) return;
    const normalizedPhone = this.normalizePhoneNumber(sender);
    if (!normalizedPhone) return;
    const messageText = payload.message?.body?.text?.trim();
    if (!messageText) return;
    if (
      this.waboxappClient.isRecentlySentTextMessage?.(
        normalizedPhone,
        messageText,
      )
    ) {
      return;
    }
    const inboundMessageKey = createHash('sha256')
      .update(`${normalizedPhone}\0${messageText}`)
      .digest('hex');
    const now = Date.now();
    for (const [key, expiresAt] of this.recentWaboxappInboundMessages) {
      if (expiresAt <= now) this.recentWaboxappInboundMessages.delete(key);
    }
    if ((this.recentWaboxappInboundMessages.get(inboundMessageKey) ?? 0) > now)
      return;
    while (
      this.recentWaboxappInboundMessages.size >=
      MAX_TRACKED_WABOXAPP_INBOUND_MESSAGES
    ) {
      const oldestKey = this.recentWaboxappInboundMessages.keys().next().value;
      if (oldestKey === undefined) break;
      this.recentWaboxappInboundMessages.delete(oldestKey);
    }
    this.recentWaboxappInboundMessages.set(
      inboundMessageKey,
      now + WABOXAPP_INBOUND_DEDUPE_TTL_MS,
    );
    try {
      await this.handleUserTextMessage({
        senderId: normalizedPhone,
        fallbackPhone: normalizedPhone,
        messageId: payload.message?.uid ?? '',
        messageText,
      });
    } catch (error) {
      this.recentWaboxappInboundMessages.delete(inboundMessageKey);
      throw error;
    }
  }

  private async processFlaresendWebhook(
    payload: FlaresendWebhookPayload,
  ): Promise<void> {
    if (payload.event && payload.event !== 'message_received') return;
    const data = payload.data;
    if (!data || !data.from) return;
    if (data.fromMe === true || data.key?.fromMe === true) return;
    if (data.from === 'status@broadcast' || data.from.endsWith('@broadcast'))
      return;
    if (data.from.endsWith('@g.us')) return;
    const whatsappId = this.normalizeWhatsappIdentity(data.from);
    if (!whatsappId) return;
    const contactName = data.pushName || data.name || undefined;
    const messageText = this.extractFlaresendMessageText(data as any);
    if (data.message?.audioMessage) {
      const member = await this.identity.resolveMember({
        phoneDigitsFallback: this.isLid(whatsappId) ? undefined : whatsappId,
        whatsappId,
      });
      const recipientPhone =
        member?.phoneNumber ??
        (this.isLid(whatsappId) ? undefined : whatsappId);
      if (!recipientPhone) return;
      await this.flaresendClient.sendTextMessage(
        recipientPhone,
        'Samahani, hatuwezi kusikiliza ujumbe wa sauti kwa sasa. Tafadhali andika ujumbe wako kwa maneno au upige simu kliniki. Asante!',
      );
      return;
    }
    if (!messageText) return;
    await this.handleUserTextMessage({
      senderId: whatsappId,
      fallbackPhone: this.isLid(whatsappId) ? undefined : whatsappId,
      messageId: data.id,
      messageText,
      contactName,
    });
  }

  private async processMetaWebhook(
    payload: WhatsappWebhookPayload,
  ): Promise<void> {
    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const { value } = change;
        if (!value.messages || value.messages.length === 0) continue;
        for (const message of value.messages) {
          const contact = value.contacts?.find(
            (item: any) => item.wa_id === message.from,
          );
          await this.handleMetaInboundMessage(message as any, contact as any);
        }
      }
    }
  }

  private async handleMetaInboundMessage(
    message: any,
    contact?: any,
  ): Promise<void> {
    try {
      await this.whatsappClient.markMessageAsRead(message.id);
    } catch {
      /* non-fatal */
    }
    const normalizedPhone = this.normalizePhoneNumber(message.from);
    if (message.type === 'audio' && message.audio?.id) {
      try {
        const audioBuffer = await this.metaApiClient.downloadMedia(
          message.audio.id,
        );
        const result = await this.voicePipelineService.processVoicePipeline(
          audioBuffer,
          normalizedPhone,
        );
        const replyText =
          result.patientMessage || 'Ujumbe wako wa sauti umepokelewa. Asante!';
        await this.whatsappClient.sendTextMessage(normalizedPhone, replyText);
        return;
      } catch (error) {
        this.logger.error(
          `Meta audio handling failed for ${normalizedPhone}: ${error}`,
        );
        await this.whatsappClient.sendTextMessage(
          normalizedPhone,
          'Samahani, hatukuweza kusikiliza ujumbe wako wa sauti vizuri. Tafadhali jaribu kutuma tena au uandike kwa maneno.',
        );
        return;
      }
    }
    const messageText = this.extractMetaMessageText(message);
    if (!messageText) return;
    await this.handleUserTextMessage({
      senderId: normalizedPhone,
      fallbackPhone: normalizedPhone,
      messageId: message.id,
      messageText,
      contactName: contact?.profile?.name,
    });
  }

  private async handleUserTextMessage(params: {
    senderId: string;
    fallbackPhone?: string;
    messageId: string;
    messageText: string;
    contactName?: string;
  }): Promise<void> {
    const { senderId, fallbackPhone, messageId, messageText, contactName } =
      params;
    try {
      await this.whatsappClient.markMessageAsRead(messageId);
    } catch {
      /* non-fatal */
    }
    const member = await this.identity.resolveMember({
      phoneDigitsFallback: fallbackPhone,
      whatsappId: senderId,
      contactName,
    });
    if (!member) return;
    const recipientPhone = member.phoneNumber;
    const staticReply = this.configService
      .get<string>('BOT_WHATSAPP_STATIC_REPLY')
      ?.trim();
    let replyText: string;
    if (staticReply) {
      this.logger.log(
        'Using BOT_WHATSAPP_STATIC_REPLY; skipping AI generation.',
      );
      replyText = staticReply;
      await this.prisma.botMessageLog.createMany({
        data: [
          { memberId: member.id, role: 'user', content: messageText },
          { memberId: member.id, role: 'assistant', content: replyText },
        ],
      });
    } else {
      const result = await this.voicePipelineService.processTextPipeline(
        messageText,
        recipientPhone,
        undefined,
        undefined,
        senderId,
      );
      replyText = result.patientMessage;
    }
    await this.whatsappClient.sendTextMessage(recipientPhone, replyText);
  }

  private extractFlaresendMessageText(data: any): string | null {
    const msg = data.message;
    if (!msg) return null;
    if (msg.conversation && typeof msg.conversation === 'string')
      return msg.conversation.trim();
    if (msg.extendedTextMessage?.text)
      return msg.extendedTextMessage.text.trim();
    if (msg.buttonsResponseMessage?.selectedDisplayText)
      return msg.buttonsResponseMessage.selectedDisplayText.trim();
    if (msg.templateButtonReplyMessage?.selectedDisplayText)
      return msg.templateButtonReplyMessage.selectedDisplayText.trim();
    if (msg.interactiveResponseMessage?.body?.text)
      return msg.interactiveResponseMessage.body.text.trim();
    if (msg.imageMessage?.caption) return msg.imageMessage.caption.trim();
    if (msg.videoMessage?.caption) return msg.videoMessage.caption.trim();
    return null;
  }

  private extractMetaMessageText(message: any): string | null {
    if (message.type === 'text' && message.text?.body)
      return message.text.body.trim();
    if (message.type === 'button' && message.button?.text)
      return message.button.text.trim();
    if (message.type === 'interactive') {
      if (message.interactive?.button_reply?.title)
        return message.interactive.button_reply.title.trim();
      if (message.interactive?.list_reply?.title)
        return message.interactive.list_reply.title.trim();
    }
    return null;
  }
}
