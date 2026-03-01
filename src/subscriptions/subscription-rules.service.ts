import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PackageTier } from '@prisma/client';

// Frequency limits per tier per year (Protocol v5.0)
const FREQUENCY_LIMITS: Record<PackageTier, Record<string, number>> = {
  BRONZE: {
    CONSULT: 1,
    EXTRACT_SIMPLE: 1,
    SCALING_POLISHING: 1,
    FILLING_COMPOSITE: 0, // LOCKED
    ROOT_CANAL_ANTERIOR: 0, // LOCKED
    ANTIBIOTIC_THERAPY: 0, // LOCKED
  },
  SILVER: {
    CONSULT: 1,
    EXTRACT_SIMPLE: 1,
    SCALING_POLISHING: 1,
    FILLING_COMPOSITE: 1,
    ROOT_CANAL_ANTERIOR: 0, // LOCKED
    ANTIBIOTIC_THERAPY: 0, // LOCKED
  },
  GOLD: {
    CONSULT: 2,
    EXTRACT_SIMPLE: 2,
    SCALING_POLISHING: 2,
    FILLING_COMPOSITE: 2,
    ROOT_CANAL_ANTERIOR: 1,
    ANTIBIOTIC_THERAPY: 999, // Unlimited (within cap)
  },
};

// Emergency procedures (60-day wait for monthly payers)
const EMERGENCY_PROCEDURES = ['CONSULT', 'EXTRACT_SIMPLE'];

export interface EligibilityCheck {
  eligible: boolean;
  reason?: string;
  waitingPeriodDaysRemaining?: number;
  frequencyLimitReached?: boolean;
  currentUsage?: number;
  maxAllowed?: number;
  capExceeded?: boolean;
  currentCapUsed?: number;
  capLimit?: number;
  requiresPayment?: boolean;
  estimatedCost?: number;
}

