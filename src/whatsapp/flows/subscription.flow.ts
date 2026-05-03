import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SubscriptionsService } from '../../subscriptions/subscriptions.service';
import { PaymentService } from '../../payments/payment.service';
import { MetaApiService } from '../meta-api.service';
import { SessionService } from '../session.service';
import { ChatSession, ChatState } from '../session.service';
import * as en from '../i18n/en';
import * as sw from '../i18n/sw';

// Union type for the i18n catalogue — both catalogues share the same shape
type Messages = typeof en;

// ─── Tier pricing constants (WhatsApp-facing display prices) ─────────────────

const TIER_PRICES: Record<string, { monthly: number; annual: number }> = {
  BRONZE: { monthly: 300, annual: 3000 },
  SILVER: { monthly: 550, annual: 5500 },
  GOLD: { monthly: 900, annual: 9000 },
};

const TIER_DISPLAY_NAMES: Record<string, string> = {
  BRONZE: 'MenoBronze',
  SILVER: 'MenoSilver',
  GOLD: 'MenoGold',
};

const TIER_BENEFITS: Record<string, string[]> = {
  BRONZE: [
    'Basic dental coverage',
    'Annual cap: KES 6,000',
    '1 consultation/year',
    '1 extraction/year',
    '1 scaling & polishing/year',
  ],
  SILVER: [
    'Standard dental coverage',
    'Annual cap: KES 10,000',
    '1 consultation/year',
    '1 extraction/year',
    '1 scaling & polishing/year',
    '1 composite filling/year',
  ],
  GOLD: [
    'Premium dental coverage',
    'Annual cap: KES 15,000',
    '2 consultations/year',
    '2 extractions/year',
    '2 scaling & polishing/year',
    '2 composite fillings/year',
    '1 root canal/year',
  ],
};

// Max polling attempts (12 × 15s = 3 minutes)
const MAX_POLL_COUNT = 12;
const POLL_INTERVAL_MS = 15_000;

// ─── SubscriptionFlow ─────────────────────────────────────────────────────────

