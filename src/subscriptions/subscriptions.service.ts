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

// Package pricing in KES (production)
const PACKAGE_PRICES: Record<PackageTier, number> = {
  BRONZE: 350,
  SILVER: 550,
  GOLD: 700,
};

// Dev environment pricing (for testing)
const DEV_PACKAGE_PRICES: Record<PackageTier, number> = {
  BRONZE: 3,
  SILVER: 5,
  GOLD: 7,
};

// Package benefits
const PACKAGE_BENEFITS: Record<PackageTier, string[]> = {
  BRONZE: [
    'Annual dental checkup',
    'Basic cleaning',
    'Access to dental camps',
    'Member NFT badge',
  ],
  SILVER: [
    'Bi-annual dental checkups',
    'Professional cleaning',
    'One filling per year',
    'Access to dental camps',
    'Priority booking',
    'Silver NFT badge',
  ],
  GOLD: [
    'Quarterly dental checkups',
    'Professional cleaning',
    'Two fillings per year',
    'One extraction per year',
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
   * Get the appropriate price for a tier based on environment
   */
  private getPrice(tier: PackageTier): number {
    return this.isDevEnvironment
      ? DEV_PACKAGE_PRICES[tier]
      : PACKAGE_PRICES[tier];
  }

  /**
   * Get the display price (always show production prices to users)
   */
  private getDisplayPrice(tier: PackageTier): number {
    return PACKAGE_PRICES[tier];
  }

  getPackages() {
    return Object.entries(PACKAGE_PRICES).map(([tier, price]) => ({
      tier,
      monthlyPrice: price,
      // In dev, show actual charge amount for testing
      actualCharge: this.isDevEnvironment
        ? DEV_PACKAGE_PRICES[tier as PackageTier]
        : price,
      benefits: PACKAGE_BENEFITS[tier as PackageTier],
      isDevPricing: this.isDevEnvironment,
    }));
  }

  /**
   * Create a pending subscription (awaiting payment)
   * The subscription becomes active only after payment is confirmed
   */
  async subscribe(memberId: string, tier: PackageTier) {
    // Check if member already has subscription
    const existing = await this.prisma.subscription.findUnique({
      where: { memberId },
    });

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
          monthlyAmount: this.getDisplayPrice(tier),
          isActive: false,
        },
      });

      return {
        subscription,
        paymentRequired: true,
        paymentAmount: this.getPrice(tier),
        displayAmount: this.getDisplayPrice(tier),
        message: 'Please complete payment to activate your subscription',
      };
    }

    // Create subscription (inactive until payment)
    const subscription = await this.prisma.subscription.create({
      data: {
        memberId,
        tier,
        monthlyAmount: this.getDisplayPrice(tier),
        isActive: false, // Will be activated after payment
      },
    });

    return {
      subscription,
      paymentRequired: true,
      paymentAmount: this.getPrice(tier),
      displayAmount: this.getDisplayPrice(tier),
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

    // Calculate upgrade cost (difference between tiers)
    const currentPrice = this.getPrice(existing.tier);
    const newPrice = this.getPrice(newTier);
    const upgradeCost = newPrice - currentPrice;

    return {
      currentTier: existing.tier,
      newTier,
      paymentRequired: true,
      paymentAmount: upgradeCost,
      displayAmount:
        this.getDisplayPrice(newTier) - this.getDisplayPrice(existing.tier),
      message: 'Please complete payment to upgrade your subscription',
    };
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

    // Update subscription
    await this.prisma.subscription.update({
      where: { memberId },
      data: {
        tier: newTier,
        monthlyAmount: this.getDisplayPrice(newTier),
      },
    });

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
}
