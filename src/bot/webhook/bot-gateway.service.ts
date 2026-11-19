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
import { BotOnboardingService } from '../onboarding/bot-onboarding.service';
import { BotChatService } from '../chat/bot-chat.service';
import { BotMemberDataService } from '../account/bot-member-data.service';
import { AdminWhatsappAccessService } from '../admin/admin-whatsapp-access.service';
import { FlaresendWebhookPayload } from './flaresend-webhook.types';
import { WaboxappWebhookPayload } from './waboxapp-webhook.types';
import { WhatsappWebhookPayload } from './whatsapp-webhook.types';

const WABOXAPP_INBOUND_DEDUPE_TTL_MS = 30_000;
const MAX_TRACKED_WABOXAPP_INBOUND_MESSAGES = 1_000;
const MAX_TRACKED_FLARESEND_INBOUND_MESSAGES = 1_000;
const FLARESEND_INBOUND_DEDUPE_TTL_MS = 10 * 60 * 1000;

/**
 * Sent when the AI pipeline fails outright (provider outage, quota, timeout).
 * Silence looks like the bot is broken; a holding line at least tells the
 * member to try again. Deliberately carries no health or account details.
 */
const DEFAULT_FALLBACK_REPLY =
  'Samahani, kuna hitilafu ya muda kwenye mfumo wetu. Tafadhali jaribu tena baada ya dakika chache. ' +
  'Sorry, we are having a temporary problem. Please try again in a few minutes.';

const ONBOARDING_WELCOME_MENU =
  'Kariba! 👋 Welcome to MenoDAO. MenoAI is here to help with your oral health.\n\n' +
  'Reply with a number to choose:\n' +
  '1️⃣ Book an appointment\n' +
  '2️⃣ Health information / symptoms\n' +
  '3️⃣ Help with my MenoDAO account';

const ONBOARDING_MENU_PROMPT =
  'Please reply with 1, 2 or 3 to continue:\n' +
  '1️⃣ Book an appointment\n' +
  '2️⃣ Health information / symptoms\n' +
  '3️⃣ Help with my MenoDAO account';

interface OnboardingMenuChoice {
  key: 'BOOKING' | 'HEALTH' | 'HELP';
  /** Canonical phrasing used when the member only replies with the menu number. */
  phrase: string;
}

