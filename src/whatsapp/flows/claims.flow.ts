import { Injectable, Logger } from '@nestjs/common';
import { SubscriptionsService } from '../../subscriptions/subscriptions.service';
import { MembersService } from '../../members/members.service';
import { MetaApiService } from '../meta-api.service';
import { SessionService } from '../session.service';
import { ChatSession, ChatState } from '../session.service';
import * as en from '../i18n/en';
import * as sw from '../i18n/sw';

// Union type for the i18n catalogue — both catalogues share the same shape
type Messages = typeof en;

// ─── ClaimsFlow ───────────────────────────────────────────────────────────────

@Injectable()
export class ClaimsFlow {
  private readonly logger = new Logger(ClaimsFlow.name);

  constructor(
    private readonly subscriptionsService: SubscriptionsService,
    private readonly membersService: MembersService,
    private readonly metaApi: MetaApiService,
    private readonly sessionService: SessionService,
  ) {}

  // ─── Main entry point ───────────────────────────────────────────────────────

  async handle(
    session: ChatSession,
    message: string,
    phone: string,
  ): Promise<void> {
    const t: Messages =
      session.language === 'sw' ? (sw as unknown as Messages) : en;

    switch (session.state) {
      case ChatState.CLAIMS_CHECK:
        return this.handleClaimsCheck(session, message, phone, t);

      case ChatState.CLAIMS_STATUS:
        return this.handleClaimsStatus(session, message, phone, t);

      default:
        // Entry point: run the eligibility check
        return this.showClaimsCheck(session, phone, t);
    }
  }

  // ─── CLAIMS_CHECK ───────────────────────────────────────────────────────────

