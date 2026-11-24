import { randomBytes } from 'node:crypto';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PackageTier, PaymentFrequency } from '@prisma/client';
import { ContributionsService } from '../../contributions/contributions.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SubscriptionsService } from '../../subscriptions/subscriptions.service';

export type MembershipPaymentScope =
  | 'MEMBERSHIP_STATUS'
  | 'MEMBERSHIP_PAY'
  | `MEMBERSHIP_JOIN:${PackageTier}:${PaymentFrequency}`;

export function isMembershipPaymentScope(
  scope: string,
): scope is MembershipPaymentScope {
  return (
    scope === 'MEMBERSHIP_STATUS' ||
    scope === 'MEMBERSHIP_PAY' ||
    /^MEMBERSHIP_JOIN:(BRONZE|SILVER|GOLD):(MONTHLY|ANNUAL)$/.test(scope)
  );
}

@Injectable()
export class BotMembershipPaymentService {
  private readonly logger = new Logger(BotMembershipPaymentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptions: SubscriptionsService,
    private readonly contributions: ContributionsService,
  ) {}

  detectRequest(message: string): MembershipPaymentScope | null {
    const text = message
      .trim()
      .toLowerCase()
      .replace(/[.!?]+$/, '');
    if (/^(?:how|where)\b.*\b(?:pay|renew)\b/.test(text)) return null;
    const join =
      /^(?:join|jiunge) (?:meno)?(bronze|silver|gold) (monthly|annual)$/.exec(
        text,
      );
    if (join)
      return `MEMBERSHIP_JOIN:${join[1].toUpperCase() as PackageTier}:${join[2].toUpperCase() as PaymentFrequency}`;

    if (
      /\bmy (?:current )?(?:plan|membership|cover|subscription)\b|\b(?:mpango|uanachama) wangu\b/.test(
        text,
      ) &&
      !/\b(?:pay|renew|lipia|lipa|payment (?:history|status|records?))\b/.test(
        text,
      )
    ) {
      return 'MEMBERSHIP_STATUS';
    }

    return /\b(?:pay|renew|lipia|lipa)\b.{0,35}\b(?:membership|subscription|plan|cover|uanachama)\b/.test(
      text,
    )
      ? 'MEMBERSHIP_PAY'
      : null;
  }

  describePlans(): string {
    const plans = this.subscriptions
      .getPackages()
      .map(
        (plan) =>
          `${plan.displayName}: KES ${plan.actualMonthlyCharge} monthly or KES ${plan.actualAnnualCharge} yearly`,
      );
    return `${plans.join('; ')}. To choose a plan, type “join bronze monthly”, for example. You can still book a visit without cover.`;
  }

  private price(
    tier: PackageTier,
    frequency: PaymentFrequency,
  ): number | undefined {
    const plan = this.subscriptions
      .getPackages()
      .find((item) => item.tier === tier);
    return frequency === 'ANNUAL'
      ? plan?.actualAnnualCharge
      : plan?.actualMonthlyCharge;
  }

  private normalizePayerPhone(raw: string): string | null {
    const number = raw.trim().replace(/[ ()-]/g, '');
    const match = /^(?:\+?254|0)([17]\d{8})$/.exec(number);
    return match ? `254${match[1]}` : null;
  }

  private quoteReply(
    tier: string,
    frequency: string,
    amount: number,
    payer: string,
    code?: string,
  ): string {
    const interval = frequency === 'ANNUAL' ? 'annual' : 'monthly';
    const description = `Meno${tier[0]}${tier.slice(1).toLowerCase()} (${interval}) costs KES ${amount.toLocaleString('en-KE')}.`;
    const changeNumber =
      'To use another number with the payer’s consent, type “pay from” followed by their mobile number.';
    if (!payer) return `${description} ${changeNumber}`;
    const confirmation = code ? `confirm M-Pesa ${code}` : 'confirm M-Pesa';
    return `${description} The prompt will go to the M-Pesa number ending in ${payer.slice(-4)}. Reply “${confirmation}” before the quote expires. ${changeNumber} The payer enters their PIN only on their phone.`;
  }

