import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { PackageTier, PaymentStatus, WithdrawalStatus } from '@prisma/client';
import { SasaPayService } from '../sasapay/sasapay.service';
import { SmsService } from '../sms/sms.service';

// ─── Interfaces ──────────────────────────────────────────────────────────────

export interface ChampionStats {
  referralCode: string;
  inviteLink: string;
  totalReferrals: number;
  activeReferrals: number;
  commissionsEarned: number;
  commissionsWithdrawn: number;
  commissionsBalance: number;
  isGoldMember: boolean;
}

export interface ReferralEntry {
  id: string;
  firstName: string;
  registrationDate: Date;
  firstPaymentCleared: boolean;
}

export interface PaginatedReferrals {
  data: ReferralEntry[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export interface LeaderboardEntry {
  rank: number;
  firstName: string;
  referralCode: string;
  totalReferrals: number;
  activeReferrals: number;
  totalCommissionsEarned: number;
  memberSince: Date;
}

// ─── Service ─────────────────────────────────────────────────────────────────

@Injectable()
export class ReferralService {
  private readonly logger = new Logger(ReferralService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly sasapay: SasaPayService,
    private readonly smsService: SmsService,
  ) {}

  // ── Referral Code Generation ────────────────────────────────────────────────

  /**
   * Generate a unique referral code: FIRSTNAME_XXXX
   * where FIRSTNAME = uppercase first word of fullName
   * and XXXX = last 4 digits of phoneNumber.
   * Collision handling: append _01, _02, etc.
   */
  async generateReferralCode(
    fullName: string,
    phoneNumber: string,
  ): Promise<string> {
    const firstName = fullName.trim().split(/\s+/)[0].toUpperCase();
    const lastFour = phoneNumber.replace(/\D/g, '').slice(-4);
    const baseCode = `${firstName}_${lastFour}`;

    // Check if base code is available
    const existing = await this.prisma.member.findUnique({
      where: { referralCode: baseCode },
      select: { id: true },
    });

    if (!existing) {
      return baseCode;
    }

    // Collision: try _01, _02, ... _99
    for (let i = 1; i <= 99; i++) {
      const suffix = String(i).padStart(2, '0');
      const candidate = `${baseCode}_${suffix}`;
      const collision = await this.prisma.member.findUnique({
        where: { referralCode: candidate },
        select: { id: true },
      });
      if (!collision) {
        this.logger.log(
          `Referral code collision resolved: ${baseCode} → ${candidate}`,
        );
        return candidate;
      }
    }

    // Extremely unlikely fallback: use timestamp suffix
    const fallback = `${baseCode}_${Date.now().toString().slice(-4)}`;
    this.logger.warn(
      `All collision suffixes exhausted for ${baseCode}, using fallback: ${fallback}`,
    );
    return fallback;
  }

  /**
   * Ensure a member has a referral code.
   * - No-op if code already set (returns existing code).
   * - Returns null if fullName or phoneNumber is missing.
   * - Generates and saves code otherwise.
   */
  async ensureReferralCode(memberId: string): Promise<string | null> {
    const member = await this.prisma.member.findUnique({
      where: { id: memberId },
      select: {
        id: true,
        referralCode: true,
        fullName: true,
        phoneNumber: true,
      },
    });

    if (!member) {
      this.logger.warn(`ensureReferralCode: member ${memberId} not found`);
      return null;
    }

    // Already has a code — no-op
    if (member.referralCode) {
      return member.referralCode;
    }

    // Defer if missing required fields
    if (!member.fullName || !member.phoneNumber) {
      this.logger.log(
        `ensureReferralCode: deferring for member ${memberId} — fullName or phoneNumber missing`,
      );
      return null;
    }

    const code = await this.generateReferralCode(
      member.fullName,
      member.phoneNumber,
    );

    await this.prisma.member.update({
      where: { id: memberId },
      data: { referralCode: code },
    });

    this.logger.log(`Referral code generated for member ${memberId}: ${code}`);
    return code;
  }

  // ── Commission Crediting ────────────────────────────────────────────────────

  /**
   * Credit 10% commission to the champion when a referred user's first payment
   * is confirmed. All writes happen in a single Prisma transaction.
   */
  async creditCommission(contributionId: string): Promise<void> {
    const commissionEnabled =
      this.config.get<string>('REFERRAL_COMMISSION_ENABLED') !== 'false';
    if (!commissionEnabled) {
      this.logger.log(
        '[REFERRAL] Commission crediting is disabled via feature flag',
      );
      return;
    }

    // Load contribution with member and their subscription tier
    const contribution = await this.prisma.contribution.findUnique({
      where: { id: contributionId },
      include: {
        member: {
          include: { subscription: true },
        },
      },
    });

    if (!contribution) {
      this.logger.warn(
        `creditCommission: contribution ${contributionId} not found`,
      );
      return;
    }

    const member = contribution.member;

    // Skip if no referredBy
    if (!member.referredBy) {
      return;
    }

    // Skip if first payment already cleared (idempotency)
    if (member.firstPaymentCleared) {
      this.logger.log(
        `creditCommission: firstPaymentCleared already true for member ${member.id}, skipping`,
      );
      return;
    }

    // Find the champion by referral code
    const champion = await this.prisma.member.findUnique({
      where: { referralCode: member.referredBy },
      select: { id: true },
    });

    if (!champion) {
      this.logger.warn(
        `creditCommission: champion with referralCode ${member.referredBy} not found`,
      );
      return;
    }

    const commissionAmount = Math.floor(contribution.amount * 0.1);
    const tier: PackageTier = member.subscription?.tier ?? PackageTier.BRONZE;

    this.logger.log(
      `Crediting commission: championId=${champion.id}, referredUserId=${member.id}, ` +
        `contributionId=${contributionId}, amount=${commissionAmount} KES, tier=${tier}`,
    );

    // Single transaction: increment balance, set flag, create ledger entry
    await this.prisma.$transaction([
      this.prisma.member.update({
        where: { id: champion.id },
        data: { commissionsBalance: { increment: commissionAmount } },
      }),
      this.prisma.member.update({
        where: { id: member.id },
        data: { firstPaymentCleared: true },
      }),
      this.prisma.commissionLedger.create({
        data: {
          championId: champion.id,
          referredUserId: member.id,
          contributionId,
          amount: commissionAmount,
          tier,
        },
      }),
    ]);

    this.logger.log(
      `Commission credited: ${commissionAmount} KES to champion ${champion.id}`,
    );
  }

  // ── Active Referral Count ───────────────────────────────────────────────────

  /**
   * Count members where referredBy = code AND firstPaymentCleared = true
   * AND subscription.isActive = true.
   */
  async recalculateActiveReferralCount(
    championReferralCode: string,
  ): Promise<number> {
    const count = await this.prisma.member.count({
      where: {
        referredBy: championReferralCode,
        firstPaymentCleared: true,
        subscription: { isActive: true },
      },
    });
    return count;
  }

  /**
   * Recalculate and persist activeReferralsCount for the champion identified
   * by referralCode, then evaluate Gold Member status.
   */
  async updateActiveReferralCount(championReferralCode: string): Promise<void> {
    const count =
      await this.recalculateActiveReferralCount(championReferralCode);

    const champion = await this.prisma.member.findUnique({
      where: { referralCode: championReferralCode },
      select: { id: true, activeReferralsCount: true },
    });

    if (!champion) {
      this.logger.warn(
        `updateActiveReferralCount: champion with code ${championReferralCode} not found`,
      );
      return;
    }

    this.logger.log(
      `Active referral count for champion ${champion.id}: ${champion.activeReferralsCount} → ${count}`,
    );

    await this.prisma.member.update({
      where: { id: champion.id },
      data: { activeReferralsCount: count },
    });

    await this.evaluateGoldMemberStatus(champion.id);
  }

  // ── Gold Member Status ──────────────────────────────────────────────────────

  /**
   * Evaluate and persist isGoldMember status.
   * If transitioning to true, trigger processGoldMemberWaiver.
   * Returns the new isGoldMember value.
   */
  async evaluateGoldMemberStatus(championId: string): Promise<boolean> {
    const champion = await this.prisma.member.findUnique({
      where: { id: championId },
      select: { id: true, activeReferralsCount: true, isGoldMember: true },
    });

    if (!champion) {
      this.logger.warn(
        `evaluateGoldMemberStatus: champion ${championId} not found`,
      );
      return false;
    }

    const newIsGoldMember = champion.activeReferralsCount >= 25;

    if (newIsGoldMember !== champion.isGoldMember) {
      this.logger.log(
        `Gold Member status changed for champion ${championId}: ${champion.isGoldMember} → ${newIsGoldMember}`,
      );

      await this.prisma.member.update({
        where: { id: championId },
        data: { isGoldMember: newIsGoldMember },
      });

      if (newIsGoldMember) {
        await this.processGoldMemberWaiver(championId);
      }
    }

    return newIsGoldMember;
  }

  /**
   * Create a COMPLETED Contribution record representing the waived monthly
   * premium for a Gold Champion.
   */
  async processGoldMemberWaiver(championId: string): Promise<void> {
    const champion = await this.prisma.member.findUnique({
      where: { id: championId },
      include: { subscription: true },
    });

    if (!champion || !champion.subscription) {
      this.logger.warn(
        `processGoldMemberWaiver: champion ${championId} has no subscription`,
      );
      return;
    }

    const now = new Date();
    const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    await this.prisma.contribution.create({
      data: {
        memberId: championId,
        amount: champion.subscription.monthlyAmount,
        month: currentMonth,
        paymentMethod: 'waived',
        status: PaymentStatus.COMPLETED,
        metadata: {
          waivedReason: 'gold_champion_benefit',
          waivedAt: now.toISOString(),
        },
      },
    });

    this.logger.log(
      `Gold Member waiver created for champion ${championId}: ` +
        `${champion.subscription.monthlyAmount} KES waived for ${currentMonth.toISOString().slice(0, 7)}`,
    );
  }

  // ── Query Methods ───────────────────────────────────────────────────────────

  /**
   * Return champion stats for the dashboard.
   */
  async getChampionStats(memberId: string): Promise<ChampionStats> {
    const member = await this.prisma.member.findUnique({
      where: { id: memberId },
      select: {
        referralCode: true,
        fullName: true,
        phoneNumber: true,
        activeReferralsCount: true,
        commissionsBalance: true,
        commissionsWithdrawn: true,
        isGoldMember: true,
      },
    });

    if (!member) {
      throw new Error(`Champion stats not available for member ${memberId}`);
    }

    // Generate referral code on-the-fly for existing members who don't have one yet
    let referralCode = member.referralCode;
    if (!referralCode) {
      referralCode = await this.ensureReferralCode(memberId);
    }

    // If still no code (missing fullName/phoneNumber), return a placeholder response
    if (!referralCode) {
      return {
        referralCode: '',
        inviteLink: '',
        totalReferrals: 0,
        activeReferrals: 0,
        commissionsEarned: 0,
        commissionsWithdrawn: member.commissionsWithdrawn,
        commissionsBalance: member.commissionsBalance,
        isGoldMember: member.isGoldMember,
      };
    }

    // Generate invite link — derive host from NODE_ENV so no extra secret is needed
    const frontendBaseUrl = (() => {
      const nodeEnv = this.config.get<string>('NODE_ENV');
      if (nodeEnv === 'production') return 'https://app.menodao.org';
      // Explicit override takes precedence (useful for local dev)
      const override = this.config.get<string>('FRONTEND_BASE_URL');
      if (override) return override;
      return 'https://dev.menodao.org';
    })();
    const inviteLink = `${frontendBaseUrl}/sign-up?ref=${referralCode}`;

    const [totalReferrals, commissionsEarnedResult] = await Promise.all([
      this.prisma.member.count({
        where: { referredBy: referralCode },
      }),
      this.prisma.commissionLedger.aggregate({
        where: { championId: memberId },
        _sum: { amount: true },
      }),
    ]);

    const commissionsEarned = commissionsEarnedResult._sum.amount ?? 0;

    return {
      referralCode,
      inviteLink,
      totalReferrals,
      activeReferrals: member.activeReferralsCount,
      commissionsEarned,
      commissionsWithdrawn: member.commissionsWithdrawn,
      commissionsBalance: member.commissionsBalance,
      isGoldMember: member.isGoldMember,
    };
  }

  /**
   * Return a paginated list of members referred by this champion.
   */
  async getChampionReferrals(
    memberId: string,
    page: number,
    limit: number,
  ): Promise<PaginatedReferrals> {
    const member = await this.prisma.member.findUnique({
      where: { id: memberId },
      select: { referralCode: true },
    });

    if (!member?.referralCode) {
      return {
        data: [],
        meta: { total: 0, page, limit, totalPages: 0 },
      };
    }

    const skip = (page - 1) * limit;

    const [referrals, total] = await Promise.all([
      this.prisma.member.findMany({
        where: { referredBy: member.referralCode },
        select: {
          id: true,
          fullName: true,
          phoneNumber: true,
          createdAt: true,
          firstPaymentCleared: true,
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.member.count({
        where: { referredBy: member.referralCode },
      }),
    ]);

    const data: ReferralEntry[] = referrals.map((r) => ({
      id: r.id,
      firstName: r.fullName
        ? r.fullName.trim().split(/\s+/)[0]
        : `***${r.phoneNumber.slice(-4)}`,
      registrationDate: r.createdAt,
      firstPaymentCleared: r.firstPaymentCleared,
    }));

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Return the top champions ordered by activeReferralsCount DESC.
   */
  async getLeaderboard(limit = 50): Promise<LeaderboardEntry[]> {
    const champions = await this.prisma.member.findMany({
      where: { referralCode: { not: null } },
      select: {
        id: true,
        fullName: true,
        referralCode: true,
        activeReferralsCount: true,
        createdAt: true,
      },
      orderBy: { activeReferralsCount: 'desc' },
      take: limit,
    });

    const entries: LeaderboardEntry[] = await Promise.all(
      champions.map(async (c, index) => {
        const [totalReferrals, commissionsResult] = await Promise.all([
          this.prisma.member.count({
            where: { referredBy: c.referralCode! },
          }),
          this.prisma.commissionLedger.aggregate({
            where: { championId: c.id },
            _sum: { amount: true },
          }),
        ]);

        return {
          rank: index + 1,
          firstName: c.fullName ? c.fullName.trim().split(/\s+/)[0] : 'Member',
          referralCode: c.referralCode!,
          totalReferrals,
          activeReferrals: c.activeReferralsCount,
          totalCommissionsEarned: commissionsResult._sum.amount ?? 0,
          memberSince: c.createdAt,
        };
      }),
    );

    return entries;
  }

  // ── Withdrawal History ──────────────────────────────────────────────────────

  async getWithdrawalHistory(championId: string) {
    return this.prisma.withdrawalRecord.findMany({
      where: { championId },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ── Withdrawal Flow ─────────────────────────────────────────────────────────

  /**
   * Request a commission withdrawal.
   * - Validates KES 200 minimum threshold.
   * - First-ever payout → PENDING_ADMIN_APPROVAL.
   * - Subsequent payouts → auto-disburse via SasaPay.
   */
  async requestWithdrawal(championId: string, amount: number) {
    const commissionEnabled =
      this.config.get<string>('REFERRAL_WITHDRAWALS_ENABLED') !== 'false';
    if (!commissionEnabled) {
      throw new BadRequestException('Withdrawals are temporarily disabled.');
    }

    const champion = await this.prisma.member.findUnique({
      where: { id: championId },
      select: {
        id: true,
        fullName: true,
        phoneNumber: true,
        commissionsBalance: true,
        commissionsWithdrawn: true,
      },
    });

    if (!champion) {
      throw new NotFoundException('Champion not found');
    }

    if (amount < 200) {
      throw new BadRequestException('Minimum withdrawal amount is KES 200');
    }

    if (amount > champion.commissionsBalance) {
      throw new BadRequestException(
        'Withdrawal amount exceeds your available balance.',
      );
    }

    const isFirstPayout = champion.commissionsWithdrawn === 0;

    const withdrawal = await this.prisma.withdrawalRecord.create({
      data: {
        championId,
        amount,
        status: isFirstPayout
          ? WithdrawalStatus.PENDING_ADMIN_APPROVAL
          : WithdrawalStatus.PENDING,
      },
    });

    this.logger.log(
      `Withdrawal requested: championId=${championId}, amount=${amount}, ` +
        `status=${withdrawal.status}, withdrawalId=${withdrawal.id}`,
    );

    if (!isFirstPayout) {
      // Auto-disburse subsequent payouts
      await this.processWithdrawal(withdrawal.id);
    }

    return withdrawal;
  }

  /**
   * Admin approves a first-payout withdrawal.
   */
  async approveWithdrawal(
    withdrawalId: string,
    adminId: string,
  ): Promise<void> {
    const withdrawal = await this.prisma.withdrawalRecord.findUnique({
      where: { id: withdrawalId },
    });

    if (!withdrawal) {
      throw new NotFoundException(`Withdrawal ${withdrawalId} not found`);
    }

    if (withdrawal.status !== WithdrawalStatus.PENDING_ADMIN_APPROVAL) {
      throw new BadRequestException(
        `Withdrawal is not pending admin approval. Current status: ${withdrawal.status}`,
      );
    }

    await this.prisma.withdrawalRecord.update({
      where: { id: withdrawalId },
      data: {
        status: WithdrawalStatus.APPROVED,
        approvedAt: new Date(),
      },
    });

    this.logger.log(`Withdrawal ${withdrawalId} approved by admin ${adminId}`);

    await this.processWithdrawal(withdrawalId);
  }

  /**
   * Admin rejects a first-payout withdrawal.
   */
  async rejectWithdrawal(
    withdrawalId: string,
    adminId: string,
    reason: string,
  ): Promise<void> {
    const withdrawal = await this.prisma.withdrawalRecord.findUnique({
      where: { id: withdrawalId },
      include: {
        champion: {
          select: {
            fullName: true,
            phoneNumber: true,
            commissionsBalance: true,
          },
        },
      },
    });

    if (!withdrawal) {
      throw new NotFoundException(`Withdrawal ${withdrawalId} not found`);
    }

    if (withdrawal.status !== WithdrawalStatus.PENDING_ADMIN_APPROVAL) {
      throw new BadRequestException(
        `Withdrawal is not pending admin approval. Current status: ${withdrawal.status}`,
      );
    }

    await this.prisma.withdrawalRecord.update({
      where: { id: withdrawalId },
      data: {
        status: WithdrawalStatus.REJECTED,
        rejectionReason: reason,
      },
    });

    this.logger.log(
      `Withdrawal ${withdrawalId} rejected by admin ${adminId}: ${reason}`,
    );

    // Send SMS notification (fire-and-forget)
    try {
      const firstName = withdrawal.champion.fullName?.split(' ')[0] ?? 'Member';
      const message =
        `Dear ${firstName}, your MenoDAO commission withdrawal of KES ${withdrawal.amount} has been rejected. ` +
        `Reason: ${reason}. Your balance remains KES ${withdrawal.champion.commissionsBalance}. ` +
        `Contact support for assistance.`;
      await this.smsService.sendSms(withdrawal.champion.phoneNumber, message);
    } catch (smsError) {
      this.logger.error(
        `[SMS] Failed to send rejection notification for withdrawal ${withdrawalId}: ${smsError?.message}`,
      );
    }
  }

  /**
   * Process a withdrawal via SasaPay B2C.
   * On success: set COMPLETED, decrement balance, increment withdrawn.
   * On failure: set FAILED, preserve balance.
   */
  async processWithdrawal(withdrawalId: string): Promise<void> {
    const withdrawal = await this.prisma.withdrawalRecord.findUnique({
      where: { id: withdrawalId },
      include: {
        champion: {
          select: { id: true, phoneNumber: true, commissionsBalance: true },
        },
      },
    });

    if (!withdrawal) {
      throw new NotFoundException(`Withdrawal ${withdrawalId} not found`);
    }

    const txRef = `CHAMP_WITHDRAW_${Date.now()}_${withdrawalId.slice(0, 8)}`;

    this.logger.log(
      `Processing withdrawal ${withdrawalId}: amount=${withdrawal.amount}, ` +
        `phone=${withdrawal.champion.phoneNumber}, ref=${txRef}`,
    );

    try {
      const result = await this.sasapay.sendMoney(
        withdrawal.champion.phoneNumber,
        withdrawal.amount,
        txRef,
        `MenoDAO Champion Commission Withdrawal - ${txRef}`,
      );

      if (!result.status) {
        throw new Error(result.detail || 'SasaPay disbursement failed');
      }

      // Success: update record and balances atomically
      await this.prisma.$transaction([
        this.prisma.withdrawalRecord.update({
          where: { id: withdrawalId },
          data: {
            status: WithdrawalStatus.COMPLETED,
            sasaPayRequestId: result.MerchantRequestID,
            completedAt: new Date(),
          },
        }),
        this.prisma.member.update({
          where: { id: withdrawal.championId },
          data: {
            commissionsBalance: { decrement: withdrawal.amount },
            commissionsWithdrawn: { increment: withdrawal.amount },
          },
        }),
      ]);

      this.logger.log(
        `Withdrawal ${withdrawalId} completed: ${withdrawal.amount} KES disbursed to champion ${withdrawal.championId}`,
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Withdrawal ${withdrawalId} failed: ${errorMessage}`);

      await this.prisma.withdrawalRecord.update({
        where: { id: withdrawalId },
        data: {
          status: WithdrawalStatus.FAILED,
          errorMessage,
        },
      });
      // Do NOT modify commissionsBalance on failure
    }
  }
}