  /**
   * Entry point for the claims flow.
   * Checks subscription status and waiting period, then routes accordingly.
   */
  private async showClaimsCheck(
    session: ChatSession,
    phone: string,
    t: Messages,
  ): Promise<void> {
    session.state = ChatState.CLAIMS_CHECK;
    session.previousState = ChatState.MAIN_MENU;

    if (!session.memberId) {
      await this.metaApi.sendText(phone, t.genericError);
      await this.sessionService.set(phone, session);
      return;
    }

    try {
      // 1. Check if member has an active subscription
      const subscription = await this.subscriptionsService.getSubscription(
        session.memberId,
      );

      if (!subscription || !subscription.isActive) {
        // Requirement 7.2: No active subscription → inform and redirect to subscription flow
        await this.metaApi.sendButtons(phone, t.claims.noSubscription, [
          { id: 'claims_view_plans', title: '📋 View Plans' },
          { id: 'claims_back', title: t.navigation.menuButton },
        ]);
        await this.sessionService.set(phone, session);
        return;
      }

      // 2. Check waiting period status
      const wpStatus = await this.subscriptionsService.getWaitingPeriodStatus(
        session.memberId,
      );

      const isInWaitingPeriod = !wpStatus.consultationsExtractions.available;

      if (isInWaitingPeriod) {
        // Requirement 7.3: Within waiting period → show exact eligible date
        const eligibleDate = new Date(
          wpStatus.consultationsExtractions.eligibleDate!,
        ).toLocaleDateString('en-KE', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        });

        await this.metaApi.sendButtons(
          phone,
          t.claims.inWaitingPeriod(eligibleDate),
          [
            { id: 'claims_status', title: '📋 Check Claim Status' },
            { id: 'claims_back', title: t.navigation.menuButton },
          ],
        );
        await this.sessionService.set(phone, session);
        return;
      }

      // Requirement 7.4: Eligible → inform about clinic submission, offer clinic finder
      await this.metaApi.sendButtons(phone, t.claims.eligible, [
        { id: 'claims_find_clinic', title: t.navigation.findClinicButton },
        { id: 'claims_status', title: '📋 Check Claim Status' },
        { id: 'claims_back', title: t.navigation.menuButton },
      ]);

      await this.sessionService.set(phone, session);
    } catch (err) {
      this.logger.error(
        `[ClaimsFlow] Error in showClaimsCheck for ${this.hashPhone(phone)}: ${err instanceof Error ? err.message : String(err)}`,
      );
      await this.metaApi.sendText(phone, t.genericError);
    }
  }

  /**
   * Handle button replies in the CLAIMS_CHECK state.
   */
  private async handleClaimsCheck(
    session: ChatSession,
    message: string,
    phone: string,
    t: Messages,
  ): Promise<void> {
    const msg = message.toLowerCase().trim();

    if (
      msg === 'claims_find_clinic' ||
      msg.includes('find clinic') ||
      msg.includes('tafuta kliniki') ||
      msg === t.navigation.findClinicButton.toLowerCase()
    ) {
      // Transition to clinic finder flow
      session.previousState = ChatState.CLAIMS_CHECK;
      session.state = ChatState.CLINIC_PROMPT_LOCATION;
      await this.sessionService.set(phone, session);
      // WhatsAppService will dispatch to ClinicFlow on next message
      // Send a prompt so the member knows what to do
      await this.metaApi.sendText(phone, t.clinic.promptLocation);
    } else if (
      msg === 'claims_view_plans' ||
      msg.includes('view plans') ||
      msg.includes('angalia mipango')
    ) {
      // Redirect to subscription flow
      session.previousState = ChatState.CLAIMS_CHECK;
      session.state = ChatState.SUBSCRIPTION_VIEW;
      await this.sessionService.set(phone, session);
      // WhatsAppService will dispatch to SubscriptionFlow on next message
    } else if (
      msg === 'claims_status' ||
      msg.includes('claim status') ||
      msg.includes('hali ya dai') ||
      msg.includes('check claim')
    ) {
      // Transition to claims status
      session.previousState = ChatState.CLAIMS_CHECK;
      session.state = ChatState.CLAIMS_STATUS;
      await this.sessionService.set(phone, session);
      await this.showClaimsStatus(session, phone, t);
    } else if (
      msg === 'claims_back' ||
      msg === 'back' ||
      msg === 'rudi' ||
      msg === 'menu' ||
      msg === 'menyu' ||
      msg === '0' ||
      msg === t.navigation.menuButton.toLowerCase()
    ) {
      session.state = ChatState.MAIN_MENU;
      session.previousState = ChatState.CLAIMS_CHECK;
      await this.sessionService.set(phone, session);
    } else {
      // Unrecognised — re-run the check
      await this.showClaimsCheck(session, phone, t);
    }
  }

  // ─── CLAIMS_STATUS ──────────────────────────────────────────────────────────

  /**
   * Retrieve and display the member's most recent claims.
   * Requirements 7.5, 7.6: show status, amount, date, and remaining annual cap.
   */
  private async showClaimsStatus(
    session: ChatSession,
    phone: string,
    t: Messages,
  ): Promise<void> {
    if (!session.memberId) {
      await this.metaApi.sendText(phone, t.genericError);
      return;
    }

    try {
      // Retrieve most recent claims (page 1, limit 5)
      const claimHistory = await this.membersService.getClaimHistory(
        session.memberId,
        1,
        5,
      );

      const claims = claimHistory.data;

      let statusMessage = t.claims.statusHeader;

      if (!claims || claims.length === 0) {
        statusMessage += t.claims.noClaims;
      } else {
        const claimLines = claims.map((claim) => {
          const date = new Date(claim.createdAt).toLocaleDateString('en-KE', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
          });
          const status = this.formatClaimStatus(claim.status);
          const amount = claim.amount ?? 0;
          const description = (claim as any).procedureCode
            ? String((claim as any).procedureCode)
            : undefined;

          return t.claims.claimEntry(date, status, amount, description);
        });

        statusMessage += claimLines.join('\n\n');
      }

      // Requirement 7.6: Display remaining annual cap balance
      try {
        const subscription = await this.subscriptionsService.getSubscription(
          session.memberId,
        );
        if (subscription && subscription.isActive) {
          const capUsed = subscription.annualCapUsed ?? 0;
          const capLimit = subscription.annualCapLimit ?? 0;
          statusMessage += t.claims.capBalance(capUsed, capLimit);
        }
      } catch {
        // Non-critical — proceed without cap info
      }

      await this.metaApi.sendButtons(phone, statusMessage, [
        { id: 'claims_check_again', title: '🔄 Check Eligibility' },
        { id: 'claims_back', title: t.navigation.menuButton },
      ]);

      await this.sessionService.set(phone, session);
    } catch (err) {
      this.logger.error(
        `[ClaimsFlow] Error in showClaimsStatus for ${this.hashPhone(phone)}: ${err instanceof Error ? err.message : String(err)}`,
      );
      await this.metaApi.sendText(phone, t.genericError);
    }
  }

  /**
   * Handle button replies in the CLAIMS_STATUS state.
   */
  private async handleClaimsStatus(
    session: ChatSession,
    message: string,
    phone: string,
    t: Messages,
  ): Promise<void> {
    const msg = message.toLowerCase().trim();

    if (
      msg === 'claims_check_again' ||
      msg.includes('check eligibility') ||
      msg.includes('angalia ustahili')
    ) {
      session.previousState = ChatState.CLAIMS_STATUS;
      await this.showClaimsCheck(session, phone, t);
    } else if (
      msg === 'claims_back' ||
      msg === 'back' ||
      msg === 'rudi' ||
      msg === 'menu' ||
      msg === 'menyu' ||
      msg === '0' ||
      msg === t.navigation.menuButton.toLowerCase()
    ) {
      session.state = ChatState.MAIN_MENU;
      session.previousState = ChatState.CLAIMS_STATUS;
      await this.sessionService.set(phone, session);
    } else {
      // Re-show the status
      await this.showClaimsStatus(session, phone, t);
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  /**
   * Format a Prisma claim status enum value into a human-readable string.
   */
  private formatClaimStatus(status: string): string {
    const statusMap: Record<string, string> = {
      PENDING: '⏳ Pending',
      APPROVED: '✅ Approved',
      REJECTED: '❌ Rejected',
      DISBURSED: '💰 Disbursed',
      UNDER_REVIEW: '🔍 Under Review',
    };
    return statusMap[status] ?? status;
  }

  /** One-way hash of phone number for privacy-safe logging (last 4 digits). */
  private hashPhone(phone: string): string {
    return `***${phone.slice(-4)}`;
  }
}
