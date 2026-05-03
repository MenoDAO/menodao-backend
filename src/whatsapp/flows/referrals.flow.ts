// Feature: whatsapp-ai-chatbot
// Implements Requirement 15: Champions Referral Flow

import { Injectable, Logger } from '@nestjs/common';
import { ReferralService } from '../../referrals/referral.service';
import { MetaApiService } from '../meta-api.service';
import { SessionService } from '../session.service';
import { ChatSession, ChatState } from '../session.service';
import { MetaMessage } from '../dto/webhook.dto';
import * as en from '../i18n/en';
import * as sw from '../i18n/sw';

// Union type for the i18n catalogue — both catalogues share the same shape
type Messages = typeof en;

// ─── ReferralsFlow ────────────────────────────────────────────────────────────

@Injectable()
export class ReferralsFlow {
  private readonly logger = new Logger(ReferralsFlow.name);

  constructor(
    private readonly referralService: ReferralService,
    private readonly metaApi: MetaApiService,
    private readonly sessionService: SessionService,
  ) {}

  // ─── Main entry point ───────────────────────────────────────────────────────

  /**
   * Called by WhatsAppService for REFERRALS_VIEW state.
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

    // Set state on first entry
    if (session.state !== ChatState.REFERRALS_VIEW) {
      session.state = ChatState.REFERRALS_VIEW;
      session.previousState = ChatState.MAIN_MENU;
    }

    // Extract reply ID from interactive button or plain text
    const replyId =
      rawMsg.interactive?.button_reply?.id ??
      rawMsg.interactive?.list_reply?.id ??
      message.trim().toLowerCase();

    // Handle "share my code" button reply
    if (
      replyId === 'referrals_share' ||
      replyId === t.referrals.shareButton.toLowerCase()
    ) {
      return this.sendShareableMessage(session, phone, t);
    }

    // Handle back/menu navigation
    if (
      replyId === 'referrals_back' ||
      replyId === 'back' ||
      replyId === 'rudi' ||
      replyId === 'menu' ||
      replyId === 'menyu' ||
      replyId === '0'
    ) {
      session.state = ChatState.MAIN_MENU;
      session.previousState = ChatState.REFERRALS_VIEW;
      await this.sessionService.set(phone, session);
      return;
    }

    // Default: show referral stats
    await this.showReferralStats(session, phone, t);
  }

  // ─── REFERRALS_VIEW ─────────────────────────────────────────────────────────

  /**
   * Retrieve and display the member's champion referral stats.
   * Requirements 15.1, 15.3, 15.4, 15.5, 15.6
   */
  private async showReferralStats(
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
      // Requirement 15.1, 15.5: retrieve referral data from member record via ReferralService
      const stats = await this.referralService.getChampionStats(
        session.memberId,
      );
      const referralCode = stats.referralCode;

      if (!referralCode) {
        await this.metaApi.sendText(phone, t.genericError);
        await this.sessionService.set(phone, session);
        return;
      }

      let statsMessage = t.referrals.header;

      if (stats.totalReferrals > 0) {
        // Requirement 15.3: show referral count and reward status
        // Requirement 15.6: display reward amounts in member's preferred language
        const rewardsText = this.formatRewards(
          stats.commissionsBalance,
          stats.commissionsEarned,
        );
        statsMessage += t.referrals.statsActive(
          referralCode,
          stats.totalReferrals,
          rewardsText,
        );
      } else {
        // Requirement 15.4: zero referrals → encourage sharing, explain benefits, show code
        statsMessage += t.referrals.statsEmpty(referralCode);
      }

      statsMessage += t.referrals.footer;

      // Requirement 15.2: offer to send a pre-formatted shareable message
      await this.metaApi.sendButtons(phone, statsMessage, [
        { id: 'referrals_share', title: t.referrals.shareButton },
        { id: 'referrals_back', title: t.navigation.menuButton },
      ]);

      await this.sessionService.set(phone, session);
    } catch (err) {
      this.logger.error(
        `[ReferralsFlow] Error in showReferralStats for ${this.hashPhone(phone)}: ${err instanceof Error ? err.message : String(err)}`,
      );
      await this.metaApi.sendText(phone, t.genericError);
    }
  }

  // ─── Share referral code ────────────────────────────────────────────────────

  /**
   * Send a pre-formatted shareable message containing the referral code/link.
   * Requirement 15.2
   */
  private async sendShareableMessage(
    session: ChatSession,
    phone: string,
    t: Messages,
  ): Promise<void> {
    if (!session.memberId) {
      await this.metaApi.sendText(phone, t.genericError);
      return;
    }

    try {
      const stats = await this.referralService.getChampionStats(
        session.memberId,
      );
      const referralCode = stats.referralCode;

      if (!referralCode) {
        await this.metaApi.sendText(phone, t.genericError);
        return;
      }

      // Requirement 15.2: pre-formatted shareable message the member can forward directly
      const shareMessage = t.referrals.shareableMessage(referralCode);
      await this.metaApi.sendText(phone, shareMessage);

      // Offer to return to main menu
      await this.metaApi.sendButtons(phone, t.referrals.footer.trim(), [
        { id: 'referrals_back', title: t.navigation.menuButton },
      ]);

      await this.sessionService.set(phone, session);
    } catch (err) {
      this.logger.error(
        `[ReferralsFlow] Error in sendShareableMessage for ${this.hashPhone(phone)}: ${err instanceof Error ? err.message : String(err)}`,
      );
      await this.metaApi.sendText(phone, t.genericError);
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  /**
   * Format the rewards summary string in KES.
   * Requirement 15.6: reward amounts displayed consistently.
   */
  private formatRewards(balance: number, totalEarned: number): string {
    return `KES ${balance.toLocaleString()} balance (KES ${totalEarned.toLocaleString()} total earned)`;
  }

  /** One-way hash of phone number for privacy-safe logging (last 4 digits). */
  private hashPhone(phone: string): string {
    return `***${phone.slice(-4)}`;
  }
}
