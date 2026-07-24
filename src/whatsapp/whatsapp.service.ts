import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import Redis from 'ioredis';

import { SessionService, ChatSession, ChatState } from './session.service';
import { MetaApiService } from './meta-api.service';
import { LlmService, IntentType } from './llm.service';
import { MembersService } from '../members/members.service';
import { MetaWebhookPayload, MetaMessage } from './dto/webhook.dto';
import * as en from './i18n/en';
import * as sw from './i18n/sw';

// ─── Swahili keyword list for language detection ──────────────────────────────

const SWAHILI_KEYWORDS = new Set([
  'habari',
  'nzuri',
  'asante',
  'tafadhali',
  'sawa',
  'ndio',
  'hapana',
  'menyu',
  'rudi',
  'acha',
  'daktari',
  'meno',
  'msaada',
  'kliniki',
  'bima',
  'malipo',
  'historia',
  'akaunti',
  'lugha',
  'badilisha',
  'ndiyo',
  'karibu',
  'samahani',
  'shida',
  'tatizo',
  'dawa',
  'maumivu',
  'jino',
  'matibabu',
  'hospitali',
  'zahanati',
  'usajili',
  'mpango',
]);

// ─── Global command sets ──────────────────────────────────────────────────────

const MENU_COMMANDS = new Set(['menu', 'menyu', '0']);
const BACK_COMMANDS = new Set(['back', 'rudi']);
const CANCEL_COMMANDS = new Set(['cancel', 'acha']);

// ─── Rate limit config ────────────────────────────────────────────────────────

const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW_MS = 60_000; // 60 seconds
const MSG_DEDUP_TTL = 86400; // 24 hours in seconds

// ─── Flow handler interface ───────────────────────────────────────────────────

export interface FlowHandler {
  handle(
    session: ChatSession,
    message: string,
    rawMsg: MetaMessage,
  ): Promise<void>;
}

// ─── WhatsAppService ──────────────────────────────────────────────────────────

