import { Injectable, Logger } from '@nestjs/common';
import { AppointmentStatus, Prisma } from '@prisma/client';
import { AuthService } from '../../auth/auth.service';
import { PrismaService } from '../../prisma/prisma.service';

export type MemberDataScope =
  | 'ACCOUNT'
  | 'PAYMENTS'
  | 'APPOINTMENTS'
  | 'VISITS'
  | 'CLAIMS';

interface MemberRef {
  id: string;
  phoneNumber: string;
}

const OTP_WINDOW_MS = 10 * 60 * 1000;
const ACCESS_WINDOW_MS = 15 * 60 * 1000;
const MAX_OTP_REQUESTS_PER_HOUR = 5;
const MAX_VERIFY_ATTEMPTS = 5;
const CONSISTENCY_MONTHS = 12;

const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/**
 * OTP-gated access to a member's own records from WhatsApp.
 *
 * Security model:
 *  1. A sensitive request is detected by scope (payments, appointments,
 *     visits, claims, account).
 *  2. If the member already has a short-lived VERIFIED session, answer
 *     immediately. Otherwise send an SMS OTP through the existing auth flow and
 *     store a PENDING session bound to the member and the requested scope.
 *  3. Only the requesting member's own rows are queried. There is no lookup by
 *     name, phone or member id from chat.
 *  4. Every attempt is written to SensitiveDataAccessLog. Repeated OTP requests
 *     and failed verifications are rate limited and locked.
 *
 * Clinical notes, staff names and full identifiers are deliberately never sent
 * over WhatsApp; members get dates, clinics, procedures and amounts only.
 */
@Injectable()
export class BotMemberDataService {
  private readonly logger = new Logger(BotMemberDataService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
  ) {}

  /**
   * Reuse the member-safe reply builders for an already-authorised caller
   * (admin WhatsApp access). The output contains no clinical notes, staff names
   * or full identifiers, exactly as for the member's own request.
   */
  async buildScopedReply(
    memberId: string,
    scope: MemberDataScope,
  ): Promise<string> {
    return this.buildReply(memberId, scope);
  }

  /** Maps a member message to the narrowest data scope it asks for. */
  detectScope(messageText: string): MemberDataScope | null {
    const text = (messageText || '').toLowerCase();
    if (!text) return null;

    const payments = [
      /\bmy (payment|payments) (history|records?|status)\b/,
      /\b(my )?(payment|contribution) history\b/,
      /\bmy (contributions?|receipts?|transactions?) (history|records?)\b/,
      /\b(have|did) i (ever )?(made|make|paid)\b/,
      /\bhow (consistent|regular|reliable) (was|have|am) i\b/,
      /\bhow consistent\b.*\b(payment|contribution|membership)\b/,
      /\bhow much (have|did) i (pay|paid)\b/,
      /\bwhen did i (last )?pay\b/,
      /\bam i (paid up|up to date)\b/,
      /\bmy membership (payments?|contributions?) (history|records?|status)\b/,
      /\bmy payment (status|records?)\b/,
    ];
    if (payments.some((pattern) => pattern.test(text))) return 'PAYMENTS';

    const appointments = [
      /\bmy (appointments?|bookings?)\b/,
      /\b(appointment|booking) history\b/,
      /\b(upcoming|next) (appointment|booking)\b/,
      /\bwhen is my (appointment|booking)\b/,
      /\bdo i have (an|any) appointment\b/,
    ];
    if (appointments.some((pattern) => pattern.test(text))) {
      return 'APPOINTMENTS';
    }

    const visits = [
      /\bmy (visits?|treatments?|procedures?)\b/,
      /\b(visit|treatment) history\b/,
      /\bwhat (treatment|procedure)s? did i (get|have|receive)\b/,
      /\bwhen was my last (visit|treatment)\b/,
    ];
    if (visits.some((pattern) => pattern.test(text))) return 'VISITS';

    const claims = [
      /\bmy claims?\b/,
      /\bclaim (status|history)\b/,
      /\bhave i (made|filed) a claim\b/,
      /\bwhat happened to my claim\b/,
    ];
    if (claims.some((pattern) => pattern.test(text))) return 'CLAIMS';

    const account = [
      /\baccount info\b/,
      /\bmy account\b/,
      /\bmy profile\b/,
      /\bmy subscription\b/,
      /\bmy plan\b/,
      /\bmembership details\b/,
      /\bcheck my (account|subscription|plan|membership|details|info)\b/,
      /\baccount status\b/,
      /\bam i (a )?(member|registered|active)\b/,
    ];
    if (account.some((pattern) => pattern.test(text))) return 'ACCOUNT';

    return null;
  }

