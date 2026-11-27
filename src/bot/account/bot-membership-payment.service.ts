import { randomBytes } from 'node:crypto';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PackageTier, PaymentFrequency } from '@prisma/client';
import { ContributionsService } from '../../contributions/contributions.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SubscriptionsService } from '../../subscriptions/subscriptions.service';

const QUOTE_WINDOW_MS = 15 * 60_000;

export function matchMembershipConfirmation(message: string) {
  return /^(?:please )?confirm (?:m[ ‐‑–-]?pesa(?: (?:payment|quote))?|(?:my |the )?(?:membership )?(?:payment|quote))(?:\s+([a-f0-9]{6}))?[.!]?$/i.exec(message.trim());
}

export function paymentQuoteReference(reply: string | null) {
  if (!reply) return null;
  const current = /^Quote reference: ([a-f0-9]{6}|current)$/im.exec(reply);
  const legacy = /^Reply “confirm M-Pesa(?: ([a-f0-9]{6}))?” while your SMS verification is valid/im.exec(reply);
  return current || legacy ? { code: current?.[1] === 'current' ? undefined : current?.[1] ?? legacy?.[1] } : null;
}

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

  isPlanFollowUp(message: string): boolean {
    return /^(?:yes(?:[, ]+please)?|yeah|yep|sure|ok(?:ay)?|go ahead|ndiyo|sawa|monthly|yearly|annual)[.!]?$/i.test(
      message.trim(),
    );
  }

  planFollowUpScope(
    message: string,
    previousReply: string | null,
  ): MembershipPaymentScope | null {
    if (!previousReply || !this.isPlanFollowUp(message)) return null;
    const choice = message.trim().toLowerCase().replace(/[.!]$/, '');
    if (/^(?:monthly|yearly|annual)$/.test(choice)) {
      const tiers = new Set(
        [...previousReply.matchAll(/\b(?:meno)?(bronze|silver|gold)\b/gi)].map(
          (match) => match[1].toUpperCase(),
        ),
      );
      if (
        tiers.size === 1 &&
        /\bmonthly\b/i.test(previousReply) &&
        /\b(?:yearly|annual)\b/i.test(previousReply) &&
        /\b(?:choose|reply|which)\b/i.test(previousReply)
      ) {
        const tier = [...tiers][0] as PackageTier;
        return `MEMBERSHIP_JOIN:${tier}:${choice === 'monthly' ? 'MONTHLY' : 'ANNUAL'}`;
      }
      return null;
    }

    const offer = previousReply
      .trim()
      .split(/(?<=[.!?])\s+/)
      .at(-1);
    if (
      !offer ||
      !/\b(?:would you like|shall we|do you want|ready to)\b/i.test(offer) ||
      !/\b(?:start|set up|join|activate|sign up|subscribe|get)\b/i.test(
        offer,
      ) ||
      !/\b(?:membership|plan|package|cover)\b/i.test(offer) ||
      /\b(?:book(?:ing)?|appointment|consultation|clinic)\b/i.test(offer)
    ) {
      return null;
    }
    const plan =
      /\b(?:meno)?(bronze|silver|gold)\s+(monthly|annual|yearly)\b/i.exec(
        offer,
      );
    if (!plan) return null;
    const tier = plan[1].toUpperCase() as PackageTier;
    return `MEMBERSHIP_JOIN:${tier}:${plan[2].toLowerCase() === 'monthly' ? 'MONTHLY' : 'ANNUAL'}`;
  }

  detectRequest(message: string): MembershipPaymentScope | null {
    const text = message
      .trim()
      .toLowerCase()
      .replace(/[.!?]+$/, '');
    if (/^(?:how|where)\b.*\b(?:pay|renew)\b/.test(text)) return null;
    const tier = this.requestedTier(text);
    const cadence = /\b(monthly|annual|yearly|per month|per year)\b/.exec(
      text,
    )?.[1];
    if (tier && cadence) {
      const frequency =
        cadence === 'monthly' || cadence === 'per month' ? 'MONTHLY' : 'ANNUAL';
      return `MEMBERSHIP_JOIN:${tier}:${frequency}`;
    }

    if (
      /\b(?:pay|renew|start|set up|activate|sign up for|lipia|lipa)\b.{0,35}\b(?:membership|subscription|plan|cover|uanachama)\b/.test(
        text,
      )
    )
      return 'MEMBERSHIP_PAY';

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

    return null;
  }

  private requestedTier(message: string): PackageTier | undefined {
    const tier = /\b(?:meno)?(bronze|silver|gold)\b/i.exec(message)?.[1];
    const selecting =
      /^(?:meno)?(?:bronze|silver|gold)(?: (?:monthly|annual|yearly))?$/i.test(
        message.trim(),
      ) ||
      /\b(?:pay|buy|choose|join|take|want|like|get|select|start|set up|activate|subscribe|jiunge|lipa|lipia)\b/i.test(
        message,
      );
    return selecting
      ? (tier?.toUpperCase() as PackageTier | undefined)
      : undefined;
  }

  planChoiceReply(message: string): string | null {
    const tier = this.requestedTier(
      message.toLowerCase().replace(/[.!?]+$/, ''),
    );
    if (!tier || this.detectRequest(message)?.startsWith('MEMBERSHIP_JOIN:'))
      return null;
    const plan = this.subscriptions
      .getPackages()
      .find((item) => item.tier === tier);
    if (!plan) return null;
    const label = tier[0] + tier.slice(1).toLowerCase();
    return [
      `You can set up *${plan.displayName}* here in WhatsApp.`,
      `Monthly: KES ${plan.actualMonthlyCharge.toLocaleString('en-KE')}\nYearly: KES ${plan.actualAnnualCharge.toLocaleString('en-KE')}`,
      `Reply “${label} monthly” or “${label} yearly” to choose.`,
    ].join('\n\n');
  }

  payerNumberFromMessage(message: string): string | null {
    const candidate =
      /(?:^pay from\s+|\b(?:send|prompt|use|number is)\b[^\d+]*)(\+?[\d ()-]+)(?:\s+(?:please|with (?:their|the payer’s|the payer's) consent))?[.!?]?$/i.exec(
        message,
      )?.[1] ?? (/^\+?[\d ()-]+$/.test(message) ? message : null);
    return candidate && this.normalizePayerPhone(candidate) ? candidate : null;
  }

  async acceptPayerReply(
    memberId: string,
    message: string,
    restart?: (scope: MembershipPaymentScope) => Promise<string>,
  ): Promise<string | null> {
    const candidate = this.payerNumberFromMessage(message);
    if (!candidate) return null;
    if (await this.findOpenQuote(memberId, new Date())) {
      return this.changePayer(memberId, candidate);
    }
    const scope = restart && (await this.recentPaymentRequest(memberId));
    if (!scope || !restart) return null;
    const resumed = await restart(scope);
    if (await this.findOpenQuote(memberId, new Date())) {
      return this.changePayer(memberId, candidate);
    }
    return /6-digit|verification code/i.test(resumed)
      ? `${resumed}\n\nAfter verification, send the payer number again so I can show the correct quote.`
      : resumed;
  }

  async recentPaymentRequest(
    memberId: string,
  ): Promise<MembershipPaymentScope | null> {
    const session = await this.prisma.botDataAccessSession.findFirst({
      where: {
        memberId,
        status: { in: ['PAYMENT_QUOTED', 'PENDING', 'VERIFIED'] },
        scope: { startsWith: 'MEMBERSHIP_' },
        createdAt: { gt: new Date(Date.now() - 60 * 60_000) },
      },
      orderBy: { createdAt: 'desc' },
      select: { scope: true },
    });
    const request = session?.scope.split('|')[0];
    return request &&
      request !== 'MEMBERSHIP_STATUS' &&
      isMembershipPaymentScope(request)
      ? request
      : null;
  }

  async paymentPromptReply(memberId: string): Promise<string | null> {
    const quote = await this.findOpenQuote(memberId, new Date());
    if (!quote) return null;
    const [, tier, frequency, amount, subscriptionId, payer, code] =
      quote.scope.split('|');
    if (!subscriptionId) return null;
    return (
      'The quote is still open. The prompt is sent after you confirm.\n\n' +
      this.quoteReply(tier, frequency, Number(amount), payer ?? '', code)
    );
  }

  describePlans(): string {
    const plans = this.subscriptions
      .getPackages()
      .map(
        (plan) =>
          `*${plan.displayName}*\nKES ${plan.actualMonthlyCharge.toLocaleString('en-KE')} monthly · KES ${plan.actualAnnualCharge.toLocaleString('en-KE')} yearly`,
      );
    return [
      '*Membership options*',
      ...plans,
      'To choose a plan, reply with the tier and billing period, for example “Bronze monthly”.',
      'You can still book a visit without cover.',
    ].join('\n\n');
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
    if (!payer) return `${description}\n\n${changeNumber}`;
    return [
      `${description}\nM-Pesa number ending in ${payer.slice(-4)}`,
      'Reply *pay*, *proceed*, or *confirm* to send the M-Pesa prompt. Enter the PIN only on the payer’s phone.',
      code ? `Quote reference: ${code}` : 'Quote reference: current',
      changeNumber,
    ].join('\n\n');
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
        return 'You don’t have a MenoDAO plan yet.\n\nType “membership options” to see the plans. You can still book a visit without cover.';
      const interval =
        subscription.paymentFrequency === 'ANNUAL' ? 'annual' : 'monthly';
      const plan = this.subscriptions
        .getPackages()
        .find((item) => item.tier === subscription.tier);
      const active =
        subscription.isActive &&
        (!subscription.endDate || subscription.endDate > new Date());
      return `${plan?.displayName ?? subscription.tier} is ${active ? 'active' : 'inactive'} with ${interval} billing.\n\nTo get a payment quote, type “pay membership”.`;
    }
    const [, requestedTier, requestedFrequency] = request.split(':') as [
      string,
      PackageTier | undefined,
      PaymentFrequency | undefined,
    ];
    if (
      requestedTier &&
      subscription?.isActive &&
      (requestedTier !== subscription.tier ||
        requestedFrequency !== subscription.paymentFrequency)
    ) {
      return 'You already have active cover. To check your current plan, ask “my plan”. To check whether a payment is due, say “pay membership”.';
    }
    const paymentRequest = subscription?.isActive ? 'MEMBERSHIP_PAY' : request;
    const tier = requestedTier ?? subscription?.tier;
    const frequency = requestedFrequency ?? subscription?.paymentFrequency;
    if ((!subscription?.isActive && !requestedTier) || !tier || !frequency) {
      return `You don’t have an active membership. You can choose a tier and make your first payment right here.\n\n${this.describePlans()}`;
    }

    try {
      await this.subscriptions.checkPaymentFrequencyRestriction(
        memberId,
        frequency,
      );
    } catch (error) {
      if (error instanceof BadRequestException) {
        if (
          subscription?.isActive &&
          /already made (?:a payment this month|an annual payment)/i.test(
            error.message,
          )
        ) {
          return 'Your membership payments are up to date.';
        }
        return error.message;
      }
      throw error;
    }
    const amount = this.price(tier, frequency);
    if (!amount)
      return 'The price is unavailable right now. Try again shortly.';
    const scope = [
      paymentRequest,
      tier,
      frequency,
      amount,
      subscription?.id ?? 'new',
    ].join('|');
    const payer = this.normalizePayerPhone(registeredPhone) ?? '';
    const id = `membership-quote:${verifiedSessionId}`;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + QUOTE_WINDOW_MS);
    let quote = await this.prisma.botDataAccessSession.upsert({
      where: { id },
      update: {},
      create: {
        id,
        memberId,
        scope: [scope, payer, randomBytes(3).toString('hex').toUpperCase()].join('|'),
        status: 'PAYMENT_QUOTED',
        expiresAt,
      },
    });
    if (quote.status === 'PAYMENT_QUOTED' && quote.expiresAt <= now) {
      const refreshedScope = [
        scope,
        payer,
        randomBytes(3).toString('hex').toUpperCase(),
      ].join('|');
      const refreshed = await this.prisma.botDataAccessSession.updateMany({
        where: {
          id,
          memberId,
          status: 'PAYMENT_QUOTED',
          expiresAt: { lte: now },
        },
        data: { scope: refreshedScope, expiresAt },
      });
      if (refreshed.count !== 1)
        return 'The quote changed while I was refreshing it. Please check the latest payment message.';
      quote = { ...quote, scope: refreshedScope, expiresAt };
    }
    if (quote.status !== 'PAYMENT_QUOTED') {
      return 'This quote has already been used. Check your phone for the M-Pesa prompt or ask for your payment status.';
    }
    const stored = quote.scope.split('|');
    if (stored.slice(0, 5).join('|') !== scope) {
      return 'There’s already a payment quote open in this verification window. Review the existing quote before confirming.';
    }
    return this.quoteReply(tier, frequency, amount, stored[5] ?? '', stored[6]);
  }

  async confirm(
    memberId: string,
    confirmationCode?: string,
    restart?: (scope: MembershipPaymentScope) => Promise<string>,
  ): Promise<string> {
    const now = new Date();
    const quote = await this.findOpenQuote(memberId, now);
    if (!quote) {
      const scope = restart ? await this.recentPaymentRequest(memberId) : null;
      if (scope && restart) return restart(scope);
      return 'There’s no open payment quote. Type “pay membership” to get started.';
    }

    const verification = await this.prisma.botDataAccessSession.findUnique({
      where: {
        id: quote.id.slice('membership-quote:'.length),
        memberId,
        status: 'VERIFIED',
        verifiedUntil: { gt: now },
      },
      select: { id: true },
    });
    if (!verification) {
      const scope = quote.scope.split('|')[0];
      if (restart && isMembershipPaymentScope(scope) && scope !== 'MEMBERSHIP_STATUS') {
        return restart(scope);
      }
      return 'Your SMS verification has expired. Please verify again before confirming a payment.';
    }

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
      return this.quoteReply(tier, frequency, Number(amountText), payer, code);
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
        'WHATSAPP',
      );
      return `M-Pesa prompt sent to the number ending in ${payer.slice(-4)}. Approve it on that phone if the amount is correct. Payment is pending until M-Pesa confirms it.`;
    } catch {
      this.logger.warn(
        'WhatsApp membership payment could not be confirmed as initiated.',
      );
      return 'M-Pesa has not confirmed sending the prompt. Check your phone or ask for your payment status before trying again.';
    }
  }
}