@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);
  private readonly redis: Redis | null;

  /** In-memory rate limit fallback: phone → array of timestamps */
  private readonly memRateLimit = new Map<string, number[]>();

  constructor(
    private readonly sessionService: SessionService,
    private readonly metaApi: MetaApiService,
    private readonly llmService: LlmService,
    private readonly membersService: MembersService,
    private readonly configService: ConfigService,
    // Flow services — injected as optional since they are created in later tasks.
    // When null, the service logs a warning and sends a "coming soon" message.
    @Optional() private readonly subscriptionFlow: FlowHandler | null,
    @Optional() private readonly clinicFlow: FlowHandler | null,
    @Optional() private readonly claimsFlow: FlowHandler | null,
    @Optional() private readonly dentalAiFlow: FlowHandler | null,
    @Optional() private readonly escalationFlow: FlowHandler | null,
    @Optional() private readonly visitHistoryFlow: FlowHandler | null,
    @Optional() private readonly referralsFlow: FlowHandler | null,
    @Optional() private readonly blockchainFlow: FlowHandler | null,
    @Optional() private readonly accountSettingsFlow: FlowHandler | null,
  ) {
    const redisUrl = configService.get<string>('REDIS_URL');
    if (redisUrl) {
      this.redis = new Redis(redisUrl);
      this.redis.on('error', (err: Error) =>
        this.logger.error(`[WhatsApp] Redis error: ${err.message}`),
      );
    } else {
      this.redis = null;
    }
  }

  // ─── Public entry point ────────────────────────────────────────────────────

  /**
   * Main inbound message handler.
   * Called fire-and-forget from the controller — MUST NEVER THROW.
   */
  async handleInbound(payload: MetaWebhookPayload): Promise<void> {
    const startMs = Date.now();

    try {
      // Extract the first message from the payload (Meta batches are usually 1)
      const entry = payload.entry?.[0];
      const change = entry?.changes?.[0];
      const value = change?.value;

      // Ignore status updates (delivered, read, etc.)
      if (!value?.messages?.length) return;

      const rawMsg = value.messages[0];
      const contactName = value.contacts?.[0]?.profile?.name;

      // Normalise phone to E.164
      const phone = this.normalisePhone(rawMsg.from);
      const phoneHash = this.hashPhone(phone);

      // ── Deduplication ──────────────────────────────────────────────────────
      const isDuplicate = await this.isDuplicateMessage(rawMsg.id);
      if (isDuplicate) {
        this.logger.debug(
          `[WhatsApp] Duplicate message ${rawMsg.id} from ${phoneHash} — skipped`,
        );
        return;
      }
      await this.markMessageProcessed(rawMsg.id);

      // ── Rate limiting ──────────────────────────────────────────────────────
      const rateLimited = await this.isRateLimited(phone);
      if (rateLimited) {
        this.logger.warn(`[WhatsApp] Rate limit exceeded for ${phoneHash}`);
        // Load session to get language for the throttle message
        const existingSession = await this.sessionService.get(phone);
        const lang = existingSession?.language ?? 'en';
        const msg = lang === 'sw' ? sw.rateLimitMessage : en.rateLimitMessage;
        await this.metaApi.sendText(phone, msg);
        return;
      }

      // ── Load or create session ─────────────────────────────────────────────
      let session = await this.sessionService.get(phone);
      if (!session) {
        session = this.sessionService.createFreshSession(phone);
      }

      // Extract text body from the message
      const messageText = this.extractMessageText(rawMsg);

      // ── Language detection ─────────────────────────────────────────────────
      if (messageText) {
        session.language = this.detectLanguage(messageText, session);
      }

      // ── Global command handling ────────────────────────────────────────────
      const normalised = messageText.trim().toLowerCase();
      const handledGlobal = await this.handleGlobalCommand(
        normalised,
        session,
        phone,
      );
      if (handledGlobal) {
        session.lastActivityAt = Date.now();
        await this.sessionService.set(phone, session);
        const durationMs = Date.now() - startMs;
        this.logger.log(
          `[WhatsApp] phone=${phoneHash} state=${session.state} cmd=global duration=${durationMs}ms`,
        );
        return;
      }

      // ── State dispatch ─────────────────────────────────────────────────────
      const intent = await this.dispatchToFlow(
        session,
        messageText,
        rawMsg,
        phone,
        contactName,
      );

      session.lastActivityAt = Date.now();
      await this.sessionService.set(phone, session);

      const durationMs = Date.now() - startMs;
      this.logger.log(
        `[WhatsApp] phone=${phoneHash} state=${session.state} intent=${intent} duration=${durationMs}ms`,
      );
    } catch (err) {
      const durationMs = Date.now() - startMs;
      this.logger.error(
        `[WhatsApp] Unhandled exception in handleInbound (duration=${durationMs}ms): ${this.errorMessage(err)}`,
        err instanceof Error ? err.stack : undefined,
      );

      // Best-effort: try to send a generic error message
      try {
        const entry = payload.entry?.[0];
        const rawMsg = entry?.changes?.[0]?.value?.messages?.[0];
        if (rawMsg?.from) {
          const phone = this.normalisePhone(rawMsg.from);
          await this.metaApi.sendText(phone, en.genericError);
        }
      } catch {
        // Swallow — we must never crash
      }
    }
  }

  // ─── Phone normalisation ───────────────────────────────────────────────────

  /**
   * Normalise a Kenyan phone number to E.164 (+2547xxxxxxxx).
   *
   * Handles:
   *   07xxxxxxxx   → +2547xxxxxxxx
   *   2547xxxxxxxx → +2547xxxxxxxx
   *   +2547xxxxxxxx → +2547xxxxxxxx (no change)
   *
   * Non-Kenyan numbers are returned as-is with a leading '+' if missing.
   */
  normalisePhone(raw: string): string {
    const digits = raw.replace(/\s+/g, '').replace(/^00/, '+');

    // Already E.164
    if (digits.startsWith('+')) return digits;

    // 07xxxxxxxx → +2547xxxxxxxx
    if (/^07\d{8}$/.test(digits)) {
      return '+254' + digits.slice(1);
    }

    // 2547xxxxxxxx → +2547xxxxxxxx
    if (/^2547\d{8}$/.test(digits)) {
      return '+' + digits;
    }

    // 7xxxxxxxx (9 digits starting with 7) → +2547xxxxxxxx
    if (/^7\d{8}$/.test(digits)) {
      return '+254' + digits;
    }

    // Fallback: prepend + if not present
    return '+' + digits;
  }

  // ─── Language detection ────────────────────────────────────────────────────

  /**
   * Detect language from message text.
   * Falls back to the member's stored preferredLanguage or the session's current language.
   */
  detectLanguage(text: string, session: ChatSession): 'en' | 'sw' {
    const words = text.toLowerCase().split(/\s+/);
    const swahiliCount = words.filter((w) => SWAHILI_KEYWORDS.has(w)).length;

    if (swahiliCount > 0) return 'sw';

    // Fall back to session language (which may have been set from member's preferredLanguage)
    return session.language;
  }

  // ─── Rate limiting ─────────────────────────────────────────────────────────

  /**
   * Sliding window rate limiter: 30 messages per 60 seconds per phone.
   * Uses Redis sorted set when available, in-memory Map otherwise.
   */
  async isRateLimited(phone: string): Promise<boolean> {
    const key = `whatsapp:ratelimit:${phone}`;
    const now = Date.now();
    const windowStart = now - RATE_LIMIT_WINDOW_MS;

    if (this.redis) {
      // Remove timestamps outside the window
      await this.redis.zremrangebyscore(key, '-inf', windowStart);
      // Count messages in window
      const count = await this.redis.zcard(key);
      if (count >= RATE_LIMIT_MAX) return true;
      // Add current timestamp
      await this.redis.zadd(key, now, `${now}`);
      // Set TTL on the key
      await this.redis.expire(key, Math.ceil(RATE_LIMIT_WINDOW_MS / 1000));
      return false;
    }

    // In-memory fallback
    const timestamps = (this.memRateLimit.get(phone) ?? []).filter(
      (ts) => ts > windowStart,
    );
    if (timestamps.length >= RATE_LIMIT_MAX) {
      this.memRateLimit.set(phone, timestamps);
      return true;
    }
    timestamps.push(now);
    this.memRateLimit.set(phone, timestamps);
    return false;
  }

  // ─── Message deduplication ─────────────────────────────────────────────────

  private async isDuplicateMessage(messageId: string): Promise<boolean> {
    const key = `whatsapp:msgid:${messageId}`;
    if (this.redis) {
      const exists = await this.redis.exists(key);
      return exists === 1;
    }
    // In-memory: not persisted across restarts, but good enough for dev
    return false;
  }

  private async markMessageProcessed(messageId: string): Promise<void> {
    const key = `whatsapp:msgid:${messageId}`;
    if (this.redis) {
      await this.redis.set(key, '1', 'EX', MSG_DEDUP_TTL);
    }
  }

  // ─── Global command handling ───────────────────────────────────────────────

  /**
   * Check for global navigation commands before state dispatch.
   * Returns true if a global command was handled (caller should skip state dispatch).
   */
  private async handleGlobalCommand(
    normalisedText: string,
    session: ChatSession,
    phone: string,
  ): Promise<boolean> {
    const lang = session.language;
    const msgs = lang === 'sw' ? sw : en;

    if (MENU_COMMANDS.has(normalisedText)) {
      session.previousState = session.state;
      session.state = ChatState.MAIN_MENU;
      session.unrecognisedCount = 0;
      await this.sendMainMenu(phone, session, msgs);
      return true;
    }

    if (BACK_COMMANDS.has(normalisedText)) {
      const target = session.previousState ?? ChatState.MAIN_MENU;
      session.previousState = session.state;
      session.state = target;
      session.unrecognisedCount = 0;
      if (target === ChatState.MAIN_MENU) {
        await this.sendMainMenu(phone, session, msgs);
      } else {
        // For non-menu states, just acknowledge and let the next message re-enter the flow
        await this.metaApi.sendText(phone, msgs.mainMenu());
      }
      return true;
    }

    if (CANCEL_COMMANDS.has(normalisedText)) {
      session.previousState = session.state;
      session.state = ChatState.MAIN_MENU;
      session.unrecognisedCount = 0;
      await this.sendMainMenu(phone, session, msgs);
      return true;
    }

    return false;
  }

  // ─── Main menu sender ──────────────────────────────────────────────────────

  private async sendMainMenu(
    phone: string,
    session: ChatSession,
    msgs: typeof en | typeof sw,
  ): Promise<void> {
    // Try to get member name for personalisation
    let memberName: string | undefined;
    if (session.memberId) {
      try {
        const member = await this.membersService.findById(session.memberId);
        memberName = member?.fullName ?? undefined;
      } catch {
        // Non-critical — proceed without name
      }
    }

    const bodyText = msgs.mainMenu(memberName);
    const sections = msgs.mainMenuSections;

    await this.metaApi.sendList(
      phone,
      bodyText,
      [
        {
          title: sections.accountTitle,
          rows: [
            sections.rows.subscription,
            sections.rows.visitHistory,
            sections.rows.referrals,
            sections.rows.accountSettings,
          ],
        },
        {
          title: sections.servicesTitle,
          rows: [
            sections.rows.findClinic,
            sections.rows.submitClaim,
            sections.rows.dentalHelp,
            sections.rows.talkDentist,
          ],
        },
      ],
      sections.buttonLabel,
      sections.header,
    );
  }

  // ─── State dispatch ────────────────────────────────────────────────────────

  /**
   * Dispatch the message to the correct flow based on session state.
   * Returns the detected intent for logging.
   */
  private async dispatchToFlow(
    session: ChatSession,
    messageText: string,
    rawMsg: MetaMessage,
    phone: string,
    contactName?: string,
  ): Promise<string> {
    const lang = session.language;
    const msgs = lang === 'sw' ? sw : en;

    // ── WELCOME state: member lookup ───────────────────────────────────────
    if (session.state === ChatState.WELCOME) {
      return this.handleWelcome(
        session,
        messageText,
        rawMsg,
        phone,
        contactName,
        msgs,
      );
    }

    // ── MAIN_MENU state: parse selection or classify intent ────────────────
    if (session.state === ChatState.MAIN_MENU) {
      return this.handleMainMenuInput(
        session,
        messageText,
        rawMsg,
        phone,
        msgs,
      );
    }

    // ── Subscription flow states ───────────────────────────────────────────
    if (
      session.state === ChatState.SUBSCRIPTION_VIEW ||
      session.state === ChatState.SUBSCRIPTION_SELECT_TIER ||
      session.state === ChatState.SUBSCRIPTION_SELECT_FREQUENCY ||
      session.state === ChatState.SUBSCRIPTION_AWAITING_PAYMENT
    ) {
      return this.delegateToFlow(
        'subscriptionFlow',
        this.subscriptionFlow,
        session,
        messageText,
        rawMsg,
        phone,
        msgs,
      );
    }

    // ── Clinic flow states ─────────────────────────────────────────────────
    if (
      session.state === ChatState.CLINIC_PROMPT_LOCATION ||
      session.state === ChatState.CLINIC_RESULTS
    ) {
      return this.delegateToFlow(
        'clinicFlow',
        this.clinicFlow,
        session,
        messageText,
        rawMsg,
        phone,
        msgs,
      );
    }

    // ── Claims flow states ─────────────────────────────────────────────────
    if (
      session.state === ChatState.CLAIMS_CHECK ||
      session.state === ChatState.CLAIMS_STATUS
    ) {
      return this.delegateToFlow(
        'claimsFlow',
        this.claimsFlow,
        session,
        messageText,
        rawMsg,
        phone,
        msgs,
      );
    }

    // ── Dental AI flow ─────────────────────────────────────────────────────
    if (session.state === ChatState.DENTAL_AI_CHAT) {
      return this.delegateToFlow(
        'dentalAiFlow',
        this.dentalAiFlow,
        session,
        messageText,
        rawMsg,
        phone,
        msgs,
      );
    }

    // ── Escalation flow ────────────────────────────────────────────────────
    if (session.state === ChatState.ESCALATION_OPTIONS) {
      return this.delegateToFlow(
        'escalationFlow',
        this.escalationFlow,
        session,
        messageText,
        rawMsg,
        phone,
        msgs,
      );
    }

    // ── Visit history flow ─────────────────────────────────────────────────
    if (session.state === ChatState.VISIT_HISTORY) {
      return this.delegateToFlow(
        'visitHistoryFlow',
        this.visitHistoryFlow,
        session,
        messageText,
        rawMsg,
        phone,
        msgs,
      );
    }

    // ── Referrals flow ─────────────────────────────────────────────────────
    if (session.state === ChatState.REFERRALS_VIEW) {
      return this.delegateToFlow(
        'referralsFlow',
        this.referralsFlow,
        session,
        messageText,
        rawMsg,
        phone,
        msgs,
      );
    }

    // ── Blockchain flow ────────────────────────────────────────────────────
    if (session.state === ChatState.BLOCKCHAIN_VIEW) {
      return this.delegateToFlow(
        'blockchainFlow',
        this.blockchainFlow,
        session,
        messageText,
        rawMsg,
        phone,
        msgs,
      );
    }

    // ── Account settings flow states ───────────────────────────────────────
    if (
      session.state === ChatState.ACCOUNT_SETTINGS ||
      session.state === ChatState.ACCOUNT_PROFILE ||
      session.state === ChatState.ACCOUNT_LANGUAGE ||
      session.state === ChatState.ACCOUNT_PAYMENT_HISTORY
    ) {
      return this.delegateToFlow(
        'accountSettingsFlow',
        this.accountSettingsFlow,
        session,
        messageText,
        rawMsg,
        phone,
        msgs,
      );
    }

    // ── Fallback: unknown state → reset to MAIN_MENU ───────────────────────
    this.logger.warn(
      `[WhatsApp] Unknown state ${session.state} — resetting to MAIN_MENU`,
    );
    session.state = ChatState.MAIN_MENU;
    await this.sendMainMenu(phone, session, msgs);
    return 'UNKNOWN_STATE';
  }

  // ─── Welcome handler ───────────────────────────────────────────────────────

  private async handleWelcome(
    session: ChatSession,
    messageText: string,
    rawMsg: MetaMessage,
    phone: string,
    contactName: string | undefined,
    msgs: typeof en | typeof sw,
  ): Promise<string> {
    // Look up member by phone number
    let member: Awaited<ReturnType<MembersService['findByPhone']>> = null;
    try {
      member = await this.membersService.findByPhone(phone);
    } catch (err) {
      this.logger.error(
        `[WhatsApp] Member lookup failed for ${this.hashPhone(phone)}: ${this.errorMessage(err)}`,
      );
    }

    if (member) {
      // Member found — set memberId and apply stored language preference
      session.memberId = member.id;
      if (
        member.preferredLanguage === 'sw' ||
        member.preferredLanguage === 'en'
      ) {
        session.language = member.preferredLanguage;
      }
      const updatedMsgs = session.language === 'sw' ? sw : en;
      const name = member.fullName ?? contactName;
      await this.metaApi.sendText(
        phone,
        updatedMsgs.welcome(name ?? undefined),
      );
      session.state = ChatState.MAIN_MENU;
      await this.sendMainMenu(phone, session, updatedMsgs);
    } else {
      // Member not found — prompt to register
      await this.metaApi.sendText(phone, msgs.registrationPrompt);
      // Stay in WELCOME state so next message re-triggers lookup
    }

    return 'WELCOME';
  }

  // ─── Main menu input handler ───────────────────────────────────────────────

  private async handleMainMenuInput(
    session: ChatSession,
    messageText: string,
    rawMsg: MetaMessage,
    phone: string,
    msgs: typeof en | typeof sw,
  ): Promise<string> {
    // Extract selection ID from interactive messages or text
    const selectionId = this.extractSelectionId(rawMsg) ?? messageText.trim();

    // Map selection to state
    const stateMap: Record<string, ChatState> = {
      '1': ChatState.SUBSCRIPTION_VIEW,
      menu_1: ChatState.SUBSCRIPTION_VIEW,
      '2': ChatState.CLINIC_PROMPT_LOCATION,
      menu_2: ChatState.CLINIC_PROMPT_LOCATION,
      '3': ChatState.CLAIMS_CHECK,
      menu_3: ChatState.CLAIMS_CHECK,
      '4': ChatState.DENTAL_AI_CHAT,
      menu_4: ChatState.DENTAL_AI_CHAT,
      '5': ChatState.ESCALATION_OPTIONS,
      menu_5: ChatState.ESCALATION_OPTIONS,
      '6': ChatState.VISIT_HISTORY,
      menu_6: ChatState.VISIT_HISTORY,
      '7': ChatState.REFERRALS_VIEW,
      menu_7: ChatState.REFERRALS_VIEW,
      '8': ChatState.VISIT_HISTORY,
      menu_8: ChatState.VISIT_HISTORY,
      '9': ChatState.ACCOUNT_SETTINGS,
      menu_9: ChatState.ACCOUNT_SETTINGS,
    };

    const targetState = stateMap[selectionId.toLowerCase()];
    if (targetState) {
      session.previousState = ChatState.MAIN_MENU;
      session.state = targetState;
      session.unrecognisedCount = 0;
      // Delegate to the appropriate flow immediately
      return this.dispatchToFlow(session, messageText, rawMsg, phone);
    }

    // Free-text: classify intent via LLM
    const intent = await this.llmService.classifyIntent(
      messageText,
      session.conversationHistory,
    );

    const intentStateMap: Record<IntentType, ChatState | null> = {
      SUBSCRIPTION_QUERY: ChatState.SUBSCRIPTION_VIEW,
      CLINIC_QUERY: ChatState.CLINIC_PROMPT_LOCATION,
      CLAIM_QUERY: ChatState.CLAIMS_CHECK,
      DENTAL_QUESTION: ChatState.DENTAL_AI_CHAT,
      ESCALATION_REQUEST: ChatState.ESCALATION_OPTIONS,
      VISIT_HISTORY_QUERY: ChatState.VISIT_HISTORY,
      REFERRAL_QUERY: ChatState.REFERRALS_VIEW,
      BLOCKCHAIN_QUERY: ChatState.VISIT_HISTORY,
      ACCOUNT_QUERY: ChatState.ACCOUNT_SETTINGS,
      MENU_NAVIGATION: ChatState.MAIN_MENU,
      UNRECOGNISED: null,
    };

    const intentTarget = intentStateMap[intent];

    if (intentTarget && intentTarget !== ChatState.MAIN_MENU) {
      session.previousState = ChatState.MAIN_MENU;
      session.state = intentTarget;
      session.unrecognisedCount = 0;
      return this.dispatchToFlow(session, messageText, rawMsg, phone);
    }

    if (intent === 'MENU_NAVIGATION') {
      session.unrecognisedCount = 0;
      await this.sendMainMenu(phone, session, msgs);
      return intent;
    }

    // Unrecognised input
    session.unrecognisedCount = (session.unrecognisedCount ?? 0) + 1;
    if (session.unrecognisedCount >= 3) {
      session.unrecognisedCount = 0;
      await this.metaApi.sendText(phone, msgs.unrecognisedInput);
      await this.sendMainMenu(phone, session, msgs);
    } else {
      await this.metaApi.sendText(phone, msgs.unrecognisedInput);
    }

    return intent;
  }

  // ─── Flow delegation ───────────────────────────────────────────────────────

  private async delegateToFlow(
    flowName: string,
    flow: FlowHandler | null | undefined,
    session: ChatSession,
    messageText: string,
    rawMsg: MetaMessage,
    phone: string,
    msgs: typeof en | typeof sw,
  ): Promise<string> {
    if (!flow) {
      this.logger.warn(
        `[WhatsApp] ${flowName} not yet implemented — sending coming soon message`,
      );
      await this.metaApi.sendText(
        phone,
        `This feature is coming soon! Type *menu* to return to the main menu.`,
      );
      return `${flowName.toUpperCase()}_NOT_IMPLEMENTED`;
    }

    try {
      await flow.handle(session, messageText, rawMsg);
    } catch (err) {
      this.logger.error(
        `[WhatsApp] Error in ${flowName}: ${this.errorMessage(err)}`,
        err instanceof Error ? err.stack : undefined,
      );
      await this.metaApi.sendText(phone, msgs.genericError);
    }

    return flowName.toUpperCase();
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  /**
   * Extract the text body from a Meta message.
   * Handles text, interactive button replies, and interactive list replies.
   */
  private extractMessageText(msg: MetaMessage): string {
    if (msg.type === 'text') {
      return msg.text?.body ?? '';
    }
    if (msg.type === 'interactive') {
      return (
        msg.interactive?.button_reply?.title ??
        msg.interactive?.list_reply?.title ??
        ''
      );
    }
    return '';
  }

  /**
   * Extract the selection ID from an interactive message.
   * Returns null for plain text messages.
   */
  private extractSelectionId(msg: MetaMessage): string | null {
    if (msg.type === 'interactive') {
      return (
        msg.interactive?.button_reply?.id ??
        msg.interactive?.list_reply?.id ??
        null
      );
    }
    return null;
  }

  /** One-way SHA-256 hash of the phone number for privacy-safe logging. */
  private hashPhone(phone: string): string {
    return crypto.createHash('sha256').update(phone).digest('hex').slice(0, 12);
  }

  private errorMessage(err: unknown): string {
    if (err instanceof Error) return err.message;
    return String(err);
  }
}
