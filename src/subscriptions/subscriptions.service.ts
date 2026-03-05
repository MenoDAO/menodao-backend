import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { BlockchainService } from '../blockchain/blockchain.service';
import { PackageTier } from '@prisma/client';

// Package pricing in KES (Protocol v5.0 - March 20th Launch)
const PACKAGE_PRICES: Record<PackageTier, { monthly: number; annual: number }> =
  {
    BRONZE: { monthly: 350, annual: 4200 },
    SILVER: { monthly: 550, annual: 6600 },
    GOLD: { monthly: 700, annual: 8400 },
  };

// Dev environment pricing (for testing)
const DEV_PACKAGE_PRICES: Record<
  PackageTier,
  { monthly: number; annual: number }
> = {
  BRONZE: { monthly: 3, annual: 42 },
  SILVER: { monthly: 5, annual: 66 },
  GOLD: { monthly: 7, annual: 84 },
};

// Annual financial caps per tier
const ANNUAL_CAPS: Record<PackageTier, number> = {
  BRONZE: 6000,
  SILVER: 10000,
  GOLD: 15000,
};

// Frequency limits per tier per year
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

// Package benefits with updated tier names
const PACKAGE_BENEFITS: Record<PackageTier, string[]> = {
  BRONZE: [
    'MenoBronze Package',
    '1 Consultation per year',
    '1 Simple Extraction per year',
    '1 Scaling & Polishing per year',
    'Annual cap: KES 6,000',
    'Access to dental camps',
    'Member NFT badge',
  ],
  SILVER: [
    'MenoSilver Package',
    '1 Consultation per year',
    '1 Simple Extraction per year',
    '1 Scaling & Polishing per year',
    '1 Composite Filling per year',
    'Annual cap: KES 10,000',
    'Access to dental camps',
    'Priority booking',
    'Silver NFT badge',
  ],
  GOLD: [
    'MenoGold Package',
    '2 Consultations per year',
    '2 Simple Extractions per year',
    '2 Scaling & Polishing per year',
    '2 Composite Fillings per year',
    '1 Anterior Root Canal per year',
    'Unlimited Antibiotic Therapy (within cap)',
    'Annual cap: KES 15,000',
    'Access to dental camps',
    'VIP priority booking',
    'Gold NFT badge',
    'Family discounts',
  ],
};

