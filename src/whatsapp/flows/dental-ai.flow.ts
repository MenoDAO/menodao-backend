// Feature: whatsapp-ai-chatbot
// Implements Requirement 8: Dental Health AI Assistance

import { Injectable, Logger } from '@nestjs/common';
import { SubscriptionsService } from '../../subscriptions/subscriptions.service';
import { MetaApiService } from '../meta-api.service';
import { SessionService } from '../session.service';
import { ChatSession, ChatState, ConversationTurn } from '../session.service';
import { LlmService, MemberContext } from '../llm.service';
import * as en from '../i18n/en';
import * as sw from '../i18n/sw';

type Messages = typeof en;

// Keywords that indicate the LLM is recommending a dentist visit
const DENTIST_RECOMMENDATION_PATTERNS = [
  'visit a dentist',
  'see a dentist',
  'consult a dentist',
  'dental professional',
  'visit a menohub',
  'menohub clinic',
  'proper diagnosis',
  'professional consultation',
  // Swahili equivalents
  'tembelea daktari',
  'ona daktari',
  'daktari wa meno',
  'kliniki ya menohub',
  'utambuzi sahihi',
];

// Maximum conversation history turns to retain (Requirement 2.3)
const MAX_HISTORY_TURNS = 10;

@Injectable()
export class DentalAiFlow {
  private readonly logger = new Logger(DentalAiFlow.name);

  constructor(
    private readonly llmService: LlmService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly metaApi: MetaApiService,
    private readonly sessionService: SessionService,
  ) {}

  // ─── Main entry point ───────────────────────────────────────────────────────

  /**
   * Called by WhatsAppService for DENTAL_AI_CHAT state and on first entry.
   * The third parameter matches the existing flow convention (phone string),
   * consistent with ClaimsFlow and ClinicFlow.
   */
  async handle(
    session: ChatSession,
    message: string,
    phone: string,
  ): Promise<void> {
    const t: Messages =
      session.language === 'sw' ? (sw as unknown as Messages) : en;

    // First entry: set state and show intro prompt
    if (session.state !== ChatState.DENTAL_AI_CHAT) {
      session.state = ChatState.DENTAL_AI_CHAT;
      session.previousState = ChatState.MAIN_MENU;
      await this.metaApi.sendText(phone, t.dentalAi.intro);
      await this.sessionService.set(phone, session);
      return;
    }

    // Already in DENTAL_AI_CHAT — process the dental question
    await this.handleDentalChat(session, message, phone, t);
  }

  // ─── DENTAL_AI_CHAT ─────────────────────────────────────────────────────────

