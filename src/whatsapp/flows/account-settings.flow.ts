// Feature: whatsapp-ai-chatbot
// Implements Requirement 10: Account Settings Flow

import { Injectable, Logger } from '@nestjs/common';
import { MembersService } from '../../members/members.service';
import { SubscriptionsService } from '../../subscriptions/subscriptions.service';
import { MetaApiService } from '../meta-api.service';
import { SessionService } from '../session.service';
import { ChatSession, ChatState } from '../session.service';
import { MetaMessage } from '../dto/webhook.dto';
import * as en from '../i18n/en';
import * as sw from '../i18n/sw';

// Union type for the i18n catalogue — both catalogues share the same shape
type Messages = typeof en;

// Maximum number of payment history entries to display (Requirement 10.4)
const MAX_PAYMENT_HISTORY = 5;

// ─── AccountSettingsFlow ──────────────────────────────────────────────────────

@Injectable()
export class AccountSettingsFlow {
  private readonly logger = new Logger(AccountSettingsFlow.name);

  constructor(
    private readonly membersService: MembersService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly metaApi: MetaApiService,
    private readonly sessionService: SessionService,
  ) {}

  // ─── Main entry point ───────────────────────────────────────────────────────

  /**
   * Called by WhatsAppService for ACCOUNT_SETTINGS, ACCOUNT_PROFILE,
   * ACCOUNT_LANGUAGE, and ACCOUNT_PAYMENT_HISTORY states.
   * Matches the FlowHandler interface: handle(session, message, rawMsg).
   * Phone is derived from session.phoneNumber.
   */
  async handle(
    session: ChatSession,
    message: string,
    rawMsg: MetaMessage,
  ): Promise<void> {
    const phone = session.phoneNumber;
    const t: Messages =
      session.language === 'sw' ? (sw as unknown as Messages) : en;

    // Extract reply ID from interactive button or plain text
    const replyId =
      rawMsg.interactive?.button_reply?.id ??
      rawMsg.interactive?.list_reply?.id ??
      message.trim().toLowerCase();

    // ── Route based on current state ─────────────────────────────────────────

    switch (session.state) {
      case ChatState.ACCOUNT_SETTINGS:
        return this.handleAccountSettings(session, phone, replyId, t);

      case ChatState.ACCOUNT_PROFILE:
        return this.handleAccountProfile(session, phone, replyId, t);

      case ChatState.ACCOUNT_LANGUAGE:
        return this.handleAccountLanguage(session, phone, replyId, t);

      case ChatState.ACCOUNT_PAYMENT_HISTORY:
        return this.handleAccountPaymentHistory(session, phone, replyId, t);

      default:
        // First entry: set state to ACCOUNT_SETTINGS and show menu
        session.state = ChatState.ACCOUNT_SETTINGS;
        session.previousState = ChatState.MAIN_MENU;
        return this.handleAccountSettings(session, phone, replyId, t);
    }
  }

  // ─── ACCOUNT_SETTINGS ────────────────────────────────────────────────────────