@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);
  private readonly isDevEnvironment: boolean;

  constructor(
    private prisma: PrismaService,
    private blockchainService: BlockchainService,
    private configService: ConfigService,
  ) {
    this.isDevEnvironment =
      this.configService.get('NODE_ENV') === 'development';
    if (this.isDevEnvironment) {
      this.logger.log('Using dev pricing (3, 5, 7 KES)');
    }
  }

  /**
   * Get the appropriate price for a tier based on environment and payment frequency
   */
  private getPrice(
    tier: PackageTier,
    frequency: 'monthly' | 'annual' = 'monthly',
  ): number {
    return this.isDevEnvironment
      ? DEV_PACKAGE_PRICES[tier][frequency]
      : PACKAGE_PRICES[tier][frequency];
  }

  /**
   * Get the display price (always show production prices to users)
   */
  private getDisplayPrice(
    tier: PackageTier,
    frequency: 'monthly' | 'annual' = 'monthly',
  ): number {
    return PACKAGE_PRICES[tier][frequency];
  }

  getPackages() {
    return Object.entries(PACKAGE_PRICES).map(([tier, prices]) => ({
      tier,
      displayName: `Meno${tier.charAt(0) + tier.slice(1).toLowerCase()}`, // MenoBronze, MenoSilver, MenoGold
      monthlyPrice: prices.monthly,
      annualPrice: prices.annual,
      annualCap: ANNUAL_CAPS[tier as PackageTier],
      frequencyLimits: FREQUENCY_LIMITS[tier as PackageTier],
      // In dev, show actual charge amount for testing
      actualMonthlyCharge: this.isDevEnvironment
        ? DEV_PACKAGE_PRICES[tier as PackageTier].monthly
        : prices.monthly,
      actualAnnualCharge: this.isDevEnvironment
        ? DEV_PACKAGE_PRICES[tier as PackageTier].annual
        : prices.annual,
      benefits: PACKAGE_BENEFITS[tier as PackageTier],
      isDevPricing: this.isDevEnvironment,
    }));
  }

  /**
   * Create a pending subscription (awaiting payment)
   * The subscription becomes active only after payment is confirmed
   */
  async subscribe(
    memberId: string,
    tier: PackageTier,
    paymentFrequency: 'MONTHLY' | 'ANNUAL' = 'MONTHLY',
  ) {
    // Check if member already has subscription
    const existing = await this.prisma.subscription.findUnique({
      where: { memberId },
    });

    const frequency = paymentFrequency.toLowerCase() as 'monthly' | 'annual';
    const annualCap = ANNUAL_CAPS[tier];

    if (existing) {
      if (existing.isActive) {
        throw new BadRequestException(
          'Member already has an active subscription. Use upgrade instead.',
        );
      }
      // If inactive subscription exists, update it
      const subscription = await this.prisma.subscription.update({
        where: { memberId },
        data: {
          tier,
          monthlyAmount: this.getDisplayPrice(tier, 'monthly'),
          paymentFrequency,
          subscriptionStartDate: new Date(),
          annualCapLimit: annualCap,
          annualCapUsed: 0,
          procedureUsageCount: {},
          lastResetDate: new Date(),
          isActive: false,
        },
      });

      return {
        subscription,
        paymentRequired: true,
        paymentAmount: this.getPrice(tier, frequency),
        displayAmount: this.getDisplayPrice(tier, frequency),
        paymentFrequency,
        waitingPeriod: paymentFrequency === 'ANNUAL' ? 14 : 60, // days
        message: 'Please complete payment to activate your subscription',
      };
    }

    // Create subscription (inactive until payment)
    const subscription = await this.prisma.subscription.create({
      data: {
        memberId,
        tier,
        monthlyAmount: this.getDisplayPrice(tier, 'monthly'),
        paymentFrequency,
        subscriptionStartDate: new Date(),
        annualCapLimit: annualCap,
        annualCapUsed: 0,
        procedureUsageCount: {},
        lastResetDate: new Date(),
        isActive: false, // Will be activated after payment
      },
    });

    return {
      subscription,
      paymentRequired: true,
      paymentAmount: this.getPrice(tier, frequency),
      displayAmount: this.getDisplayPrice(tier, frequency),
      paymentFrequency,
      waitingPeriod: paymentFrequency === 'ANNUAL' ? 14 : 60, // days
      message: 'Please complete payment to activate your subscription',
    };
  }

  /**
   * Activate subscription after successful payment
   * Called by payment callback
   */
  async activateSubscription(memberId: string): Promise<void> {
    const subscription = await this.prisma.subscription.findUnique({
      where: { memberId },
    });

    if (!subscription) {
      throw new NotFoundException('No subscription found for member');
    }

    // Activate the subscription
    await this.prisma.subscription.update({
      where: { memberId },
      data: { isActive: true },
    });

    // Mint NFT for the member
    try {
      await this.blockchainService.mintMembershipNFT(
        memberId,
        subscription.tier,
      );
      this.logger.log(
        `NFT minted for member ${memberId} - ${subscription.tier}`,
      );
    } catch (error) {
      this.logger.error('Failed to mint NFT:', error);
      // Continue - NFT minting is non-blocking
    }
  }

  async upgrade(memberId: string, newTier: PackageTier) {
    const existing = await this.prisma.subscription.findUnique({
      where: { memberId },
    });

    if (!existing) {
      throw new NotFoundException('No existing subscription found');
    }

    if (!existing.isActive) {
      throw new BadRequestException(
        'Please activate your current subscription first',
      );
    }

    const tierOrder = { BRONZE: 1, SILVER: 2, GOLD: 3 };
    if (tierOrder[newTier] <= tierOrder[existing.tier]) {
      throw new BadRequestException('Can only upgrade to a higher tier');
    }

    // Check if member has made any claims
    const hasActiveClaims = await this.hasActiveClaims(memberId);

    if (hasActiveClaims) {
      // Member has made claims - must exhaust current package first
      throw new BadRequestException(
        'You have active claims on your current package. Please exhaust your current package before upgrading. You will need to pay the full amount for the new tier.',
      );
    }

    // No claims made - calculate difference amount
    const currentPrice = this.getPrice(
      existing.tier,
      existing.paymentFrequency === 'ANNUAL' ? 'annual' : 'monthly',
    );
    const newPrice = this.getPrice(
      newTier,
      existing.paymentFrequency === 'ANNUAL' ? 'annual' : 'monthly',
    );
    const upgradeCost = newPrice - currentPrice;

    const currentDisplayPrice = this.getDisplayPrice(
      existing.tier,
      existing.paymentFrequency === 'ANNUAL' ? 'annual' : 'monthly',
    );
    const newDisplayPrice = this.getDisplayPrice(
      newTier,
      existing.paymentFrequency === 'ANNUAL' ? 'annual' : 'monthly',
    );
    const displayUpgradeCost = newDisplayPrice - currentDisplayPrice;

    return {
      currentTier: existing.tier,
      newTier,
      paymentRequired: true,
      paymentAmount: upgradeCost,
      displayAmount: displayUpgradeCost,
      message: `Pay the difference of KES ${displayUpgradeCost} to upgrade from ${existing.tier} to ${newTier}`,
    };
  }

  /**
   * Check if member has any active claims (approved or disbursed)
   */
  async hasActiveClaims(memberId: string): Promise<boolean> {
    const claimCount = await this.prisma.claim.count({
      where: {
        memberId,
        status: {
          in: ['APPROVED', 'DISBURSED'],
        },
      },
    });

    return claimCount > 0;
  }

  /**
   * Complete upgrade after payment
   */
  async completeUpgrade(memberId: string, newTier: PackageTier): Promise<void> {
    const existing = await this.prisma.subscription.findUnique({
      where: { memberId },
    });

    if (!existing) {
      throw new NotFoundException('No existing subscription found');
    }

    const newAnnualCap = ANNUAL_CAPS[newTier];

    // Update subscription with new tier and claim limits
    await this.prisma.subscription.update({
      where: { memberId },
      data: {
        tier: newTier,
        monthlyAmount: this.getDisplayPrice(newTier),
        annualCapLimit: newAnnualCap,
      },
    });

    this.logger.log(
      `Subscription upgraded for ${memberId}: ${existing.tier} -> ${newTier}, new cap: ${newAnnualCap}`,
    );

    // Mint new NFT for upgraded tier
    try {
      await this.blockchainService.mintMembershipNFT(memberId, newTier);
      this.logger.log(`Upgrade NFT minted for member ${memberId} - ${newTier}`);
    } catch (error) {
      this.logger.error('Failed to mint upgrade NFT:', error);
    }
  }

  async getSubscription(memberId: string) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { memberId },
    });

    if (!subscription) {
      return null;
    }

    return {
      ...subscription,
      benefits: PACKAGE_BENEFITS[subscription.tier],
    };
  }

  /**
   * Deactivate all subscriptions without completed payments
   * Admin utility function
   */
  async deactivateUnpaidSubscriptions() {
    // Get all active subscriptions
    const activeSubscriptions = await this.prisma.subscription.findMany({
      where: { isActive: true },
      include: {
        member: {
          include: {
            contributions: {
              where: { status: 'COMPLETED' },
              orderBy: { createdAt: 'desc' },
              take: 1,
            },
          },
        },
      },
    });

    this.logger.log(`Found ${activeSubscriptions.length} active subscriptions`);

    let deactivatedCount = 0;
    const deactivatedMembers: string[] = [];

    for (const subscription of activeSubscriptions) {
      const hasCompletedPayment = subscription.member.contributions.length > 0;

      if (!hasCompletedPayment) {
        // Deactivate subscription without completed payment
        await this.prisma.subscription.update({
          where: { id: subscription.id },
          data: { isActive: false },
        });
        deactivatedCount++;
        deactivatedMembers.push(subscription.member.phoneNumber);
        this.logger.log(
          `Deactivated subscription for ${subscription.member.phoneNumber}`,
        );
      }
    }

    return {
      totalActive: activeSubscriptions.length,
      deactivatedCount,
      deactivatedMembers,
      keptActiveCount: activeSubscriptions.length - deactivatedCount,
    };
  }

  /**
   * [DEV ONLY] Mock a successful payment and activate subscription
   * Bypasses real payment provider for testing purposes
   */
  async mockPaymentAndActivate(memberId: string, tier: PackageTier) {
    // Safety check - only allow in development environment
    if (!this.isDevEnvironment) {
      throw new BadRequestException(
        'Mock payment is only available in development environment',
      );
    }

    this.logger.warn(
      `[DEV] Mock payment initiated for member ${memberId}, tier ${tier}`,
    );

    // Create or update subscription
    let subscription = await this.prisma.subscription.findUnique({
      where: { memberId },
    });

    if (subscription?.isActive) {
      throw new BadRequestException(
        'Member already has an active subscription',
      );
    }

    if (subscription) {
      subscription = await this.prisma.subscription.update({
        where: { memberId },
        data: {
          tier,
          monthlyAmount: this.getDisplayPrice(tier),
          isActive: false,
        },
      });
    } else {
      subscription = await this.prisma.subscription.create({
        data: {
          memberId,
          tier,
          monthlyAmount: this.getDisplayPrice(tier),
          isActive: false,
        },
      });
    }

    // Create mock contribution with COMPLETED status
    const mockPaymentRef = `DEV_MOCK_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    await this.prisma.contribution.create({
      data: {
        memberId,
        amount: this.getDisplayPrice(tier),
        month: new Date(),
        paymentMethod: 'DEV_MOCK',
        status: 'COMPLETED',
        paymentRef: mockPaymentRef,
      },
    });

    // Activate subscription (this also mints NFT)
    await this.activateSubscription(memberId);

    // Verify activation status
    const updatedSubscription = await this.prisma.subscription.findUnique({
      where: { memberId },
    });

    if (!updatedSubscription?.isActive) {
      this.logger.error(
        `[DEV] Check active status failed for member ${memberId}`,
      );
      throw new Error('Subscription activation failed to persist');
    }

    this.logger.warn(
      `[DEV] Mock payment completed for member ${memberId}, subscription activated: ${updatedSubscription.isActive}`,
    );

    return {
      success: true,
      subscription: updatedSubscription,
      mockPaymentRef,
      message: '[DEV] Subscription activated via mock payment',
    };
  }

  /**
   * Remove a subscription for a member
   * Admin-only functionality
   */
  async removeSubscription(memberId: string) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { memberId },
    });

    if (!subscription) {
      throw new NotFoundException('No subscription found for member');
    }

    await this.prisma.subscription.delete({
      where: { memberId },
    });

    this.logger.log(`Subscription for member ${memberId} removed by admin`);

    return {
      success: true,
      message: 'Subscription removed successfully',
    };
  }

  /**
   * Check waiting period for a member and procedure
   * Requirements: 15.1, 15.2, 15.3, 16.1, 16.2, 17.1-17.6
   */
  async checkWaitingPeriod(
    memberId: string,
    procedureCode: string,
  ): Promise<{
    passed: boolean;
    daysRemaining: number;
    requiredDays: number;
    procedureType: 'EMERGENCY' | 'RESTORATIVE';
  }> {
    const subscription = await this.prisma.subscription.findUnique({
      where: { memberId },
    });

    if (!subscription) {
      throw new NotFoundException('No subscription found for member');
    }

    if (!subscription.isActive) {
      throw new BadRequestException('Subscription is not active');
    }

    // Determine procedure type
    const emergencyProcedures = ['CONSULT', 'EXTRACT_SIMPLE'];
    const procedureType = emergencyProcedures.includes(procedureCode)
      ? 'EMERGENCY'
      : 'RESTORATIVE';

    // Calculate required waiting days
    const requiredDays = this.calculateRequiredWaitingDays(
      subscription.paymentFrequency,
      procedureType,
    );

    // Calculate days since subscription start
    const startDate =
      subscription.subscriptionStartDate || subscription.startDate;
    const daysSinceStart = Math.floor(
      (Date.now() - startDate.getTime()) / (1000 * 60 * 60 * 24),
    );

    const passed = daysSinceStart >= requiredDays;
    const daysRemaining = Math.max(0, requiredDays - daysSinceStart);

    this.logger.log(
      `Waiting period check for ${memberId}: ${procedureCode} (${procedureType}) - ` +
        `${daysSinceStart}/${requiredDays} days, passed: ${passed}`,
    );

    return {
      passed,
      daysRemaining,
      requiredDays,
      procedureType,
    };
  }

  /**
   * Calculate required waiting days based on payment frequency and procedure type
   * Requirements: 15.1, 15.2, 15.3, 16.1, 16.2
   */
  private calculateRequiredWaitingDays(
    paymentFrequency: string,
    procedureType: string,
  ): number {
    if (paymentFrequency === 'ANNUAL') {
      // Annual subscribers: 14 days for all procedures
      return 14;
    }

    // Monthly subscribers
    if (procedureType === 'EMERGENCY') {
      // Consultations and extractions: 60 days
      return 60;
    } else {
      // Restorative procedures: 90 days
      return 90;
    }
  }

  /**
   * Check if claim amount is within limit
   * Requirements: 12.5, 12.6, 14.1, 14.2, 14.3
   */
  async checkClaimLimit(
    memberId: string,
    claimAmount: number,
  ): Promise<{
    withinLimit: boolean;
    currentUsed: number;
    limit: number;
    remainingLimit: number;
    wouldExceed: boolean;
  }> {
    const subscription = await this.prisma.subscription.findUnique({
      where: { memberId },
    });

    if (!subscription) {
      throw new NotFoundException('No subscription found for member');
    }

    const currentUsed = subscription.annualCapUsed;
    const limit = subscription.annualCapLimit;
    const total = currentUsed + claimAmount;
    const withinLimit = total <= limit;
    const remainingLimit = Math.max(0, limit - currentUsed);
    const wouldExceed = claimAmount > remainingLimit;

    this.logger.log(
      `Claim limit check for ${memberId}: ${claimAmount} KES, ` +
        `used: ${currentUsed}/${limit}, remaining: ${remainingLimit}, ` +
        `within limit: ${withinLimit}`,
    );

    return {
      withinLimit,
      currentUsed,
      limit,
      remainingLimit,
      wouldExceed,
    };
  }

  /**
   * Increment claim usage for a member
   */
  async incrementClaimUsage(memberId: string, amount: number): Promise<void> {
    const subscription = await this.prisma.subscription.findUnique({
      where: { memberId },
    });

    if (!subscription) {
      throw new NotFoundException('No subscription found for member');
    }

    const newUsed = subscription.annualCapUsed + amount;

    await this.prisma.subscription.update({
      where: { memberId },
      data: {
        annualCapUsed: newUsed,
      },
    });

    this.logger.log(
      `Incremented claim usage for ${memberId}: ${subscription.annualCapUsed} -> ${newUsed}`,
    );
  }

  /**
   * Get waiting period status for member dashboard
   * Requirements: 2.7, 18.1, 18.2, 18.3
   */
  async getWaitingPeriodStatus(memberId: string): Promise<{
    consultationsExtractions: {
      available: boolean;
      daysRemaining: number;
      requiredDays: number;
    };
    restorativeProcedures: {
      available: boolean;
      daysRemaining: number;
      requiredDays: number;
    };
  }> {
    const subscription = await this.prisma.subscription.findUnique({
      where: { memberId },
    });

    if (!subscription) {
      throw new NotFoundException('No subscription found for member');
    }

    const startDate =
      subscription.subscriptionStartDate || subscription.startDate;
    const daysSinceStart = Math.floor(
      (Date.now() - startDate.getTime()) / (1000 * 60 * 60 * 24),
    );

    // Calculate for emergency procedures (consultations/extractions)
    const emergencyRequired = this.calculateRequiredWaitingDays(
      subscription.paymentFrequency,
      'EMERGENCY',
    );
    const emergencyAvailable = daysSinceStart >= emergencyRequired;
    const emergencyRemaining = Math.max(0, emergencyRequired - daysSinceStart);

    // Calculate for restorative procedures
    const restorativeRequired = this.calculateRequiredWaitingDays(
      subscription.paymentFrequency,
      'RESTORATIVE',
    );
    const restorativeAvailable = daysSinceStart >= restorativeRequired;
    const restorativeRemaining = Math.max(
      0,
      restorativeRequired - daysSinceStart,
    );

    return {
      consultationsExtractions: {
        available: emergencyAvailable,
        daysRemaining: emergencyRemaining,
        requiredDays: emergencyRequired,
      },
      restorativeProcedures: {
        available: restorativeAvailable,
        daysRemaining: restorativeRemaining,
        requiredDays: restorativeRequired,
      },
    };
  }
}
