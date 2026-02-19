import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
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
      throw new BadRequestException(
        'Active subscription required to make claims',
      );
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
      throw new BadRequestException(
        `You have reached your annual claim limit of ${limits.maxClaims} claims`,
      );
    }

    if (totalClaimed + amount > limits.maxAmount) {
      throw new BadRequestException(
        `This claim would exceed your annual limit of KES ${limits.maxAmount}`,
      );
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

  /**
   * Approve a pending claim — validates limits, updates status, then triggers mock disbursal
   */
  async approveClaim(claimId: string) {
    const claim = await this.prisma.claim.findUnique({
      where: { id: claimId },
      include: { member: { include: { subscription: true } } },
    });

    if (!claim) {
      throw new NotFoundException('Claim not found');
    }

    if (claim.status !== ClaimStatus.PENDING) {
      throw new BadRequestException(
        `Claim is already ${claim.status.toLowerCase()} and cannot be approved`,
      );
    }

    // Re-validate claim limits to prevent race conditions
    const subscription = claim.member?.subscription;
    if (subscription) {
      const yearStart = new Date(new Date().getFullYear(), 0, 1);
      const existingApproved = await this.prisma.claim.findMany({
        where: {
          memberId: claim.memberId,
          createdAt: { gte: yearStart },
          status: { in: [ClaimStatus.APPROVED, ClaimStatus.DISBURSED] },
        },
      });

      const limits = CLAIM_LIMITS[subscription.tier];
      const totalClaimed = existingApproved.reduce(
        (sum, c) => sum + c.amount,
        0,
      );

      if (existingApproved.length >= limits.maxClaims) {
        throw new BadRequestException(
          `Member has reached their annual claim limit of ${limits.maxClaims} claims`,
        );
      }

      if (totalClaimed + claim.amount > limits.maxAmount) {
        throw new BadRequestException(
          `Approving this claim would exceed the member's annual limit of KES ${limits.maxAmount}`,
        );
      }
    }

    // Mark as approved
    const approved = await this.prisma.claim.update({
      where: { id: claimId },
      data: { status: ClaimStatus.APPROVED },
      include: { member: true },
    });

    // Trigger mock disbursal automatically
    await this.processDisbursement(claimId);

    return approved;
  }

  /**
   * Reject a pending claim with a reason
   */
  async rejectClaim(claimId: string, reason: string) {
    const claim = await this.prisma.claim.findUnique({
      where: { id: claimId },
    });

    if (!claim) {
      throw new NotFoundException('Claim not found');
    }

    if (claim.status !== ClaimStatus.PENDING) {
      throw new BadRequestException(
        `Claim is already ${claim.status.toLowerCase()} and cannot be rejected`,
      );
    }

    if (!reason || reason.trim().length === 0) {
      throw new BadRequestException('A rejection reason is required');
    }

    return this.prisma.claim.update({
      where: { id: claimId },
      data: {
        status: ClaimStatus.REJECTED,
        rejectionReason: reason.trim(),
        processedAt: new Date(),
      },
      include: { member: true },
    });
  }

  /**
   * Process mock disbursal — placeholder for real fiat payment integration
   */
  async processDisbursement(claimId: string) {
    const claim = await this.prisma.claim.findUnique({
      where: { id: claimId },
      include: { member: true },
    });

    if (!claim) {
      throw new NotFoundException('Claim not found');
    }

    if (
      claim.status !== ClaimStatus.APPROVED &&
      claim.status !== ClaimStatus.PROCESSING
    ) {
      throw new BadRequestException(
        'Claim must be approved before disbursement',
      );
    }

    // Update status to processing
    await this.prisma.claim.update({
      where: { id: claimId },
      data: { status: ClaimStatus.PROCESSING },
    });

    // --- MOCK DISBURSAL ---
    // TODO: Replace with actual fiat payment API (M-Pesa B2C, bank transfer, etc.)
    // For now, simulate a successful payment with a mock transaction hash
    const mockTxHash = `MOCK_DISBURSEMENT_${Date.now()}_${claimId.slice(-6)}`;

    // Update claim as disbursed
    return this.prisma.claim.update({
      where: { id: claimId },
      data: {
        status: ClaimStatus.DISBURSED,
        txHash: mockTxHash,
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
      (c) =>
        c.createdAt >= yearStart &&
        (c.status === ClaimStatus.APPROVED ||
          c.status === ClaimStatus.DISBURSED),
    );

    const limits = subscription ? CLAIM_LIMITS[subscription.tier] : null;
    const totalClaimed = approvedClaims.reduce((sum, c) => sum + c.amount, 0);

    return {
      claims,
      summary: limits
        ? {
            claimsUsed: approvedClaims.length,
            claimsRemaining: limits.maxClaims - approvedClaims.length,
            amountClaimed: totalClaimed,
            amountRemaining: limits.maxAmount - totalClaimed,
          }
        : null,
    };
  }

  async getAllClaims(filters: { status?: ClaimStatus; memberId?: string }) {
    return this.prisma.claim.findMany({
      where: {
        status: filters.status,
        memberId: filters.memberId,
      },
      include: {
        member: true,
        camp: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getClaimById(id: string) {
    const claim = await this.prisma.claim.findUnique({
      where: { id },
      include: {
        member: true,
        camp: true,
      },
    });

    if (!claim) {
      throw new NotFoundException('Claim not found');
    }

    return claim;
  }
}