  /**
   * Present the account settings menu with 3 options.
   * Requirement 10.1: View profile, Change language preference, View payment history.
   */
  private async handleAccountSettings(
    session: ChatSession,
    phone: string,
    replyId: string,
    t: Messages,
  ): Promise<void> {
    // Handle navigation back to main menu
    if (
      replyId === 'account_back' ||
      replyId === 'back' ||
      replyId === 'rudi' ||
      replyId === 'menu' ||
      replyId === 'menyu' ||
      replyId === '0'
    ) {
      session.state = ChatState.MAIN_MENU;
      session.previousState = ChatState.ACCOUNT_SETTINGS;
      await this.sessionService.set(phone, session);
      return;
    }

    // Handle sub-option selections
    if (
      replyId === t.accountSettings.optionProfile.id ||
      replyId === t.accountSettings.optionProfile.title.toLowerCase()
    ) {
      session.previousState = ChatState.ACCOUNT_SETTINGS;
      session.state = ChatState.ACCOUNT_PROFILE;
      await this.sessionService.set(phone, session);
      return this.showProfile(session, phone, t);
    }

    if (
      replyId === t.accountSettings.optionLanguage.id ||
      replyId === t.accountSettings.optionLanguage.title.toLowerCase()
    ) {
      session.previousState = ChatState.ACCOUNT_SETTINGS;
      session.state = ChatState.ACCOUNT_LANGUAGE;
      await this.sessionService.set(phone, session);
      return this.showLanguageOptions(phone, t);
    }

    if (
      replyId === t.accountSettings.optionPaymentHistory.id ||
      replyId === t.accountSettings.optionPaymentHistory.title.toLowerCase()
    ) {
      session.previousState = ChatState.ACCOUNT_SETTINGS;
      session.state = ChatState.ACCOUNT_PAYMENT_HISTORY;
      await this.sessionService.set(phone, session);
      return this.showPaymentHistory(session, phone, t);
    }

    // Default: show the account settings menu
    await this.metaApi.sendButtons(phone, t.accountSettings.menuPrompt, [
      {
        id: t.accountSettings.optionProfile.id,
        title: t.accountSettings.optionProfile.title,
      },
      {
        id: t.accountSettings.optionLanguage.id,
        title: t.accountSettings.optionLanguage.title,
      },
      {
        id: t.accountSettings.optionPaymentHistory.id,
        title: t.accountSettings.optionPaymentHistory.title,
      },
    ]);

    await this.sessionService.set(phone, session);
  }

  // ─── ACCOUNT_PROFILE ─────────────────────────────────────────────────────────

  /**
   * Handle the ACCOUNT_PROFILE state — display profile or route sub-actions.
   */
  private async handleAccountProfile(
    session: ChatSession,
    phone: string,
    replyId: string,
    t: Messages,
  ): Promise<void> {
    // Handle navigation back to account settings
    if (
      replyId === 'account_profile_back' ||
      replyId === 'back' ||
      replyId === 'rudi'
    ) {
      session.state = ChatState.ACCOUNT_SETTINGS;
      session.previousState = ChatState.ACCOUNT_PROFILE;
      await this.sessionService.set(phone, session);
      return this.handleAccountSettings(session, phone, '', t);
    }

    if (replyId === 'menu' || replyId === 'menyu' || replyId === '0') {
      session.state = ChatState.MAIN_MENU;
      session.previousState = ChatState.ACCOUNT_PROFILE;
      await this.sessionService.set(phone, session);
      return;
    }

    // Show profile
    return this.showProfile(session, phone, t);
  }

  /**
   * Display the member's profile information.
   * Requirement 10.2: full name, phone (masked), subscription tier, member since date.
   * Requirement 10.5: do NOT expose sensitive fields.
   */
  private async showProfile(
    session: ChatSession,
    phone: string,
    t: Messages,
  ): Promise<void> {
    if (!session.memberId) {
      await this.metaApi.sendText(phone, t.genericError);
      await this.sessionService.set(phone, session);
      return;
    }

    try {
      const member = await this.membersService.findById(session.memberId);

      // Requirement 10.2: display full name, masked phone, subscription tier, member since
      const fullName = member.fullName ?? 'Unknown';

      // Requirement 10.5 + 12.3: mask phone as +254***{last4}
      const maskedPhone = this.maskPhone(member.phoneNumber);

      // Subscription tier — use 'None' if no active subscription
      const subscription = member.subscription;
      const tierName = subscription?.isActive
        ? `Meno${subscription.tier.charAt(0) + subscription.tier.slice(1).toLowerCase()}`
        : 'No active plan';

      // Member since date
      const memberSince = new Date(member.createdAt).toLocaleDateString(
        'en-KE',
        { year: 'numeric', month: 'long', day: 'numeric' },
      );

      const profileText = t.accountSettings.profile(
        fullName,
        maskedPhone,
        tierName,
        memberSince,
      );

      await this.metaApi.sendButtons(phone, profileText, [
        { id: 'account_profile_back', title: t.navigation.backButton },
        { id: 'account_back', title: t.navigation.menuButton },
      ]);

      await this.sessionService.set(phone, session);
    } catch (err) {
      this.logger.error(
        `[AccountSettingsFlow] Error in showProfile for ${this.hashPhone(phone)}: ${err instanceof Error ? err.message : String(err)}`,
      );
      await this.metaApi.sendText(phone, t.genericError);
    }
  }

