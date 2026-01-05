import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BlockchainService } from '../blockchain/blockchain.service';
import { ClaimType, ClaimStatus } from '@prisma/client';

// Claim limits by tier (per year)
const CLAIM_LIMITS = {
  BRONZE: { maxClaims: 2, maxAmount: 5000 },
  SILVER: { maxClaims: 4, maxAmount: 15000 },
  GOLD: { maxClaims: 8, maxAmount: 50000 },
};

@Injectable()
export class ClaimsService {
  constructor(
    private prisma: PrismaService,
    private blockchainService: BlockchainService,
  ) {}

  async createClaim(
    memberId: string,
    claimType: ClaimType,
    description: string,
    amount: number,
    campId?: string,
  ) {
    // Verify member has active subscription
    const subscription = await this.prisma.subscription.findUnique({
      where: { memberId },
    });

    if (!subscription || !subscription.isActive) {
      throw new BadRequestException('Active subscription required to make claims');
    }

    // Check claim limits
    const yearStart = new Date(new Date().getFullYear(), 0, 1);
    const existingClaims = await this.prisma.claim.findMany({
      where: {
        memberId,
        createdAt: { gte: yearStart },
        status: { in: [ClaimStatus.APPROVED, ClaimStatus.DISBURSED] },
      },
    });

    const limits = CLAIM_LIMITS[subscription.tier];
    const totalClaimed = existingClaims.reduce((sum, c) => sum + c.amount, 0);

    if (existingClaims.length >= limits.maxClaims) {
      throw new BadRequestException(`You have reached your annual claim limit of ${limits.maxClaims} claims`);
    }

    if (totalClaimed + amount > limits.maxAmount) {
      throw new BadRequestException(`This claim would exceed your annual limit of KES ${limits.maxAmount}`);
    }

    // Create claim
    const claim = await this.prisma.claim.create({
      data: {
        memberId,
        claimType,
        description,
        amount,
        campId,
        status: ClaimStatus.PENDING,
      },
    });

    return claim;
  }

  async approveClaim(claimId: string) {
    const claim = await this.prisma.claim.findUnique({
      where: { id: claimId },
    });

    if (!claim) {
      throw new NotFoundException('Claim not found');
    }

    return this.prisma.claim.update({
      where: { id: claimId },
      data: { status: ClaimStatus.APPROVED },
    });
  }

  async processDisbursement(claimId: string) {
    const claim = await this.prisma.claim.findUnique({
      where: { id: claimId },
      include: { member: true },
    });

    if (!claim) {
      throw new NotFoundException('Claim not found');
    }

    if (claim.status !== ClaimStatus.APPROVED) {
      throw new BadRequestException('Claim must be approved before disbursement');
    }

    // Update status to processing
    await this.prisma.claim.update({
      where: { id: claimId },
      data: { status: ClaimStatus.PROCESSING },
    });

    // Process on-chain disbursement
    let txHash: string | null = null;
    try {
      txHash = await this.blockchainService.processDisbursement(
        claim.memberId,
        claim.amount,
        claimId,
      );
    } catch (error) {
      console.error('Blockchain disbursement failed:', error);
      throw new BadRequestException('Disbursement processing failed');
    }

    // Update claim as disbursed
    return this.prisma.claim.update({
      where: { id: claimId },
      data: {
        status: ClaimStatus.DISBURSED,
        txHash,
        processedAt: new Date(),
      },
    });
  }

  async getMemberClaims(memberId: string) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { memberId },
    });

    const yearStart = new Date(new Date().getFullYear(), 0, 1);
    const claims = await this.prisma.claim.findMany({
      where: { memberId },
      orderBy: { createdAt: 'desc' },
      include: { camp: true },
    });

    const approvedClaims = claims.filter(
      (c) => c.createdAt >= yearStart && 
      (c.status === ClaimStatus.APPROVED || c.status === ClaimStatus.DISBURSED)
    );

    const limits = subscription ? CLAIM_LIMITS[subscription.tier] : null;
    const totalClaimed = approvedClaims.reduce((sum, c) => sum + c.amount, 0);

    return {
      claims,
      summary: limits ? {
        claimsUsed: approvedClaims.length,
        claimsRemaining: limits.maxClaims - approvedClaims.length,
        amountClaimed: totalClaimed,
        amountRemaining: limits.maxAmount - totalClaimed,
      } : null,
    };
  }
}