  private findOpenQuote(memberId: string, now: Date) {
    return this.prisma.botDataAccessSession.findFirst({
      where: { memberId, status: 'PAYMENT_QUOTED', expiresAt: { gt: now } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async changePayer(memberId: string, rawPhone: string): Promise<string> {
    const payer = this.normalizePayerPhone(rawPhone);
    if (!payer)
      return 'Please type “pay from” followed by a valid Kenyan mobile number, such as 0712345678 or +254712345678.';
    const now = new Date();
    const quote = await this.findOpenQuote(memberId, now);
    if (!quote)
      return 'Type “pay membership” and finish verification to open a payment quote first.';

    const [request, tier, frequency, amount, subscriptionId] =
      quote.scope.split('|');
    const code = randomBytes(3).toString('hex').toUpperCase();
    const updated = await this.prisma.botDataAccessSession.updateMany({
      where: {
        id: quote.id,
        memberId,
        scope: quote.scope,
        status: 'PAYMENT_QUOTED',
        expiresAt: { gt: now },
      },
      data: {
        scope: [
          request,
          tier,
          frequency,
          amount,
          subscriptionId,
          payer,
          code,
        ].join('|'),
      },
    });
    if (updated.count !== 1)
      return 'That quote changed or closed. Please check the latest payment message before trying again.';
    return this.quoteReply(tier, frequency, Number(amount), payer, code);
  }

  async offer(
    memberId: string,
    request: MembershipPaymentScope,
    verifiedSessionId: string,
    registeredPhone: string,
  ) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { memberId },
    });
    if (request === 'MEMBERSHIP_STATUS') {
      if (!subscription)
        return 'You don’t have a MenoDAO plan yet. Type “membership options” to see the plans. You can still book a visit without cover.';
      const interval =
        subscription.paymentFrequency === 'ANNUAL' ? 'annual' : 'monthly';
      const plan = this.subscriptions
        .getPackages()
        .find((item) => item.tier === subscription.tier);
      const active =
        subscription.isActive &&
        (!subscription.endDate || subscription.endDate > new Date());
      return `${plan?.displayName ?? subscription.tier} is ${active ? 'active' : 'inactive'} with ${interval} billing. To get a payment quote, type “pay membership”.`;
    }
    const [, requestedTier, requestedFrequency] = request.split(':') as [
      string,
      PackageTier | undefined,
      PaymentFrequency | undefined,
    ];
    if (requestedTier && subscription?.isActive) {
      return 'You already have an active plan. To pay for that plan, type “pay membership”.';
    }
    const tier = requestedTier ?? subscription?.tier;
    const frequency = requestedFrequency ?? subscription?.paymentFrequency;
    if (!tier || !frequency) {
      return `You don’t have a plan on record. ${this.describePlans()}`;
    }

    try {
      await this.subscriptions.checkPaymentFrequencyRestriction(
        memberId,
        frequency,
      );
    } catch (error) {
      if (error instanceof BadRequestException) return error.message;
      throw error;
    }
    const amount = this.price(tier, frequency);
    if (!amount)
      return 'I couldn’t check the price right now. Please try again shortly.';
    const scope = [
      request,
      tier,
      frequency,
      amount,
      subscription?.id ?? 'new',
    ].join('|');
    const payer = this.normalizePayerPhone(registeredPhone) ?? '';
    const id = `membership-quote:${verifiedSessionId}`;
    const quote = await this.prisma.botDataAccessSession.upsert({
      where: { id },
      update: {},
      create: {
        id,
        memberId,
        scope: [scope, payer].join('|'),
        status: 'PAYMENT_QUOTED',
        expiresAt: new Date(Date.now() + 5 * 60_000),
      },
    });
    if (quote.status !== 'PAYMENT_QUOTED' || quote.expiresAt <= new Date()) {
      return 'That payment window has closed. Please wait for any pending M-Pesa prompt or try again once your verification window expires.';
    }
    const stored = quote.scope.split('|');
    if (stored.slice(0, 5).join('|') !== scope) {
      return 'There’s already a payment quote open in this verification window. Review the existing quote before confirming.';
    }
    return this.quoteReply(tier, frequency, amount, stored[5] ?? '', stored[6]);
  }

  async confirm(memberId: string, confirmationCode?: string): Promise<string> {
    const now = new Date();
    const quote = await this.findOpenQuote(memberId, now);
    if (!quote)
      return 'There’s no open payment quote. Type “pay membership” to get started.';

    const [request, tier, frequency, amountText, subscriptionId, payer, code] =
      quote.scope.split('|') as [
        string,
        PackageTier,
        PaymentFrequency,
        string,
        string,
        string?,
        string?,
      ];
    if (!payer || this.normalizePayerPhone(payer) !== payer) {
      return 'Choose a mobile number first. Type “pay from” followed by the M-Pesa number.';
    }
    if (code !== confirmationCode?.toUpperCase()) {
      return 'Please use the exact confirmation phrase in your latest M-Pesa quote.';
    }
    const amount = Number(amountText);
    const join = request.startsWith('MEMBERSHIP_JOIN:');
    const subscription = await this.prisma.subscription.findUnique({
      where: { memberId },
    });
    if (
      !isMembershipPaymentScope(request) ||
      request === 'MEMBERSHIP_STATUS' ||
      (subscription?.id ?? 'new') !== subscriptionId ||
      this.price(tier, frequency) !== amount ||
      (join
        ? subscription?.isActive
        : subscription?.tier !== tier ||
          subscription.paymentFrequency !== frequency)
    ) {
      return 'Your plan or price changed. Please request a fresh payment quote before continuing.';
    }
    const pending = await this.prisma.contribution.findFirst({
      where: {
        memberId,
        status: 'PENDING',
        createdAt: { gt: new Date(now.getTime() - 5 * 60_000) },
      },
      select: { id: true },
    });
    if (pending)
      return 'A recent payment is still pending. Check your M-Pesa prompt or ask for your payment status.';

    const claimed = await this.prisma.botDataAccessSession.updateMany({
      where: {
        id: quote.id,
        memberId,
        scope: quote.scope,
        status: 'PAYMENT_QUOTED',
        expiresAt: { gt: now },
      },
      data: { status: 'PAYMENT_SUBMITTED' },
    });
    if (claimed.count !== 1)
      return 'That payment quote has already been used or expired.';

    try {
      if (join) {
        await this.subscriptions.checkPaymentFrequencyRestriction(
          memberId,
          frequency,
        );
        await this.subscriptions.subscribe(memberId, tier, frequency);
      }
      await this.contributions.initiatePayment(
        memberId,
        amount,
        'MPESA',
        payer,
        false,
        undefined,
        frequency,
        { tier, amount },
      );
      return `I sent the M-Pesa prompt to the number ending in ${payer.slice(-4)}. The payer should approve it on their phone if the amount matches. The payment is pending until M-Pesa confirms it.`;
    } catch {
      this.logger.warn(
        'WhatsApp membership payment could not be confirmed as initiated.',
      );
      return 'I couldn’t confirm that the M-Pesa prompt was sent. Check your phone or ask for your payment status before trying again.';
    }
  }
}