  // ─── ACCOUNT_LANGUAGE ────────────────────────────────────────────────────────

  /**
   * Handle the ACCOUNT_LANGUAGE state — show language options or process selection.
   */
  private async handleAccountLanguage(
    session: ChatSession,
    phone: string,
    replyId: string,
    t: Messages,
  ): Promise<void> {
    // Handle navigation back
    if (
      replyId === 'account_language_back' ||
      replyId === 'back' ||
      replyId === 'rudi'
    ) {
      session.state = ChatState.ACCOUNT_SETTINGS;
      session.previousState = ChatState.ACCOUNT_LANGUAGE;
      await this.sessionService.set(phone, session);
      return this.handleAccountSettings(session, phone, '', t);
    }

    if (replyId === 'menu' || replyId === 'menyu' || replyId === '0') {
      session.state = ChatState.MAIN_MENU;
      session.previousState = ChatState.ACCOUNT_LANGUAGE;
      await this.sessionService.set(phone, session);
      return;
    }

    // Handle language selection
    if (
      replyId === en.accountSettings.languageEnglish.id ||
      replyId === 'english'
    ) {
      return this.updateLanguage(session, phone, 'en');
    }

    if (
      replyId === en.accountSettings.languageSwahili.id ||
      replyId === 'kiswahili' ||
      replyId === 'swahili'
    ) {
      return this.updateLanguage(session, phone, 'sw');
    }

    // Default: show language options
    return this.showLanguageOptions(phone, t);
  }

  /**
   * Display language selection buttons.
   * Requirement 10.3: present English and Swahili options.
   */
  private async showLanguageOptions(phone: string, t: Messages): Promise<void> {
    await this.metaApi.sendButtons(phone, t.accountSettings.languagePrompt, [
      {
        id: t.accountSettings.languageEnglish.id,
        title: t.accountSettings.languageEnglish.title,
      },
      {
        id: t.accountSettings.languageSwahili.id,
        title: t.accountSettings.languageSwahili.title,
      },
    ]);
  }

  /**
   * Update the member's language preference in session and database.
   * Requirement 10.3: update session.language and persist preferredLanguage in DB.
   * Requirement 3.4, 3.5: persist language change to member record.
   */
  private async updateLanguage(
    session: ChatSession,
    phone: string,
    lang: 'en' | 'sw',
  ): Promise<void> {
    // Update session language immediately
    session.language = lang;

    // Use the new language's catalogue for the confirmation message
    const newT: Messages = lang === 'sw' ? (sw as unknown as Messages) : en;
    const langName = lang === 'en' ? 'English' : 'Kiswahili';

    // Persist to database if member is known
    if (session.memberId) {
      try {
        await this.membersService.update(session.memberId, {
          preferredLanguage: lang,
        });
        this.logger.log(
          `[AccountSettingsFlow] Language updated to ${lang} for member ${session.memberId}`,
        );
      } catch (err) {
        this.logger.error(
          `[AccountSettingsFlow] Failed to persist language for ${this.hashPhone(phone)}: ${err instanceof Error ? err.message : String(err)}`,
        );
        // Continue — session language is already updated; DB failure is non-fatal
      }
    }

    // Confirm the change in the new language
    const confirmText = newT.accountSettings.languageUpdated(langName);

    // Transition back to ACCOUNT_SETTINGS
    session.state = ChatState.ACCOUNT_SETTINGS;
    session.previousState = ChatState.ACCOUNT_LANGUAGE;

    await this.metaApi.sendButtons(phone, confirmText, [
      { id: 'account_back', title: newT.navigation.menuButton },
    ]);

    await this.sessionService.set(phone, session);
  }