@Injectable()
export class SubscriptionRulesService {
  private readonly logger = new Logger(SubscriptionRulesService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Check if member has passed waiting period for a procedure
   * BACKWARD COMPATIBLE: Returns passed=true if subscriptionStartDate is null (existing members)
   */
  async checkWaitingPeriod(
    memberId: string,
    procedureCode: string,
  ): Promise<{ passed: boolean; daysRemaining: number }> {
    const subscription = await this.prisma.subscription.findUnique({
      where: { memberId },
    });

    if (!subscription || !subscription.isActive) {
      return { passed: false, daysRemaining: 999 };
    }

    // BACKWARD COMPATIBLE: If no subscriptionStartDate, assume grandfathered (no waiting period)
    if (!subscription.subscriptionStartDate) {
      return { passed: true, daysRemaining: 0 };
    }

    const daysSinceStart = Math.floor(
      (Date.now() - subscription.subscriptionStartDate.getTime()) /
        (1000 * 60 * 60 * 24),
    );

    let requiredDays: number;

    if (subscription.paymentFrequency === 'ANNUAL') {
      requiredDays = 14; // Annual payers: 14 days for all procedures
    } else {
      // Monthly payers
      if (EMERGENCY_PROCEDURES.includes(procedureCode)) {
        requiredDays = 60; // Emergency procedures: 60 days
      } else {
        requiredDays = 90; // Restorative procedures: 90 days
      }
    }

    const passed = daysSinceStart >= requiredDays;
    const daysRemaining = Math.max(0, requiredDays - daysSinceStart);

    return { passed, daysRemaining };
  }

  /**
   * Check if member has exceeded frequency limit for a procedure
   * BACKWARD COMPATIBLE: Returns withinLimit=true if procedureUsageCount is null/empty
   */
  async checkFrequencyLimit(
    memberId: string,
    procedureCode: string,
  ): Promise<{
    withinLimit: boolean;
    currentUsage: number;
    maxAllowed: number;
  }> {
    const subscription = await this.prisma.subscription.findUnique({
      where: { memberId },
    });

    if (!subscription) {
      return { withinLimit: false, currentUsage: 0, maxAllowed: 0 };
    }

    // BACKWARD COMPATIBLE: If no usage tracking, allow all procedures
    const usageCount =
      (subscription.procedureUsageCount as Record<string, number>) || {};
    const currentUsage = usageCount[procedureCode] || 0;
    const maxAllowed =
      FREQUENCY_LIMITS[subscription.tier][procedureCode] || 999; // Default to unlimited if not defined

    // If maxAllowed is 999 (unlimited) or usage tracking not initialized, allow
    if (maxAllowed === 999 || !subscription.procedureUsageCount) {
      return { withinLimit: true, currentUsage, maxAllowed };
    }

    return {
      withinLimit: currentUsage < maxAllowed,
      currentUsage,
      maxAllowed,
    };
  }

  /**
   * Check if adding a procedure would exceed annual cap
   * BACKWARD COMPATIBLE: Returns withinCap=true if annualCapLimit is 0 or null
   */
  async checkAnnualCap(
    memberId: string,
    procedureCost: number,
  ): Promise<{
    withinCap: boolean;
    currentUsed: number;
    capLimit: number;
    wouldExceed: boolean;
  }> {
    const subscription = await this.prisma.subscription.findUnique({
      where: { memberId },
    });

    if (!subscription) {
      return {
        withinCap: false,
        currentUsed: 0,
        capLimit: 0,
        wouldExceed: true,
      };
    }

    const currentUsed = subscription.annualCapUsed || 0;
    const capLimit = subscription.annualCapLimit || 0;

    // BACKWARD COMPATIBLE: If no cap set (0 or null), allow all procedures
    if (capLimit === 0) {
      return {
        withinCap: true,
        currentUsed,
        capLimit: 999999, // Show as unlimited
        wouldExceed: false,
      };
    }

    const wouldExceed = currentUsed + procedureCost > capLimit;

    return {
      withinCap: !wouldExceed,
      currentUsed,
      capLimit,
      wouldExceed,
    };
  }

  /**
   * Comprehensive eligibility check for a procedure
   */
  async checkProcedureEligibility(
    memberId: string,
    procedureCode: string,
    procedureCost: number,
  ): Promise<EligibilityCheck> {
    // Check waiting period
    const waitingPeriod = await this.checkWaitingPeriod(
      memberId,
      procedureCode,
    );
    if (!waitingPeriod.passed) {
      return {
        eligible: false,
        reason: `Waiting period not met. ${waitingPeriod.daysRemaining} days remaining.`,
        waitingPeriodDaysRemaining: waitingPeriod.daysRemaining,
      };
    }

    // Check frequency limit
    const frequencyCheck = await this.checkFrequencyLimit(
      memberId,
      procedureCode,
    );
    if (!frequencyCheck.withinLimit) {
      return {
        eligible: false,
        reason: `Frequency limit reached. Used ${frequencyCheck.currentUsage}/${frequencyCheck.maxAllowed} for this year.`,
        frequencyLimitReached: true,
        currentUsage: frequencyCheck.currentUsage,
        maxAllowed: frequencyCheck.maxAllowed,
        requiresPayment: true,
        estimatedCost: procedureCost,
      };
    }

    // Check if procedure is locked for tier
    if (frequencyCheck.maxAllowed === 0) {
      return {
        eligible: false,
        reason: `Procedure not covered by your tier. Upgrade required or pay out-of-pocket.`,
        frequencyLimitReached: true,
        currentUsage: 0,
        maxAllowed: 0,
        requiresPayment: true,
        estimatedCost: procedureCost,
      };
    }

    // Check annual cap
    const capCheck = await this.checkAnnualCap(memberId, procedureCost);
    if (capCheck.wouldExceed) {
      return {
        eligible: false,
        reason: `Annual cap would be exceeded. Used KES ${capCheck.currentUsed}/${capCheck.capLimit}. This procedure costs KES ${procedureCost}.`,
        capExceeded: true,
        currentCapUsed: capCheck.currentUsed,
        capLimit: capCheck.capLimit,
        requiresPayment: true,
        estimatedCost: procedureCost,
      };
    }

    // All checks passed
    return {
      eligible: true,
      currentUsage: frequencyCheck.currentUsage,
      maxAllowed: frequencyCheck.maxAllowed,
      currentCapUsed: capCheck.currentUsed,
      capLimit: capCheck.capLimit,
    };
  }

  /**
   * Increment procedure usage count after successful claim
   */
  async incrementProcedureUsage(
    memberId: string,
    procedureCode: string,
    cost: number,
  ): Promise<void> {
    const subscription = await this.prisma.subscription.findUnique({
      where: { memberId },
    });

    if (!subscription) {
      throw new Error('Subscription not found');
    }

    const usageCount =
      (subscription.procedureUsageCount as Record<string, number>) || {};
    usageCount[procedureCode] = (usageCount[procedureCode] || 0) + 1;

    await this.prisma.subscription.update({
      where: { memberId },
      data: {
        procedureUsageCount: usageCount,
        annualCapUsed: subscription.annualCapUsed + cost,
      },
    });

    this.logger.log(
      `Incremented ${procedureCode} usage for member ${memberId}. New count: ${usageCount[procedureCode]}`,
    );
  }

  /**
   * Reset annual counters (called on anniversary date)
   */
  async resetAnnualCounters(memberId: string): Promise<void> {
    await this.prisma.subscription.update({
      where: { memberId },
      data: {
        annualCapUsed: 0,
        procedureUsageCount: {},
        lastResetDate: new Date(),
      },
    });

    this.logger.log(`Reset annual counters for member ${memberId}`);
  }

  /**
   * Check if annual reset is due and perform it
   */
  async checkAndResetIfDue(memberId: string): Promise<boolean> {
    const subscription = await this.prisma.subscription.findUnique({
      where: { memberId },
    });

    if (!subscription) {
      return false;
    }

    const daysSinceReset = Math.floor(
      (Date.now() - subscription.lastResetDate.getTime()) /
        (1000 * 60 * 60 * 24),
    );

    if (daysSinceReset >= 365) {
      await this.resetAnnualCounters(memberId);
      return true;
    }

    return false;
  }
}