  /**
   * Process a dental health question via the LLM.
   * Requirements 8.1–8.7:
   * - Send typing indicator before LLM/DB calls (Req 11.4)
   * - Call LlmService.dentalChat() with message, history (last 10), and member context
   * - Append turn to conversationHistory (cap at 10, evict oldest)
   * - Append clinic/escalation offer if LLM recommends seeing a dentist (Req 8.4)
   * - Send fallback + escalation offer on LLM error/timeout (Req 8.6)
   * - Include disclaimer in all dental responses (Req 8.7)
   */
  private async handleDentalChat(
    session: ChatSession,
    message: string,
    phone: string,
    t: Messages,
  ): Promise<void> {
    // Requirement 11.4: typing indicator before LLM/DB calls
    await this.metaApi.sendTypingIndicator(phone);

    // Requirement 8.3: build member context for the LLM system prompt
    const memberContext = await this.buildMemberContext(session);

    // Requirements 8.1, 8.2: call LLM with message, history, and member context
    const llmResponse = await this.llmService.dentalChat(
      message,
      session.conversationHistory.slice(-MAX_HISTORY_TURNS),
      memberContext,
      session.language,
    );

    // Requirement 8.6: detect fallback (LLM error/timeout) and offer escalation
    const isFallback = this.isFallbackResponse(llmResponse, session.language);
    if (isFallback) {
      await this.metaApi.sendButtons(phone, llmResponse, [
        { id: 'dental_escalate', title: '👨‍⚕️ Talk to a Dentist' },
        { id: 'dental_menu', title: t.navigation.menuButton },
      ]);
      await this.sessionService.set(phone, session);
      return;
    }

    // Requirement 2.3, 8.4: append turn to history, capped at MAX_HISTORY_TURNS
    this.appendToHistory(session, message, llmResponse);

    // Requirement 8.7: append disclaimer to every dental response
    let fullResponse = llmResponse + t.dentalAi.disclaimer;

    // Requirement 8.4: if LLM recommends seeing a dentist, append clinic/escalation offer
    const recommendsDentist = this.detectsDentistRecommendation(llmResponse);

    if (recommendsDentist) {
      fullResponse += t.dentalAi.clinicOffer;
      await this.metaApi.sendButtons(phone, fullResponse, [
        { id: 'dental_find_clinic', title: t.navigation.findClinicButton },
        { id: 'dental_escalate', title: '👨‍⚕️ Talk to a Dentist' },
        { id: 'dental_continue', title: '💬 Ask Another Question' },
      ]);
    } else {
      await this.metaApi.sendButtons(phone, fullResponse, [
        { id: 'dental_continue', title: '💬 Ask Another Question' },
        { id: 'dental_escalate', title: '👨‍⚕️ Talk to a Dentist' },
        { id: 'dental_menu', title: t.navigation.menuButton },
      ]);
    }

    await this.sessionService.set(phone, session);
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  /**
   * Build MemberContext from the session's memberId.
   * Falls back to null values if the member has no subscription or lookup fails.
   */
  private async buildMemberContext(
    session: ChatSession,
  ): Promise<MemberContext> {
    if (!session.memberId) {
      return {
        tier: null,
        annualCapLimit: null,
        annualCapUsed: null,
        isActive: false,
      };
    }

    try {
      const subscription = await this.subscriptionsService.getSubscription(
        session.memberId,
      );

      if (!subscription) {
        return {
          tier: null,
          annualCapLimit: null,
          annualCapUsed: null,
          isActive: false,
        };
      }

      return {
        tier: subscription.tier ?? null,
        annualCapLimit: subscription.annualCapLimit ?? null,
        annualCapUsed: subscription.annualCapUsed ?? null,
        isActive: subscription.isActive ?? false,
      };
    } catch (err) {
      this.logger.warn(
        `[DentalAiFlow] Could not load member context for ${session.memberId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return {
        tier: null,
        annualCapLimit: null,
        annualCapUsed: null,
        isActive: false,
      };
    }
  }

  /**
   * Append a user/assistant turn pair to conversationHistory.
   * Evicts the oldest turns when the cap is exceeded.
   * Requirement 2.3
   */
  private appendToHistory(
    session: ChatSession,
    userMessage: string,
    assistantResponse: string,
  ): void {
    const userTurn: ConversationTurn = { role: 'user', content: userMessage };
    const assistantTurn: ConversationTurn = {
      role: 'assistant',
      content: assistantResponse,
    };

    session.conversationHistory.push(userTurn, assistantTurn);

    while (session.conversationHistory.length > MAX_HISTORY_TURNS) {
      session.conversationHistory.shift();
    }
  }

  /**
   * Check whether the LLM response contains a dentist recommendation.
   * Requirement 8.4
   */
  private detectsDentistRecommendation(response: string): boolean {
    const lower = response.toLowerCase();
    return DENTIST_RECOMMENDATION_PATTERNS.some((pattern) =>
      lower.includes(pattern),
    );
  }

  /**
   * Detect if the response is the LlmService fallback message (error/timeout).
   * Requirement 8.6
   */
  private isFallbackResponse(response: string, language: 'en' | 'sw'): boolean {
    const fallbackEn = "I'm having trouble connecting right now";
    const fallbackSw = 'Nina tatizo la kuunganika sasa hivi';
    return language === 'sw'
      ? response.includes(fallbackSw)
      : response.includes(fallbackEn);
  }
}
