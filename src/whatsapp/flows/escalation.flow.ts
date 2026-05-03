import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MetaApiService } from '../meta-api.service';
import { SessionService } from '../session.service';
import { ChatSession, ChatState } from '../session.service';
import { MetaMessage } from '../dto/webhook.dto';
import * as en from '../i18n/en';
import * as sw from '../i18n/sw';

// Union type for the i18n catalogue — both catalogues share the same shape
type Messages = typeof en;

// ─── EscalationFlow ───────────────────────────────────────────────────────────

/**
 * Handles the ESCALATION_OPTIONS state.
 *
 * Requirements 9.1–9.5:
 *   9.1 Present options: (a) connect via WhatsApp to partner dentist, (b) find nearest clinic
 *   9.2 On option (a): send WHATSAPP_PARTNER_DENTIST_CONTACT; fall back to support email / web app
 *   9.3 Log all escalation events with memberId, timestamp, and reason
 *   9.4 Notify member that a human will respond within 24 hours (8am–6pm EAT, Mon–Sat)
 *   9.5 If no partner dentist configured: fall back to support email or web app link
 */
@Injectable()
export class EscalationFlow {
  private readonly logger = new Logger(EscalationFlow.name);

  constructor(
    private readonly metaApi: MetaApiService,
    private readonly sessionService: SessionService,
    private readonly configService: ConfigService,
  ) {}

  // ─── Main entry point ───────────────────────────────────────────────────────

  /**
   * Called by WhatsAppService for any message while session.state === ESCALATION_OPTIONS.
   *
   * @param session   Current chat session
   * @param message   Extracted text / button reply ID
   * @param rawMsg    Raw Meta message object (unused here but required by FlowHandler interface)
   */
  async handle(
    session: ChatSession,
    message: string,
    rawMsg: MetaMessage,
  ): Promise<void> {
    const t: Messages =
      session.language === 'sw' ? (sw as unknown as Messages) : en;

    switch (session.state) {
      case ChatState.ESCALATION_OPTIONS:
        return this.handleEscalationOptions(session, message, rawMsg, t);

      default:
        // Entry point: show the escalation options menu
        return this.showEscalationOptions(session, rawMsg.from, t);
    }
  }

  // ─── Show escalation options ─────────────────────────────────────────────────

  /**
   * Requirement 9.1: Present escalation options as interactive buttons.
   */
  private async showEscalationOptions(
    session: ChatSession,
    phone: string,
    t: Messages,
  ): Promise<void> {
    session.state = ChatState.ESCALATION_OPTIONS;
    session.previousState = ChatState.MAIN_MENU;
    await this.sessionService.set(phone, session);

    await this.metaApi.sendButtons(phone, t.escalation.optionsPrompt, [
      {
        id: t.escalation.optionWhatsApp.id,
        title: t.escalation.optionWhatsApp.title,
      },
      {
        id: t.escalation.optionClinic.id,
        title: t.escalation.optionClinic.title,
      },
    ]);
  }

  // ─── Handle ESCALATION_OPTIONS state ────────────────────────────────────────

  /**
   * Route the member's choice to the appropriate escalation path.
   */
  private async handleEscalationOptions(
    session: ChatSession,
    message: string,
    rawMsg: MetaMessage,
    t: Messages,
  ): Promise<void> {
    // Resolve the phone from the raw message
    const phone = rawMsg.from;

    // Extract reply ID from interactive message or fall back to plain text
    const replyId =
      rawMsg.interactive?.button_reply?.id ??
      rawMsg.interactive?.list_reply?.id ??
      message.toLowerCase().trim();

    const isWhatsAppOption =
      replyId === 'escalate_whatsapp' ||
      replyId.includes('whatsapp') ||
      replyId.includes('daktari wa whatsapp') ||
      replyId.includes('connect') ||
      replyId.includes('unganika');

    const isClinicOption =
      replyId === 'escalate_clinic' ||
      replyId.includes('clinic') ||
      replyId.includes('kliniki') ||
      replyId.includes('find') ||
      replyId.includes('tafuta');

    const isBack =
      replyId === 'back' ||
      replyId === 'rudi' ||
      replyId === 'menu' ||
      replyId === 'menyu' ||
      replyId === '0' ||
      replyId === t.navigation.menuButton.toLowerCase();

    if (isWhatsAppOption) {
      await this.handleWhatsAppEscalation(
        session,
        phone,
        t,
        'WhatsApp contact request',
      );
    } else if (isClinicOption) {
      await this.handleClinicEscalation(session, phone, t);
    } else if (isBack) {
      session.state = ChatState.MAIN_MENU;
      session.previousState = ChatState.ESCALATION_OPTIONS;
      await this.sessionService.set(phone, session);
    } else {
      // Unrecognised — re-show the options
      await this.showEscalationOptions(session, phone, t);
    }
  }

  // ─── Option (a): Connect via WhatsApp ────────────────────────────────────────

  /**
   * Requirements 9.2, 9.4, 9.5:
   * Send the partner dentist's WhatsApp number.
   * If not configured, fall back to support email or web app link.
   * Notify member about 24-hour response window.
   * Log the escalation event.
   */
  private async handleWhatsAppEscalation(
    session: ChatSession,
    phone: string,
    t: Messages,
    reason: string,
  ): Promise<void> {
    // Requirement 9.3: Log escalation event with memberId, timestamp, and reason
    this.logEscalationEvent(session.memberId, reason);

    const partnerContact = this.configService.get<string>(
      'WHATSAPP_PARTNER_DENTIST_CONTACT',
    );

    if (partnerContact) {
      // Requirement 9.2: Send partner dentist contact number
      // Requirement 9.4: Include 24-hour response window notice
      await this.metaApi.sendText(
        phone,
        t.escalation.whatsAppContact(partnerContact),
      );
    } else {
      // Requirement 9.5: Fall back to support email or web app link
      const supportEmail =
        this.configService.get<string>('WHATSAPP_SUPPORT_EMAIL') ??
        'support@menodao.org';

      await this.metaApi.sendText(
        phone,
        t.escalation.fallbackContact(supportEmail),
      );
    }

    // Send escalation initiated confirmation
    await this.metaApi.sendText(phone, t.escalation.initiated);

    // Transition to MAIN_MENU after escalation is initiated
    session.previousState = ChatState.ESCALATION_OPTIONS;
    session.state = ChatState.MAIN_MENU;
    await this.sessionService.set(phone, session);
  }

  // ─── Option (b): Find nearest clinic ─────────────────────────────────────────

  /**
   * Redirect the member to the clinic finder flow.
   * Log the escalation event.
   */
  private async handleClinicEscalation(
    session: ChatSession,
    phone: string,
    t: Messages,
  ): Promise<void> {
    // Requirement 9.3: Log escalation event
    this.logEscalationEvent(session.memberId, 'Find nearest clinic');

    // Transition to clinic finder flow
    session.previousState = ChatState.ESCALATION_OPTIONS;
    session.state = ChatState.CLINIC_PROMPT_LOCATION;
    await this.sessionService.set(phone, session);

    // Prompt the member to share their location
    await this.metaApi.sendText(phone, t.clinic.promptLocation);
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  /**
   * Requirement 9.3: Log escalation event with memberId, timestamp, and reason.
   */
  private logEscalationEvent(memberId: string | null, reason: string): void {
    this.logger.log(
      JSON.stringify({
        event: 'escalation',
        memberId: memberId ?? 'unknown',
        timestamp: new Date().toISOString(),
        reason,
      }),
    );
  }
}