  // ─── ACCOUNT_PAYMENT_HISTORY ──────────────────────────────────────────────────

  /**
   * Handle the ACCOUNT_PAYMENT_HISTORY state — display or route sub-actions.
   */
  private async handleAccountPaymentHistory(
    session: ChatSession,
    phone: string,
    replyId: string,
    t: Messages,
  ): Promise<void> {
    // Handle navigation back
    if (
      replyId === 'account_payments_back' ||
      replyId === 'back' ||
      replyId === 'rudi'
    ) {
      session.state = ChatState.ACCOUNT_SETTINGS;
      session.previousState = ChatState.ACCOUNT_PAYMENT_HISTORY;
      await this.sessionService.set(phone, session);
      return this.handleAccountSettings(session, phone, '', t);
    }

    if (replyId === 'menu' || replyId === 'menyu' || replyId === '0') {
      session.state = ChatState.MAIN_MENU;
      session.previousState = ChatState.ACCOUNT_PAYMENT_HISTORY;
      await this.sessionService.set(phone, session);
      return;
    }

    // Show payment history
    return this.showPaymentHistory(session, phone, t);
  }

  /**
   * Retrieve and display the last 5 contributions.
   * Requirement 10.4: call MembersService.getContributionHistory(), display last 5
   * entries with amount, date, and status.
   */
  private async showPaymentHistory(
    session: ChatSession,
    phone: string,
    t: Messages,
  ): Promise<void> {
    if (!session.memberId) {
      await this.metaApi.sendText(phone, t.genericError);
      await this.sessionService.set(phone, session);
      return;
    }

    try {
      // Requirement 10.4: retrieve last 5 contributions
      const result = await this.membersService.getContributionHistory(
        session.memberId,
        1,
        MAX_PAYMENT_HISTORY,
      );

      const contributions = result.data;

      if (!contributions || contributions.length === 0) {
        await this.metaApi.sendButtons(
          phone,
          t.accountSettings.paymentHistoryHeader + t.accountSettings.noPayments,
          [
            { id: 'account_payments_back', title: t.navigation.backButton },
            { id: 'account_back', title: t.navigation.menuButton },
          ],
        );
        await this.sessionService.set(phone, session);
        return;
      }

      // Build payment history message
      let historyText = t.accountSettings.paymentHistoryHeader;

      for (const contribution of contributions) {
        const date = new Date(contribution.createdAt).toLocaleDateString(
          'en-KE',
          { year: 'numeric', month: 'short', day: 'numeric' },
        );
        const amount = Number(contribution.amount);
        const status = contribution.status ?? 'UNKNOWN';

        historyText +=
          '\n' + t.accountSettings.paymentEntry(date, amount, status);
      }

      historyText += t.accountSettings.footer;

      await this.metaApi.sendButtons(phone, historyText, [
        { id: 'account_payments_back', title: t.navigation.backButton },
        { id: 'account_back', title: t.navigation.menuButton },
      ]);

      await this.sessionService.set(phone, session);
    } catch (err) {
      this.logger.error(
        `[AccountSettingsFlow] Error in showPaymentHistory for ${this.hashPhone(phone)}: ${err instanceof Error ? err.message : String(err)}`,
      );
      await this.metaApi.sendText(phone, t.genericError);
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  /**
   * Mask a phone number for privacy-safe display.
   * Requirement 10.5 + 12.3: format +254***{last4}.
   * E.g. +254712345678 → +254***5678
   */
  private maskPhone(phone: string): string {
    if (!phone) return '+254***????';
    // Normalise to E.164 if needed
    const e164 = phone.startsWith('+') ? phone : `+${phone}`;
    const last4 = e164.slice(-4);
    return `+254***${last4}`;
  }

  /** One-way hash of phone number for privacy-safe logging (last 4 digits). */
  private hashPhone(phone: string): string {
    return `***${phone.slice(-4)}`;
  }
}