  async hasPendingVerification(memberId: string): Promise<boolean> {
    const count = await this.prisma.botDataAccessSession.count({
      where: {
        memberId,
        status: 'PENDING',
        expiresAt: { gt: new Date() },
      },
    });
    return count > 0;
  }

  /**
   * Entry point for a detected sensitive request. Answers from an existing
   * verified window, reuses a live OTP challenge, or sends a fresh one.
   */
  async handleRequest(
    member: MemberRef,
    scope: MemberDataScope,
  ): Promise<string> {
    const verified = await this.prisma.botDataAccessSession.findFirst({
      where: {
        memberId: member.id,
        status: 'VERIFIED',
        verifiedUntil: { gt: new Date() },
      },
      orderBy: { verifiedUntil: 'desc' },
    });
    if (verified) {
      await this.logAccess(member.id, scope, 'GRANTED');
      return this.buildReply(member.id, scope);
    }

    const pending = await this.prisma.botDataAccessSession.findFirst({
      where: {
        memberId: member.id,
        status: 'PENDING',
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (pending) {
      if (pending.scope !== scope) {
        await this.prisma.botDataAccessSession.update({
          where: { id: pending.id },
          data: { scope },
        });
      }
      await this.logAccess(member.id, scope, 'OTP_SENT', {
        reused: true,
      });
      return this.verificationPrompt(scope);
    }

    const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentRequests = await this.prisma.botDataAccessSession.count({
      where: { memberId: member.id, requestedAt: { gte: hourAgo } },
    });
    if (recentRequests >= MAX_OTP_REQUESTS_PER_HOUR) {
      this.logger.error(
        `Member ${member.id} exceeded bot data-access OTP rate limit`,
      );
      await this.logAccess(member.id, scope, 'RATE_LIMITED');
      return (
        'For your security, I cannot send another verification code right now. ' +
        'Please try again in about an hour, or open the app to view your records.'
      );
    }

    const session = await this.prisma.botDataAccessSession.create({
      data: {
        memberId: member.id,
        scope,
        status: 'PENDING',
        expiresAt: new Date(Date.now() + OTP_WINDOW_MS),
      },
    });

    try {
      await this.auth.requestOtp(member.phoneNumber);
    } catch (error) {
      await this.prisma.botDataAccessSession.update({
        where: { id: session.id },
        data: { status: 'EXPIRED' },
      });
      this.logger.warn(
        `Bot data-access OTP send failed for member ${member.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      await this.logAccess(member.id, scope, 'DENIED', {
        reason: 'otp_send_failed',
      });
      return 'I could not send your verification code right now. Please try again shortly.';
    }

    await this.logAccess(member.id, scope, 'OTP_SENT');
    return this.verificationPrompt(scope);
  }

  /**
   * Verifies an SMS code against the member's live pending session. The reply
   * is built for the scope that was requested before verification.
   */
  async verify(
    member: MemberRef,
    code: string,
  ): Promise<{ reply: string; verified: boolean }> {
    const session = await this.prisma.botDataAccessSession.findFirst({
      where: {
        memberId: member.id,
        status: 'PENDING',
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!session) {
      return {
        reply:
          'There is no verification in progress. Ask me for your payments, appointments, visits or claims and I will send a fresh code.',
        verified: false,
      };
    }

    try {
      await this.auth.verifyOtp(member.phoneNumber, code);
    } catch {
      const attempts = session.attempts + 1;
      const locked = attempts >= MAX_VERIFY_ATTEMPTS;
      await this.prisma.botDataAccessSession.update({
        where: { id: session.id },
        data: {
          attempts,
          status: locked ? 'LOCKED' : 'PENDING',
        },
      });
      await this.logAccess(
        member.id,
        session.scope,
        locked ? 'LOCKED' : 'DENIED',
        { attempts },
      );
      if (locked) {
        this.logger.error(
          `Member ${member.id} locked out of bot data access after ${attempts} failed codes`,
        );
        return {
          reply:
            'Too many incorrect codes. For your security this request is locked. Please start again in about an hour or open the app.',
          verified: false,
        };
      }
      return {
        reply:
          'That code did not match or has expired. Please reply with the 6-digit code we sent to your phone, or ask me to send a new one.',
        verified: false,
      };
    }

    await this.prisma.botDataAccessSession.update({
      where: { id: session.id },
      data: {
        status: 'VERIFIED',
        verifiedUntil: new Date(Date.now() + ACCESS_WINDOW_MS),
      },
    });
    await this.logAccess(member.id, session.scope, 'GRANTED');
    return {
      reply: await this.buildReply(member.id, session.scope as MemberDataScope),
      verified: true,
    };
  }

  private verificationPrompt(scope: MemberDataScope): string {
    const what: Record<MemberDataScope, string> = {
      ACCOUNT: 'account details',
      PAYMENTS: 'payment history',
      APPOINTMENTS: 'appointments',
      VISITS: 'visit history',
      CLAIMS: 'claims',
    };
    return (
      `To protect your data, I need to verify it is you before I share your ${what[scope]}. ` +
      'I have sent a 6-digit code by SMS to the phone number on your account. ' +
      'Please reply with that code.'
    );
  }

  private async buildReply(
    memberId: string,
    scope: MemberDataScope,
  ): Promise<string> {
    switch (scope) {
      case 'PAYMENTS':
        return this.buildPaymentsReply(memberId);
      case 'APPOINTMENTS':
        return this.buildAppointmentsReply(memberId);
      case 'VISITS':
        return this.buildVisitsReply(memberId);
      case 'CLAIMS':
        return this.buildClaimsReply(memberId);
      case 'ACCOUNT':
      default:
        return this.buildAccountReply(memberId);
    }
  }

  private async buildPaymentsReply(memberId: string): Promise<string> {
    const [subscription, recent, completed, notCompletedCount] =
      await Promise.all([
        this.prisma.subscription.findUnique({
          where: { memberId },
          select: {
            tier: true,
            monthlyAmount: true,
            paymentFrequency: true,
            isActive: true,
            startDate: true,
            subscriptionStartDate: true,
          },
        }),
        // Recent rows of any status, so a failed or pending attempt is still
        // visible when a member asks "have I ever paid?".
        this.prisma.contribution.findMany({
          where: { memberId },
          orderBy: [{ month: 'desc' }, { createdAt: 'desc' }],
          take: 6,
          select: {
            month: true,
            amount: true,
            status: true,
            confirmedAt: true,
          },
        }),
        this.prisma.contribution.findMany({
          where: { memberId, status: 'COMPLETED' },
          orderBy: { month: 'desc' },
          take: CONSISTENCY_MONTHS * 2,
          select: { month: true, amount: true, confirmedAt: true },
        }),
        this.prisma.contribution.count({
          where: { memberId, status: { not: 'COMPLETED' } },
        }),
      ]);

    if (recent.length === 0) {
      return (
        'I do not see any membership payments on your account yet. ' +
        'If you have just paid, give it a few minutes and ask again.'
      );
    }

    const lines = recent.map(
      (item) =>
        `• ${this.monthLabel(item.month)}: ${this.money(item.amount)}, ${this.titleCase(
          item.status.replace(/_/g, ' ').toLowerCase(),
        )}.`,
    );

    if (completed.length === 0) {
      const parts = [
        'Here is your membership payment history:',
        '',
        ...lines,
        '',
        'I do not see any completed membership payments on your account yet.',
      ];
      if (notCompletedCount > 0) {
        parts.push(
          `Attempts not completed: ${notCompletedCount}. If a payment failed, you can retry in the app or ask me how to pay.`,
        );
      }
      if (subscription) {
        parts.push(this.membershipLine(subscription));
      }
      return parts.join('\n');
    }

    const paidMonths = new Set(
      completed.map((item) => this.monthKey(item.month)),
    );
    const now = new Date();
    const windowStart = new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth() - (CONSISTENCY_MONTHS - 1),
        1,
      ),
    );
    const subscriptionStart =
      subscription?.subscriptionStartDate ?? subscription?.startDate ?? null;
    const expectedStart =
      subscriptionStart && subscriptionStart > windowStart
        ? new Date(
            Date.UTC(
              subscriptionStart.getUTCFullYear(),
              subscriptionStart.getUTCMonth(),
              1,
            ),
          )
        : windowStart;
    const expectedMonths = this.monthRange(expectedStart, now);
    const paidInWindow = expectedMonths.filter((month) =>
      paidMonths.has(month),
    );
    const missed = expectedMonths.filter((month) => !paidMonths.has(month));
    const totalInWindow = completed
      .filter((item) => expectedMonths.includes(this.monthKey(item.month)))
      .reduce((sum, item) => sum + item.amount, 0);

    const consistency =
      expectedMonths.length > 0
        ? `${paidInWindow.length} of ${expectedMonths.length} months paid ` +
          `(${Math.round((paidInWindow.length / expectedMonths.length) * 100)}%)`
        : 'No payment schedule on record yet';

    const parts = [
      'Here is your membership payment history:',
      '',
      ...lines,
      '',
      `Total paid in the last ${expectedMonths.length || CONSISTENCY_MONTHS} months: ${this.money(totalInWindow)}`,
      `Consistency: ${consistency}.`,
    ];
    if (missed.length > 0) {
      const missedLabel =
        missed.length > 6
          ? `${missed.slice(0, 6).join(', ')} and ${missed.length - 6} more`
          : missed.join(', ');
      parts.push(`Months without a completed payment: ${missedLabel}.`);
    }
    if (notCompletedCount > 0) {
      parts.push(`Other attempts not completed: ${notCompletedCount}.`);
    }
    if (subscription) {
      parts.push(this.membershipLine(subscription));
    }
    return parts.join('\n');
  }

  private membershipLine(subscription: {
    tier: string;
    monthlyAmount: number;
    paymentFrequency: string;
    isActive: boolean;
  }): string {
    const frequency =
      subscription.paymentFrequency === 'ANNUAL' ? 'year' : 'month';
    return `Membership: ${this.titleCase(subscription.tier)} — ${
      subscription.isActive ? 'Active' : 'Not active'
    } · ${this.money(subscription.monthlyAmount)} per ${frequency}.`;
  }

  private async buildAppointmentsReply(memberId: string): Promise<string> {
    const appointments = await this.prisma.appointment.findMany({
      where: { memberId },
      orderBy: { scheduledAt: 'desc' },
      take: 6,
      select: {
        scheduledAt: true,
        status: true,
        clinic: { select: { name: true } },
      },
    });

    if (appointments.length === 0) {
      return 'You do not have any appointments on record yet. Would you like to book one?';
    }

    const now = new Date();
    const upcoming = appointments
      .filter(
        (item) =>
          item.scheduledAt >= now &&
          item.status !== 'CANCELLED_BY_MEMBER' &&
          item.status !== 'CANCELLED_BY_CLINIC',
      )
      .reverse();
    const past = appointments.filter((item) => item.scheduledAt < now);

    const lines: string[] = [];
    if (upcoming.length > 0) {
      lines.push('Upcoming:');
      for (const item of upcoming) {
        lines.push(
          `• ${this.dateTimeLabel(item.scheduledAt)} — ${item.clinic?.name ?? 'MenoDAO clinic'} (${this.appointmentStatus(item.status)})`,
        );
      }
    }
    if (past.length > 0) {
      if (lines.length > 0) lines.push('');
      lines.push('Recent:');
      for (const item of past.slice(0, 4)) {
        lines.push(
          `• ${this.dateTimeLabel(item.scheduledAt)} — ${item.clinic?.name ?? 'MenoDAO clinic'} (${this.appointmentStatus(item.status)})`,
        );
      }
    }
    return ['Here are your appointments:', '', ...lines].join('\n');
  }

  private async buildVisitsReply(memberId: string): Promise<string> {
    const visits = await this.prisma.visit.findMany({
      where: { memberId },
      orderBy: { checkedInAt: 'desc' },
      take: 5,
      select: {
        checkedInAt: true,
        totalCost: true,
        status: true,
        appointment: {
          select: { clinic: { select: { name: true } } },
        },
        procedures: {
          select: { procedure: { select: { name: true } } },
        },
      },
    });

    if (visits.length === 0) {
      return 'You do not have any clinic visits on record yet.';
    }

    const lines = visits.map((visit) => {
      const clinic = visit.appointment?.clinic?.name ?? 'MenoDAO clinic';
      const procedures = visit.procedures
        .map((item) => item.procedure?.name)
        .filter((name): name is string => Boolean(name))
        .join(', ');
      const cost =
        visit.totalCost > 0 ? ` — ${this.money(visit.totalCost)}` : '';
      return `• ${this.dateLabel(visit.checkedInAt)} — ${clinic}${
        procedures ? ` — ${procedures}` : ''
      }${cost}`;
    });

    return [
      'Here are your recent visits (clinical notes are only available in the app):',
      '',
      ...lines,
    ].join('\n');
  }

  private async buildClaimsReply(memberId: string): Promise<string> {
    const claims = await this.prisma.claim.findMany({
      where: { memberId },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: {
        claimType: true,
        amount: true,
        status: true,
        createdAt: true,
        processedAt: true,
      },
    });

    if (claims.length === 0) {
      return 'You do not have any claims on record yet.';
    }

    const lines = claims.map(
      (claim) =>
        `• ${this.dateLabel(claim.createdAt)} — ${this.titleCase(
          claim.claimType.replace(/_/g, ' ').toLowerCase(),
        )} — ${this.money(claim.amount)} — ${this.titleCase(
          claim.status.toLowerCase(),
        )}`,
    );
    return ['Here are your claims:', '', ...lines].join('\n');
  }

  private async buildAccountReply(memberId: string): Promise<string> {
    const now = new Date();
    const [member, contributionCount, upcomingAppointments] = await Promise.all(
      [
        this.prisma.member.findUnique({
          where: { id: memberId },
          select: {
            phoneNumber: true,
            fullName: true,
            createdAt: true,
            subscription: {
              select: { tier: true, isActive: true, monthlyAmount: true },
            },
          },
        }),
        this.prisma.contribution.count({
          where: { memberId, status: 'COMPLETED' },
        }),
        this.prisma.appointment.count({
          where: {
            memberId,
            scheduledAt: { gte: now },
            status: {
              in: [AppointmentStatus.BOOKED, AppointmentStatus.RESCHEDULED],
            },
          },
        }),
      ],
    );

    if (!member) {
      return 'I could not read your account details right now. Please try again.';
    }
    const maskedPhone = member.phoneNumber
      ? `...${member.phoneNumber.slice(-4)}`
      : 'not set';
    const tier = member.subscription
      ? `${this.titleCase(member.subscription.tier)} — ${
          member.subscription.isActive ? 'Active' : 'Not active'
        }`
      : 'No membership on record';
    return [
      'Here is your MenoDAO account summary:',
      '',
      `• Name: ${member.fullName || 'Member'}`,
      `• Phone: ${maskedPhone}`,
      `• Membership: ${tier}`,
      `• Member since: ${this.dateLabel(member.createdAt)}`,
      `• Completed payments on record: ${contributionCount}`,
      `• Upcoming appointments: ${upcomingAppointments}`,
    ].join('\n');
  }

  private async logAccess(
    memberId: string,
    scope: string,
    outcome: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.prisma.sensitiveDataAccessLog.create({
        data: {
          actorType: 'MEMBER',
          actorId: memberId,
          memberId,
          scope,
          channel: 'WHATSAPP',
          outcome,
          metadata: metadata as Prisma.InputJsonValue | undefined,
        },
      });
    } catch (error) {
      this.logger.warn(
        `Failed to write sensitive-data access log: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private monthKey(date: Date): string {
    return date.toISOString().slice(0, 7);
  }

  private monthRange(start: Date, end: Date): string[] {
    const months: string[] = [];
    const cursor = new Date(
      Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1),
    );
    const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
    while (cursor <= last && months.length < 24) {
      months.push(this.monthKey(cursor));
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
    return months;
  }

  private monthLabel(date: Date): string {
    return `${MONTH_NAMES[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
  }

  private dateLabel(date: Date): string {
    return `${String(date.getUTCDate()).padStart(2, '0')} ${
      MONTH_NAMES[date.getUTCMonth()]
    } ${date.getUTCFullYear()}`;
  }

  private dateTimeLabel(date: Date): string {
    const time = date.toLocaleTimeString('en-KE', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Africa/Nairobi',
    });
    return `${this.dateLabel(date)}, ${time}`;
  }

  private money(amount: number): string {
    return `KES ${amount.toLocaleString('en-KE')}`;
  }

  private titleCase(value: string): string {
    return value
      .toLowerCase()
      .replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
  }

  private appointmentStatus(status: string): string {
    return this.titleCase(status.replace(/_/g, ' ').toLowerCase());
  }
}
