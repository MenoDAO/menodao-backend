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
import { FieldDataService } from '../field-data/field-data.service';
import { VoucherService } from '../../voucher/voucher.service';
import { FlaresendWebhookPayload } from './flaresend-webhook.types';
import { WaboxappWebhookPayload } from './waboxapp-webhook.types';
import { WhatsappWebhookPayload } from './whatsapp-webhook.types';
import { onboardingReprompt, onboardingWelcome } from './onboarding.messages';
import {
  extractFlaresendAudio,
  extractFlaresendFieldMedia,
  type FlaresendMedia,
} from './flaresend-media.util';

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
    private readonly fieldDataService: FieldDataService,
    private readonly voucherService: VoucherService,
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
    const audioMedia = extractFlaresendAudio(data as any);
    const fieldMedia = extractFlaresendFieldMedia(data as any);
    if (!audioMedia && !fieldMedia && !messageText) return;

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
      if (audioMedia) {
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

        const audioSource = await this.flaresendClient.downloadMediaDescriptor(
          audioMedia.descriptor,
          data.id,
          audioMedia.mimeType,
        );
        if (!audioSource) {
          this.logger.warn(
            `FlareSend audio download failed for ${recipientPhone}; media keys=${Object.keys(
              audioMedia.descriptor || {},
            )
              .slice(0, 20)
              .join(',')}`,
          );
        }
        if (audioSource) {
          try {
            const result = await this.voicePipelineService.processVoicePipeline(
              audioSource.buffer,
              recipientPhone,
              undefined,
              member?.preferredLanguage,
              data.id,
            );
            await this.sendTextSafely(
              recipientPhone,
              result.patientMessage ||
                this.voiceFallback(member?.preferredLanguage),
              member
                ? {
                    memberId: member.id,
                    contactId: whatsappId,
                    instanceProviderId: payload.instanceId,
                  }
                : undefined,
            );
            return;
          } catch (error) {
            this.logger.error(
              `FlareSend audio handling failed for ${recipientPhone}: ${error}`,
            );
          }
        }

        const diagKeys = Object.keys(audioMedia.descriptor || {})
          .filter((k) => /url|id|key|direct|mime|base64|media/i.test(k))
          .slice(0, 4)
          .join('+')
          .slice(0, 24);
        await this.sendTextSafely(
          recipientPhone,
          this.voiceFallback(member?.preferredLanguage) +
            ` (ref: voice-download:${diagKeys || 'no-desc'})`,
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
      if (fieldMedia) {
        await this.handleFlaresendFieldMedia({
          payload,
          data,
          whatsappId,
          phoneHint,
          contactName,
          fieldMedia,
        });
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

  private async handleFlaresendFieldMedia(params: {
    payload: FlaresendWebhookPayload;
    data: any;
    whatsappId: string;
    phoneHint?: string;
    contactName?: string;
    fieldMedia: FlaresendMedia;
  }): Promise<void> {
    const { payload, data, whatsappId, phoneHint, contactName, fieldMedia } = params;
    const member = await this.identity.resolveMember({
      phoneDigitsFallback: this.isLid(whatsappId)
        ? (phoneHint ?? undefined)
        : whatsappId,
      whatsappId,
    });
    const recipientPhone =
      member?.phoneNumber ?? (this.isLid(whatsappId) ? undefined : whatsappId);

    if (member) {
      await this.chatService.recordInbound({
        contactId: whatsappId,
        contactName,
        memberId: member.id,
        content: `[field ${fieldMedia.kind.toLowerCase()} received]`,
        contentType: fieldMedia.kind,
        providerMessageId: data.id ?? null,
        instanceProviderId: payload.instanceId ?? null,
      });
    }

    const media = await this.flaresendClient.downloadMediaDescriptor(
      fieldMedia.descriptor,
      data.id,
      fieldMedia.mimeType,
    );
    if (!media) {
      if (recipientPhone) {
        await this.sendTextSafely(
          recipientPhone,
          'Samahani, hatukuweza kupakua faili hii. Tafadhali tuma tena. ' +
            'Sorry, we could not download this file. Please send it again.',
          member
            ? {
                memberId: member.id,
                contactId: whatsappId,
                instanceProviderId: payload.instanceId,
              }
            : undefined,
        );
      }
      return;
    }

    const result = await this.fieldDataService.ingestMedia({
      phoneCandidates: [whatsappId, phoneHint, member?.phoneNumber],
      memberId: member?.id,
      providerMessageId: data.id ?? null,
      whatsappId,
      kind: fieldMedia.kind,
      mimeType: media.mimeType,
      buffer: media.buffer,
      caption: fieldMedia.caption ?? null,
      originalFilename: media.originalFilename,
    });

    if (recipientPhone) {
      await this.sendTextSafely(
        recipientPhone,
        result.reply,
        member
          ? {
              memberId: member.id,
              contactId: whatsappId,
              instanceProviderId: payload.instanceId,
            }
          : undefined,
      );
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
        const member = await this.identity.resolveMember({
          phoneDigitsFallback: normalizedPhone,
          whatsappId: normalizedPhone,
        });
        const audioBuffer = await this.metaApiClient.downloadMedia(
          message.audio.id,
        );
        const result = await this.voicePipelineService.processVoicePipeline(
          audioBuffer,
          normalizedPhone,
          undefined,
          member?.preferredLanguage,
          message.audio.id,
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
          'Samahani, hatukuweza kusikiliza ujumbe wako wa sauti vizuri. Tafadhali jaribu kutuma tena au uandike kwa maneno. (ref: voice-meta)',
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

    if (
      await this.handleVoucherMessage({
        member,
        recipientPhone: member.phoneNumber,
        messageText,
        chatContext,
      })
    ) {
      return;
    }

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
   * First turn for a new WhatsApp contact. The welcome is a question, not a
   * menu, and every reply after it is handed to the AI pipeline in the
   * member's own words. Bare 1/2/3 shortcuts still work for returning users.
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
        onboardingWelcome(preferredLanguage),
        chatContext,
      );
      return;
    }

    const choice = this.resolveMenuChoice(messageText);
    const trimmedInput = (messageText ?? '').trim();
    // A bare number carries no intent. Everything else — including "my tooth
    // is sore" — goes to the pipeline exactly as the member wrote it.
    const aiInput =
      /^[123]$/.test(trimmedInput) && choice ? choice.phrase : trimmedInput;
    if (!aiInput) {
      await this.sendTextSafely(
        recipientPhone,
        onboardingReprompt(preferredLanguage),
        chatContext,
      );
      return;
    }

    await this.onboardingService.setStep(memberId, 'MENU', {
      choice: choice?.key ?? 'FREE_TEXT',
      selectedAt: new Date().toISOString(),
    });

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
  private extractVoucherCode(messageText: string): string | null {
    const normalized = String(messageText ?? '').toUpperCase();
    const matches = normalized.match(/\b[A-Z0-9]{2,12}-[A-HJ-NP-Z2-9]{5}\b/g);
    if (!matches?.length) return null;
    return matches[0] ?? null;
  }

  private isVoucherIntent(messageText: string): boolean {
    const text = String(messageText ?? '').toLowerCase();
    return /\b(voucher|vocha|redeem|kubadilisha|tumia vocha|care code|discount code)\b/.test(
      text,
    );
  }

  private async handleVoucherMessage(params: {
    member: { id: string; phoneNumber: string; fullName?: string | null; name?: string | null };
    recipientPhone: string;
    messageText: string;
    chatContext: ChatContext;
  }): Promise<boolean> {
    const code = this.extractVoucherCode(params.messageText);
    const hasIntent = this.isVoucherIntent(params.messageText);
    if (!code && !hasIntent) return false;
    if (!code) {
      await this.sendTextSafely(
        params.recipientPhone,
        'Please send the voucher code in the format SMILE-XXXXX so I can check or redeem it.',
        params.chatContext,
      );
      return true;
    }

    try {
      const normalized = code.trim().toUpperCase();
      const existing = await this.prisma.voucher.findUnique({
        where: { code: normalized },
      });
      if (!existing) {
        if (hasIntent || params.messageText.trim().toUpperCase() === normalized) {
          await this.sendTextSafely(
            params.recipientPhone,
            `I could not find voucher ${normalized}. Please check the code and send it again.`,
            params.chatContext,
          );
          return true;
        }
        return false;
      }

      const redeemed = await this.voucherService.redeemByCode(normalized, {
        redeemedBy:
          params.member.name ||
          params.member.fullName ||
          params.member.phoneNumber,
        notes: `Redeemed via WhatsApp bot by member ${params.member.id}`,
      });
      const status = String((redeemed as any)?.status ?? '');
      if (status === 'REDEEMED') {
        const already = existing.status === 'REDEEMED';
        await this.sendTextSafely(
          params.recipientPhone,
          already
            ? `Voucher ${normalized} has already been redeemed. If you need help using it for care, reply with BOOKING or talk to our team.`
            : `Voucher ${normalized} is confirmed and redeemed. You can present this code at participating care points or reply BOOKING to get help accessing care.`,
          params.chatContext,
        );
        return true;
      }

      await this.sendTextSafely(
        params.recipientPhone,
        `Voucher ${normalized} cannot be redeemed right now (${status.toLowerCase() || 'unavailable'}). Please contact support for help.`,
        params.chatContext,
      );
      return true;
    } catch (error) {
      this.logger.warn(
        `Voucher bot handling failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      if (hasIntent || params.messageText.trim().toUpperCase() === code) {
        await this.sendTextSafely(
          params.recipientPhone,
          'I could not process that voucher right now. Please try again or contact support.',
          params.chatContext,
        );
        return true;
      }
      return false;
    }
  }

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

  private async extractFlaresendAudioSource(
    audio: any,
  ): Promise<{ buffer: Buffer; mediaId?: string } | null> {
    if (!audio || typeof audio !== 'object') return null;

    const mediaId =
      typeof audio.id === 'string'
        ? audio.id
        : typeof audio.mediaId === 'string'
          ? audio.mediaId
          : undefined;

    if (typeof audio.data === 'string' && audio.data.trim()) {
      try {
        return { buffer: Buffer.from(audio.data.trim(), 'base64'), mediaId };
      } catch {
        return null;
      }
    }
    if (typeof audio.base64 === 'string' && audio.base64.trim()) {
      try {
        return { buffer: Buffer.from(audio.base64.trim(), 'base64'), mediaId };
      } catch {
        return null;
      }
    }

    const url =
      typeof audio.url === 'string'
        ? audio.url
        : typeof audio.mediaUrl === 'string'
          ? audio.mediaUrl
          : typeof audio.downloadUrl === 'string'
            ? audio.downloadUrl
            : null;

    if (url) {
      try {
        const response = await fetch(url);
        if (!response.ok) return null;
        const arrayBuffer = await response.arrayBuffer();
        return { buffer: Buffer.from(arrayBuffer), mediaId };
      } catch {
        return null;
      }
    }

    return null;
  }

  private voiceFallback(preferredLanguage?: string | null): string {
    if ((preferredLanguage || '').toLowerCase().startsWith('sw')) {
      return 'Samahani, hatuwezi kusikiliza ujumbe wa sauti kwa sasa. Tafadhali andika ujumbe wako kwa maneno au upige simu kliniki. Asante! (ref: voice-download)';
    }
    return 'Sorry, voice notes are not available on this channel right now. Please type your message or call the clinic. Thank you!';
  }
}
