import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BlockchainService } from '../blockchain/blockchain.service';
import { PackageTier } from '@prisma/client';

// Package pricing in KES
const PACKAGE_PRICES: Record<PackageTier, number> = {
  BRONZE: 300,
  SILVER: 500,
  GOLD: 700,
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
  constructor(
    private prisma: PrismaService,
    private blockchainService: BlockchainService,
  ) {}

  getPackages() {
    return Object.entries(PACKAGE_PRICES).map(([tier, price]) => ({
      tier,
      monthlyPrice: price,
      benefits: PACKAGE_BENEFITS[tier as PackageTier],
    }));
  }

  async subscribe(memberId: string, tier: PackageTier) {
    // Check if member already has subscription
    const existing = await this.prisma.subscription.findUnique({
      where: { memberId },
    });

    if (existing) {
      throw new BadRequestException('Member already has a subscription. Use upgrade instead.');
    }

    // Create subscription
    const subscription = await this.prisma.subscription.create({
      data: {
        memberId,
        tier,
        monthlyAmount: PACKAGE_PRICES[tier],
      },
    });

    // Mint NFT for the member
    try {
      await this.blockchainService.mintMembershipNFT(memberId, tier);
    } catch (error) {
      console.error('Failed to mint NFT:', error);
      // Continue - NFT minting is non-blocking
    }

    return subscription;
  }

  async upgrade(memberId: string, newTier: PackageTier) {
    const existing = await this.prisma.subscription.findUnique({
      where: { memberId },
    });

    if (!existing) {
      throw new NotFoundException('No existing subscription found');
    }

    const tierOrder = { BRONZE: 1, SILVER: 2, GOLD: 3 };
    if (tierOrder[newTier] <= tierOrder[existing.tier]) {
      throw new BadRequestException('Can only upgrade to a higher tier');
    }

    // Update subscription
    const subscription = await this.prisma.subscription.update({
      where: { memberId },
      data: {
        tier: newTier,
        monthlyAmount: PACKAGE_PRICES[newTier],
      },
    });

    // Mint new NFT for upgraded tier
    try {
      await this.blockchainService.mintMembershipNFT(memberId, newTier);
    } catch (error) {
      console.error('Failed to mint upgrade NFT:', error);
    }

    return subscription;
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
}