@Injectable()
export class SubscriptionFlow {
  private readonly logger = new Logger(SubscriptionFlow.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly paymentService: PaymentService,
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
      case ChatState.SUBSCRIPTION_VIEW:
        return this.handleSubscriptionView(session, message, phone, t);

      case ChatState.SUBSCRIPTION_SELECT_TIER:
        return this.handleSelectTier(session, message, phone, t);

      case ChatState.SUBSCRIPTION_SELECT_FREQUENCY:
        return this.handleSelectFrequency(session, message, phone, t);

      case ChatState.SUBSCRIPTION_AWAITING_PAYMENT:
        return this.handleAwaitingPayment(session, message, phone, t);

      default:
        // Entry point: show subscription view
        return this.showSubscriptionView(session, phone, t);
    }
  }

  // ─── SUBSCRIPTION_VIEW ──────────────────────────────────────────────────────

  private async showSubscriptionView(
    session: ChatSession,
    phone: string,
    t: Messages,
  ): Promise<void> {
    session.state = ChatState.SUBSCRIPTION_VIEW;
    session.previousState = ChatState.MAIN_MENU;

    if (!session.memberId) {
      await this.metaApi.sendText(phone, t.genericError);
      return;
    }

    try {
      const subscription = await this.subscriptionsService.getSubscription(
        session.memberId,
      );

      if (subscription && subscription.isActive) {
        // Active subscription — show status
        const tierName =
          TIER_DISPLAY_NAMES[subscription.tier] || subscription.tier;
        const status = 'Active';
        const capUsed = subscription.annualCapUsed ?? 0;
        const capLimit = subscription.annualCapLimit ?? 0;

        // Determine waiting period status
        let waitingPeriodActive = false;
        let eligibleDate: string | undefined;
        try {
          const wpStatus =
            await this.subscriptionsService.getWaitingPeriodStatus(
              session.memberId,
            );
          waitingPeriodActive = !wpStatus.consultationsExtractions.available;
          if (
            waitingPeriodActive &&
            wpStatus.consultationsExtractions.eligibleDate
          ) {
            eligibleDate = new Date(
              wpStatus.consultationsExtractions.eligibleDate,
            ).toLocaleDateString('en-KE', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            });
          }
        } catch {
          // Non-critical — proceed without waiting period info
        }

        const viewText = t.subscription.viewActive(
          tierName,
          status,
          capUsed,
          capLimit,
          waitingPeriodActive,
          eligibleDate,
        );

        // Offer upgrade button
        await this.metaApi.sendButtons(phone, viewText, [
          { id: 'sub_upgrade', title: '⬆️ Upgrade Plan' },
          { id: 'sub_back', title: t.navigation.menuButton },
        ]);
      } else {
        // No active subscription — show packages
        await this.metaApi.sendText(phone, t.subscription.viewInactive);
        await this.showTierSelection(session, phone, t);
        return; // showTierSelection already sets state
      }

      await this.sessionService.set(phone, session);
    } catch (err) {
      this.logger.error(
        `[SubscriptionFlow] Error in showSubscriptionView for ${this.hashPhone(phone)}: ${err instanceof Error ? err.message : String(err)}`,
      );
      await this.metaApi.sendText(phone, t.genericError);
    }
  }

  private async handleSubscriptionView(
    session: ChatSession,
    message: string,
    phone: string,
    t: Messages,
  ): Promise<void> {
    const msg = message.toLowerCase().trim();

    if (
      msg === 'sub_upgrade' ||
      msg === 'upgrade' ||
      msg === 'subscribe' ||
      msg === '⬆️ upgrade plan'
    ) {
      session.previousState = ChatState.SUBSCRIPTION_VIEW;
      await this.showTierSelection(session, phone, t);
    } else if (
      msg === 'sub_back' ||
      msg === t.navigation.menuButton.toLowerCase()
    ) {
      session.state = ChatState.MAIN_MENU;
      session.previousState = ChatState.SUBSCRIPTION_VIEW;
      await this.sessionService.set(phone, session);
      // WhatsAppService will handle MAIN_MENU display on next dispatch
    } else {
      // Re-show the subscription view
      await this.showSubscriptionView(session, phone, t);
    }
  }

  // ─── SUBSCRIPTION_SELECT_TIER ───────────────────────────────────────────────

  private async showTierSelection(
    session: ChatSession,
    phone: string,
    t: Messages,
  ): Promise<void> {
    session.state = ChatState.SUBSCRIPTION_SELECT_TIER;
    session.previousState = ChatState.SUBSCRIPTION_VIEW;

    const sections = [
      {
        title: 'Choose Your Plan',
        rows: [
          {
            id: 'tier_BRONZE',
            title: 'MenoBronze',
            description: `KES ${TIER_PRICES.BRONZE.monthly}/mo | KES ${TIER_PRICES.BRONZE.annual}/yr — Basic coverage`,
          },
          {
            id: 'tier_SILVER',
            title: 'MenoSilver',
            description: `KES ${TIER_PRICES.SILVER.monthly}/mo | KES ${TIER_PRICES.SILVER.annual}/yr — Standard coverage`,
          },
          {
            id: 'tier_GOLD',
            title: 'MenoGold',
            description: `KES ${TIER_PRICES.GOLD.monthly}/mo | KES ${TIER_PRICES.GOLD.annual}/yr — Premium coverage`,
          },
        ],
      },
    ];

    await this.metaApi.sendList(
      phone,
      t.subscription.selectTierPrompt,
      sections,
      'View Plans',
      'MenoAI — Choose a Plan',
    );

    await this.sessionService.set(phone, session);
  }

  private async handleSelectTier(
    session: ChatSession,
    message: string,
    phone: string,
    t: Messages,
  ): Promise<void> {
    const msg = message.toLowerCase().trim();

    // Accept tier_BRONZE / tier_SILVER / tier_GOLD (list reply IDs)
    // or plain text like "bronze", "silver", "gold", "menobronze", etc.
    let selectedTier: string | null = null;

    if (msg.includes('bronze') || msg === 'tier_bronze') {
      selectedTier = 'BRONZE';
    } else if (msg.includes('silver') || msg === 'tier_silver') {
      selectedTier = 'SILVER';
    } else if (msg.includes('gold') || msg === 'tier_gold') {
      selectedTier = 'GOLD';
    }

    if (!selectedTier) {
      // Unrecognised — re-show tier selection
      await this.showTierSelection(session, phone, t);
      return;
    }

    // Store selected tier in session (reuse pendingPayment.tier as staging)
    // We'll use a temporary key in session — store in pendingPayment with amount=0 as staging
    session.pendingPayment = {
      contributionId: '',
      amount: 0,
      tier: selectedTier,
      isUpgrade: false,
      pollCount: 0,
    };

    await this.showFrequencySelection(session, phone, t, selectedTier);
  }

  // ─── SUBSCRIPTION_SELECT_FREQUENCY ─────────────────────────────────────────

  private async showFrequencySelection(
    session: ChatSession,
    phone: string,
    t: Messages,
    tier: string,
  ): Promise<void> {
    session.state = ChatState.SUBSCRIPTION_SELECT_FREQUENCY;
    session.previousState = ChatState.SUBSCRIPTION_SELECT_TIER;

    const tierName = TIER_DISPLAY_NAMES[tier] || tier;
    const prices = TIER_PRICES[tier];

    await this.metaApi.sendButtons(
      phone,
      t.subscription.selectFrequencyPrompt(tierName),
      [
        {
          id: `freq_monthly_${tier}`,
          title: t.subscription.frequencyMonthly(prices.monthly).slice(0, 20),
        },
        {
          id: `freq_annual_${tier}`,
          title: t.subscription.frequencyAnnual(prices.annual).slice(0, 20),
        },
      ],
      tierName,
    );

    await this.sessionService.set(phone, session);
  }

  private async handleSelectFrequency(
    session: ChatSession,
    message: string,
    phone: string,
    t: Messages,
  ): Promise<void> {
    const msg = message.toLowerCase().trim();

    // Determine tier from staged pendingPayment
    const stagedTier = session.pendingPayment?.tier;
    if (!stagedTier) {
      // Lost state — restart tier selection
      await this.showTierSelection(session, phone, t);
      return;
    }

    let frequency: 'MONTHLY' | 'ANNUAL' | null = null;

    if (
      msg.startsWith('freq_monthly') ||
      msg.includes('monthly') ||
      msg.includes('month') ||
      msg.includes('kila mwezi')
    ) {
      frequency = 'MONTHLY';
    } else if (
      msg.startsWith('freq_annual') ||
      msg.includes('annual') ||
      msg.includes('year') ||
      msg.includes('kila mwaka')
    ) {
      frequency = 'ANNUAL';
    }

    if (!frequency) {
      // Re-show frequency selection
      await this.showFrequencySelection(session, phone, t, stagedTier);
      return;
    }

    // Initiate payment
    await this.initiatePayment(session, phone, t, stagedTier, frequency);
  }

  // ─── Payment initiation ─────────────────────────────────────────────────────

  private async initiatePayment(
    session: ChatSession,
    phone: string,
    t: Messages,
    tier: string,
    frequency: 'MONTHLY' | 'ANNUAL',
  ): Promise<void> {
    if (!session.memberId) {
      await this.metaApi.sendText(phone, t.genericError);
      return;
    }

    const prices = TIER_PRICES[tier];
    const amount = frequency === 'MONTHLY' ? prices.monthly : prices.annual;
    const tierName = TIER_DISPLAY_NAMES[tier] || tier;
    const freqLabel =
      frequency === 'MONTHLY'
        ? t.subscription.frequencyMonthly(prices.monthly)
        : t.subscription.frequencyAnnual(prices.annual);

    // Determine if this is an upgrade
    let isUpgrade = false;
    try {
      const existing = await this.subscriptionsService.getSubscription(
        session.memberId,
      );
      isUpgrade = !!(existing && existing.isActive);
    } catch {
      // Treat as new subscription
    }

    try {
      // Create pending Contribution record via PrismaService directly
      // (ContributionsService.initiatePayment() does too much — it calls STK push internally)
      const contribution = await this.prisma.contribution.create({
        data: {
          memberId: session.memberId,
          amount,
          month: new Date(),
          paymentMethod: 'MPESA',
          status: 'PENDING',
          metadata: isUpgrade
            ? { isUpgrade: true, newTier: tier, frequency }
            : { frequency },
        },
      });

      // Initiate STK push
      const paymentResult = await this.paymentService.initiateSTKPush(
        session.memberId,
        phone,
        amount,
        contribution.id,
        isUpgrade
          ? `MenoDAO Upgrade to ${tierName}`
          : `MenoDAO ${tierName} Subscription`,
      );

      if (!paymentResult.success) {
        // Clean up the pending contribution
        await this.prisma.contribution.update({
          where: { id: contribution.id },
          data: { status: 'FAILED' },
        });
        await this.metaApi.sendText(phone, t.subscription.paymentFailed);
        session.state = ChatState.SUBSCRIPTION_SELECT_TIER;
        session.pendingPayment = null;
        await this.sessionService.set(phone, session);
        return;
      }

      // Store pending payment in session
      session.pendingPayment = {
        contributionId: contribution.id,
        amount,
        tier,
        isUpgrade,
        pollCount: 0,
      };
      session.state = ChatState.SUBSCRIPTION_AWAITING_PAYMENT;
      session.previousState = ChatState.SUBSCRIPTION_SELECT_FREQUENCY;

      await this.sessionService.set(phone, session);

      // Inform member
      await this.metaApi.sendText(phone, t.subscription.stkPushSent);

      // Start background polling (do NOT await)
      this.startPaymentPolling(phone, session.memberId, contribution.id, t);
    } catch (err) {
      this.logger.error(
        `[SubscriptionFlow] Payment initiation error for ${this.hashPhone(phone)}: ${err instanceof Error ? err.message : String(err)}`,
      );
      await this.metaApi.sendText(phone, t.genericError);
      session.state = ChatState.SUBSCRIPTION_SELECT_TIER;
      session.pendingPayment = null;
      await this.sessionService.set(phone, session);
    }
  }

  // ─── SUBSCRIPTION_AWAITING_PAYMENT ─────────────────────────────────────────

  private async handleAwaitingPayment(
    session: ChatSession,
    message: string,
    phone: string,
    t: Messages,
  ): Promise<void> {
    // If member re-enters this state and there's a pending payment, restart polling
    if (session.pendingPayment && session.pendingPayment.contributionId) {
      this.logger.log(
        `[SubscriptionFlow] Re-entry to AWAITING_PAYMENT for ${this.hashPhone(phone)}, restarting polling`,
      );
      // Reset poll count so we get a fresh 3-minute window
      session.pendingPayment = {
        ...session.pendingPayment,
        pollCount: 0,
      };
      await this.sessionService.set(phone, session);
      await this.metaApi.sendText(phone, t.subscription.stkPushSent);
      this.startPaymentPolling(
        phone,
        session.memberId!,
        session.pendingPayment.contributionId,
        t,
      );
    } else {
      // No pending payment — go back to tier selection
      session.state = ChatState.SUBSCRIPTION_SELECT_TIER;
      await this.sessionService.set(phone, session);
      await this.showTierSelection(session, phone, t);
    }
  }

  // ─── Payment polling ────────────────────────────────────────────────────────

  /**
   * Poll for payment confirmation every 15 seconds, up to 12 times (3 minutes).
   * Runs entirely in the background — do NOT await this method.
   */
  private startPaymentPolling(
    phone: string,
    memberId: string,
    contributionId: string,
    t: Messages,
  ): void {
    let pollCount = 0;

    const intervalId = setInterval(async () => {
      pollCount++;

      try {
        // Re-load session from Redis to get latest state
        const session = await this.sessionService.get(phone);

        // If session is gone or state changed away from AWAITING_PAYMENT, stop polling
        if (
          !session ||
          session.state !== ChatState.SUBSCRIPTION_AWAITING_PAYMENT ||
          !session.pendingPayment
        ) {
          this.logger.log(
            `[SubscriptionFlow] Polling stopped — session state changed for ${this.hashPhone(phone)}`,
          );
          clearInterval(intervalId);
          return;
        }

        // Update poll count in session
        session.pendingPayment = {
          ...session.pendingPayment,
          pollCount,
        };

        const { status } =
          await this.paymentService.checkPaymentStatus(contributionId);

        this.logger.log(
          `[SubscriptionFlow] Poll ${pollCount}/${MAX_POLL_COUNT} for ${this.hashPhone(phone)}: status=${status}`,
        );

        if (status === 'COMPLETED') {
          clearInterval(intervalId);

          // Determine eligible date (waiting period)
          let eligibleDate = 'soon';
          try {
            const wpStatus =
              await this.subscriptionsService.getWaitingPeriodStatus(memberId);
            const eligibleIso = wpStatus.consultationsExtractions.eligibleDate;
            if (eligibleIso) {
              eligibleDate = new Date(eligibleIso).toLocaleDateString('en-KE', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              });
            }
          } catch {
            // Non-critical
          }

          const tierName =
            TIER_DISPLAY_NAMES[session.pendingPayment.tier] ||
            session.pendingPayment.tier;

          await this.metaApi.sendText(
            phone,
            t.subscription.paymentSuccess(tierName, eligibleDate),
          );

          session.pendingPayment = null;
          session.state = ChatState.MAIN_MENU;
          session.previousState = ChatState.SUBSCRIPTION_AWAITING_PAYMENT;
          await this.sessionService.set(phone, session);
          return;
        }

        if (status === 'FAILED') {
          clearInterval(intervalId);

          await this.metaApi.sendText(phone, t.subscription.paymentFailed);

          session.pendingPayment = null;
          session.state = ChatState.SUBSCRIPTION_SELECT_TIER;
          session.previousState = ChatState.SUBSCRIPTION_AWAITING_PAYMENT;
          await this.sessionService.set(phone, session);
          return;
        }

        // Still PENDING — check if we've hit the max
        if (pollCount >= MAX_POLL_COUNT) {
          clearInterval(intervalId);

          await this.metaApi.sendText(phone, t.subscription.paymentTimeout);

          session.pendingPayment = null;
          session.state = ChatState.SUBSCRIPTION_SELECT_TIER;
          session.previousState = ChatState.SUBSCRIPTION_AWAITING_PAYMENT;
          await this.sessionService.set(phone, session);
          return;
        }

        // Still polling — persist updated poll count
        await this.sessionService.set(phone, session);
      } catch (err) {
        this.logger.error(
          `[SubscriptionFlow] Polling error (attempt ${pollCount}) for ${this.hashPhone(phone)}: ${err instanceof Error ? err.message : String(err)}`,
        );

        // On error, stop polling after max attempts
        if (pollCount >= MAX_POLL_COUNT) {
          clearInterval(intervalId);
          try {
            const session = await this.sessionService.get(phone);
            if (session) {
              await this.metaApi.sendText(phone, t.subscription.paymentTimeout);
              session.pendingPayment = null;
              session.state = ChatState.SUBSCRIPTION_SELECT_TIER;
              await this.sessionService.set(phone, session);
            }
          } catch {
            // Best-effort cleanup
          }
        }
      }
    }, POLL_INTERVAL_MS);
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  /** One-way hash of phone number for privacy-safe logging (last 4 digits). */
  private hashPhone(phone: string): string {
    return `***${phone.slice(-4)}`;
  }
}