/** Everything needed to attach an outbound message to its conversation. */
interface ChatContext {
  memberId: string;
  contactId: string;
  instanceProviderId?: string;
}

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
  private readonly recentFlaresendInboundMessages = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly voicePipelineService: VoicePipelineService,
    private readonly identity: BotIdentityService,
    private readonly onboardingService: BotOnboardingService,
    private readonly chatService: BotChatService,
    private readonly memberDataService: BotMemberDataService,
    private readonly adminAccess: AdminWhatsappAccessService,
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
    const phoneHint = this.extractPhoneHint(data);
    const contactName = data.pushName || data.name || undefined;
    const messageText = this.extractFlaresendMessageText(data as any);
    const isAudio = Boolean(data.message?.audioMessage);
    if (!isAudio && !messageText) return;

    // FlareSend retries a delivery when it does not see a fast 2xx, and the
    // controller acknowledges before processing finishes. Drop repeats so a
    // retry cannot produce a second bot reply.
    const dedupeKey = data.id
      ? `id:${data.id}`
      : createHash('sha256')
          .update(`${whatsappId}\0${messageText ?? 'audio'}`)
          .digest('hex');
    const now = Date.now();
    for (const [key, expiresAt] of this.recentFlaresendInboundMessages) {
      if (expiresAt <= now) this.recentFlaresendInboundMessages.delete(key);
    }
    if ((this.recentFlaresendInboundMessages.get(dedupeKey) ?? 0) > now) {
      this.logger.debug(`Skipping duplicate FlareSend message ${dedupeKey}`);
      return;
    }
    while (
      this.recentFlaresendInboundMessages.size >=
      MAX_TRACKED_FLARESEND_INBOUND_MESSAGES
    ) {
      const oldestKey = this.recentFlaresendInboundMessages.keys().next().value;
      if (oldestKey === undefined) break;
      this.recentFlaresendInboundMessages.delete(oldestKey);
    }
    this.recentFlaresendInboundMessages.set(
      dedupeKey,
      now + FLARESEND_INBOUND_DEDUPE_TTL_MS,
    );

    try {
      if (isAudio) {
        const member = await this.identity.resolveMember({
          phoneDigitsFallback: this.isLid(whatsappId)
            ? (phoneHint ?? undefined)
            : whatsappId,
          whatsappId,
        });
        const recipientPhone =
          member?.phoneNumber ??
          (this.isLid(whatsappId) ? undefined : whatsappId);
        if (!recipientPhone) return;
        if (member) {
          await this.chatService.recordInbound({
            contactId: whatsappId,
            contactName,
            memberId: member.id,
            content: '[voice note]',
            contentType: 'AUDIO',
            providerMessageId: data.id ?? null,
            instanceProviderId: payload.instanceId ?? null,
          });
        }
        await this.sendTextSafely(
          recipientPhone,
          'Samahani, hatuwezi kusikiliza ujumbe wa sauti kwa sasa. Tafadhali andika ujumbe wako kwa maneno au upige simu kliniki. Asante!',
          member
            ? {
                memberId: member.id,
                contactId: whatsappId,
                instanceProviderId: payload.instanceId,
              }
            : undefined,
        );
        return;
      }
      if (!messageText) return;
      await this.handleUserTextMessage({
        senderId: whatsappId,
        fallbackPhone: this.isLid(whatsappId) ? phoneHint : whatsappId,
        messageId: data.id,
        messageText,
        contactName,
        instanceProviderId: payload.instanceId,
      });
    } catch (error) {
      // Let the next retry try again rather than swallowing the message.
      this.recentFlaresendInboundMessages.delete(dedupeKey);
      throw error;
    }
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
        await this.sendTextSafely(normalizedPhone, replyText);
        return;
      } catch (error) {
        this.logger.error(
          `Meta audio handling failed for ${normalizedPhone}: ${error}`,
        );
        await this.sendTextSafely(
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
    instanceProviderId?: string;
  }): Promise<void> {
    const {
      senderId,
      fallbackPhone,
      messageId,
      messageText,
      contactName,
      instanceProviderId,
    } = params;
    try {
      await this.whatsappClient.markMessageAsRead(messageId);
    } catch {
      /* non-fatal */
    }

    // An admin can use the same phone as their member account. Admin mode is
    // explicit (`ADMIN`), and once entered all follow-ups stay in admin mode
    // until EXIT/expiry. This runs before member resolution so an admin phone
    // never creates a member stub or enters member onboarding.
    const admin = await this.adminAccess.findAdminBySender(
      senderId,
      fallbackPhone,
    );
    if (admin) {
      const wantsAdminMode = this.adminAccess.isAdminModeCommand(messageText);
      const hasAdminSession =
        wantsAdminMode || (await this.adminAccess.hasActiveSession(admin.id));
      if (hasAdminSession) {
        const reply = await this.adminAccess.handleMessage(admin, messageText);
        // Admin conversations are intentionally not written to the member chat
        // transcript; SensitiveDataAccessLog carries the access audit.
        await this.sendTextSafely(admin.phoneNumber, reply);
        return;
      }
    }

    const member = await this.identity.resolveMember({
      phoneDigitsFallback: fallbackPhone,
      whatsappId: senderId,
      contactName,
    });
    if (!member) return;

    const chatContext: ChatContext = {
      memberId: member.id,
      contactId: senderId,
      instanceProviderId,
    };

    // Persist the member's side of the conversation before we reply, so a
    // failure further down still leaves an auditable transcript.
    await this.chatService.recordInbound({
      contactId: senderId,
      contactName,
      memberId: member.id,
      content: messageText,
      providerMessageId: messageId || null,
      instanceProviderId,
    });

    // New / unverified WhatsApp numbers start in the onboarding state machine;
    // known (verified) members proceed straight to the AI reply path.
    if (!member.isVerified) {
      const session = await this.onboardingService.getSession(member.id);
      if (!session || session.status === 'IN_PROGRESS') {
        await this.handleOnboardingTurn({
          memberId: member.id,
          recipientPhone: member.phoneNumber,
          messageText,
          senderId,
          chatContext,
          preferredLanguage: member.preferredLanguage ?? 'en',
        });
        return;
      }
    }

    // Sensitive personal records are OTP-gated. A 6-digit reply is treated as a
    // verification code only while a pending challenge exists for this member.
    const trimmed = (messageText || '').trim();
    if (
      /^\d{6}$/.test(trimmed) &&
      (await this.memberDataService.hasPendingVerification(member.id))
    ) {
      const result = await this.memberDataService.verify(
        { id: member.id, phoneNumber: member.phoneNumber },
        trimmed,
      );
      await this.sendTextSafely(member.phoneNumber, result.reply, chatContext);
      return;
    }

    const scope = this.memberDataService.detectScope(messageText);
    if (scope) {
      const reply = await this.memberDataService.handleRequest(
        { id: member.id, phoneNumber: member.phoneNumber },
        scope,
      );
      await this.sendTextSafely(member.phoneNumber, reply, chatContext);
      return;
    }

    const replyText = await this.generateReplyText({
      memberId: member.id,
      recipientPhone: member.phoneNumber,
      messageText,
      senderId,
    });
    await this.sendTextSafely(member.phoneNumber, replyText, chatContext);
  }

  /**
   * Onboarding state machine — drives a new member from the welcome menu to a
   * resolved intent. The member's own words are handed to the AI pipeline once
   * a menu option is recognised, so the rest of the bot behaves normally.
   */
  private async handleOnboardingTurn(params: {
    memberId: string;
    recipientPhone: string;
    messageText: string;
    senderId: string;
    chatContext: ChatContext;
    preferredLanguage?: string;
  }): Promise<void> {
    const { memberId, recipientPhone, messageText, chatContext } = params;
    const preferredLanguage = params.preferredLanguage ?? 'en';
    const session = await this.onboardingService.start(
      memberId,
      preferredLanguage,
    );

    if (session.step === 'WELCOME') {
      await this.onboardingService.setStep(memberId, 'INTEREST', {
        source: 'welcome',
        language: preferredLanguage,
        welcomeSentAt: new Date().toISOString(),
      });
      await this.sendTextSafely(
        recipientPhone,
        ONBOARDING_WELCOME_MENU,
        chatContext,
      );
      return;
    }

    const choice = this.resolveMenuChoice(messageText);
    if (!choice) {
      await this.sendTextSafely(
        recipientPhone,
        ONBOARDING_MENU_PROMPT,
        chatContext,
      );
      return;
    }

    await this.onboardingService.setStep(memberId, 'MENU', {
      choice: choice.key,
      selectedAt: new Date().toISOString(),
    });

    // A bare menu number carries no intent — use the canonical phrasing.
    const aiInput = /^[123]$/.test(messageText.trim())
      ? choice.phrase
      : messageText;

    const replyText = await this.generateReplyText({
      memberId,
      recipientPhone,
      messageText: aiInput,
      senderId: params.senderId,
    });
    await this.sendTextSafely(recipientPhone, replyText, chatContext);
    await this.onboardingService.complete(memberId);
  }

  private resolveMenuChoice(messageText: string): OnboardingMenuChoice | null {
    const text = (messageText ?? '').trim().toLowerCase();
    if (!text) return null;
    if (
      /^(1|book|booking|appointment|miadi|ninapenda kupanga|book\s+appointment)/.test(
        text,
      )
    ) {
      return {
        key: 'BOOKING',
        phrase: 'I want to book an appointment at a MenoDAO clinic.',
      };
    }
    if (
      /^(2|health|info|information|symptom|symptoms|pain|toothache|afya|maumivu)/.test(
        text,
      )
    ) {
      return {
        key: 'HEALTH',
        phrase: 'I have a question about my dental health.',
      };
    }
    if (/^(3|help|support|account|memb|msaada)/.test(text)) {
      return {
        key: 'HELP',
        phrase: 'I need help with my MenoDAO account.',
      };
    }
    return null;
  }

  /** Shared reply generation: static override (if configured) or the AI pipeline. */
  private async generateReplyText(params: {
    memberId: string;
    recipientPhone: string;
    messageText: string;
    senderId: string;
  }): Promise<string> {
    const { memberId, recipientPhone, messageText, senderId } = params;
    const staticReply = this.configService
      .get<string>('BOT_WHATSAPP_STATIC_REPLY')
      ?.trim();
    if (staticReply) {
      this.logger.log(
        'Using BOT_WHATSAPP_STATIC_REPLY; skipping AI generation.',
      );
      await this.prisma.botMessageLog.createMany({
        data: [
          { memberId, role: 'user', content: messageText },
          { memberId, role: 'assistant', content: staticReply },
        ],
      });
      return staticReply;
    }
    try {
      const result = await this.voicePipelineService.processTextPipeline(
        messageText,
        recipientPhone,
        undefined,
        undefined,
        senderId,
      );
      const reply = result.patientMessage?.trim();
      if (reply) return reply;
      this.logger.warn(
        'AI pipeline returned an empty reply; sending the fallback message.',
      );
    } catch (error) {
      this.logger.error(
        `AI reply generation failed for ${recipientPhone}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        error instanceof Error ? error.stack : undefined,
      );
    }
    return (
      this.configService.get<string>('BOT_FALLBACK_REPLY')?.trim() ||
      DEFAULT_FALLBACK_REPLY
    );
  }

  /** Outbound send that never breaks the conversation state machine. */
  private async sendTextSafely(
    recipientPhone: string,
    replyText: string,
    chatContext?: ChatContext,
  ): Promise<void> {
    try {
      await this.whatsappClient.sendTextMessage(recipientPhone, replyText);
      if (chatContext) {
        await this.chatService.recordOutbound({
          contactId: chatContext.contactId,
          memberId: chatContext.memberId,
          content: replyText,
          instanceProviderId: chatContext.instanceProviderId,
        });
      }
    } catch (error) {
      if (chatContext) {
        await this.chatService.recordOutbound({
          contactId: chatContext.contactId,
          memberId: chatContext.memberId,
          content: replyText,
          instanceProviderId: chatContext.instanceProviderId,
          deliveryStatus: 'FAILED',
        });
      }
      this.logger.error(
        `Failed to send reply to ${recipientPhone}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
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

  /**
   * Extract a concrete phone number (or phone JID) from a WhatsApp webhook
   * payload. Used as a fallback identity hint when the sender identifier is a
   * WhatsApp "lid" (@lid) rather than a real phone number.
   */
  private extractPhoneHint(data: any): string | undefined {
    const candidates: unknown[] = [
      data?.senderPn,
      data?.sender_pn,
      data?.senderKeyHash,
      data?.participant,
      data?.author,
      data?.key?.participant,
      data?.key?.senderPn,
      data?.from,
    ];
    for (const candidate of candidates) {
      if (typeof candidate !== 'string' || !candidate.trim()) continue;
      const normalized = this.normalizePhoneNumber(candidate);
      if (!normalized) continue;
      if (candidate.includes('@lid')) continue; // LIDs are not phone numbers.
      return normalized;
    }
    return undefined;
  }
}
