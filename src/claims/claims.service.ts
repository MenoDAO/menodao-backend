import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { BlockchainService } from '../blockchain/blockchain.service';
import {
  SasaPayService,
  SasaPayB2CCallbackData,
} from '../sasapay/sasapay.service';
import { ClaimType, ClaimStatus } from '@prisma/client';
import * as crypto from 'crypto';

// Claim limits by tier (per year)
const CLAIM_LIMITS = {
  BRONZE: { maxClaims: 2, maxAmount: 5000 },
  SILVER: { maxClaims: 4, maxAmount: 15000 },
  GOLD: { maxClaims: 8, maxAmount: 50000 },
};

@Injectable()
export class ClaimsService {
  private readonly logger = new Logger(ClaimsService.name);
  private readonly isDevEnvironment: boolean;

  constructor(
    private prisma: PrismaService,
    private blockchainService: BlockchainService,
    private sasaPayService: SasaPayService,
    private configService: ConfigService,
  ) {
    this.isDevEnvironment =
      this.configService.get('NODE_ENV') === 'development';
  }

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
   * Approve a pending claim — validates limits, updates status, then triggers disbursal
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

    // Trigger disbursal automatically
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
   * Process disbursal via SasaPay B2C API
   * Falls back to mock disbursal in dev environment if SasaPay is not configured
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

    // Generate unique disbursal reference
    const disbursalRef = `menodao_claim_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;

    // Update status to processing
    await this.prisma.claim.update({
      where: { id: claimId },
      data: {
        status: ClaimStatus.PROCESSING,
        txHash: disbursalRef, // Store ref temporarily as txHash
      },
    });

    // Use mock disbursal if SasaPay is not configured (dev environment)
    if (!this.sasaPayService.isConfigured()) {
      if (this.isDevEnvironment) {
        this.logger.warn(
          `[DEV] SasaPay not configured — using mock disbursal for claim ${claimId}`,
        );
        return this.mockDisbursement(claimId, disbursalRef);
      } else {
        this.logger.error(
          'SasaPay not configured — cannot process disbursal in production',
        );
        throw new BadRequestException(
          'Payment service not configured. Please contact support.',
        );
      }
    }

    // Initiate SasaPay B2C disbursal
    try {
      const memberPhone = claim.member.phoneNumber;
      if (!memberPhone) {
        throw new BadRequestException(
          'Member phone number is required for disbursal',
        );
      }

      this.logger.log(
        `Initiating SasaPay B2C disbursal: claim=${claimId}, amount=${claim.amount}, phone=${memberPhone}, ref=${disbursalRef}`,
      );

      const response = await this.sasaPayService.sendMoney(
        memberPhone,
        claim.amount,
        disbursalRef,
        `MenoDAO Claim Disbursal - ${claim.claimType}`,
      );

      if (response.status) {
        // Store SasaPay response IDs in metadata for callback matching
        await this.prisma.claim.update({
          where: { id: claimId },
          data: {
            txHash: disbursalRef,
          },
        });

        this.logger.log(
          `B2C disbursal initiated for claim ${claimId}: MerchantRequestID=${response.MerchantRequestID}`,
        );

        return {
          success: true,
          claimId,
          disbursalRef,
          merchantRequestId: response.MerchantRequestID,
          message: 'Disbursal initiated — will be confirmed via callback',
        };
      } else {
        // Revert to approved status on failure
        await this.prisma.claim.update({
          where: { id: claimId },
          data: {
            status: ClaimStatus.APPROVED,
            txHash: null,
          },
        });

        this.logger.error(
          `B2C disbursal failed for claim ${claimId}: ${response.detail}`,
        );
        throw new BadRequestException(`Disbursal failed: ${response.detail}`);
      }
    } catch (error) {
      if (error instanceof BadRequestException) throw error;

      // Revert to approved on unexpected error
      await this.prisma.claim.update({
        where: { id: claimId },
        data: {
          status: ClaimStatus.APPROVED,
          txHash: null,
        },
      });

      const errMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(`B2C disbursal error for claim ${claimId}: ${errMsg}`);
      throw new BadRequestException(
        'Disbursal failed. Please try again later.',
      );
    }
  }

  /**
   * Handle B2C disbursal callback from SasaPay
   * On success: marks claim as DISBURSED
   */
  async handleDisbursalCallback(
    data: SasaPayB2CCallbackData,
  ): Promise<{ success: boolean; message: string }> {
    try {
      this.logger.log(
        `Processing B2C disbursal callback: ${JSON.stringify(data)}`,
      );

      const { ResultCode, ResultDesc, MpesaReceiptNumber, Amount } = data;

      // Find the processing claim by txHash (disbursal reference)
      const claim = await this.findClaimByCallback();

      if (!claim) {
        this.logger.warn(
          `No processing claim found for B2C callback: ${JSON.stringify(data)}`,
        );
        return { success: false, message: 'Claim not found' };
      }

      // SasaPay: ResultCode '0' means success
      const isSuccess = ResultCode === '0';

      if (isSuccess) {
        // Mark claim as disbursed
        await this.prisma.claim.update({
          where: { id: claim.id },
          data: {
            status: ClaimStatus.DISBURSED,
            txHash: MpesaReceiptNumber || claim.txHash,
            processedAt: new Date(),
          },
        });

        this.logger.log(
          `Claim ${claim.id} disbursed successfully. M-Pesa receipt: ${MpesaReceiptNumber}, amount: ${Amount}`,
        );

        return {
          success: true,
          message: 'Disbursal confirmed successfully',
        };
      } else {
        // Revert claim to approved on disbursal failure
        await this.prisma.claim.update({
          where: { id: claim.id },
          data: {
            status: ClaimStatus.APPROVED,
            txHash: null,
          },
        });

        this.logger.warn(
          `Disbursal failed for claim ${claim.id}: ${ResultDesc}`,
        );

        return {
          success: true,
          message: `Disbursal failure recorded: ${ResultDesc}`,
        };
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Disbursal callback error: ${errMsg}`);
      return {
        success: false,
        message: 'Disbursal callback processing failed',
      };
    }
  }

  /**
   * Find claim by B2C callback data
   */
  private async findClaimByCallback() {
    // Find claim in PROCESSING status (most recent)
    const claim = await this.prisma.claim.findFirst({
      where: {
        status: ClaimStatus.PROCESSING,
        txHash: { startsWith: 'menodao_claim_' },
      },
      orderBy: { updatedAt: 'desc' },
      include: { member: true },
    });

    return claim;
  }

  /**
   * [DEV ONLY] Mock disbursal for testing
   */
  private async mockDisbursement(claimId: string, disbursalRef: string) {
    const mockTxHash = `MOCK_DISBURSEMENT_${Date.now()}_${claimId.slice(-6)}`;

    await this.prisma.claim.update({
      where: { id: claimId },
      data: {
        status: ClaimStatus.DISBURSED,
        txHash: mockTxHash,
        processedAt: new Date(),
      },
    });

    this.logger.warn(`[DEV] Mock disbursal completed: ${mockTxHash}`);

    return {
      success: true,
      claimId,
      disbursalRef,
      txHash: mockTxHash,
      message: '[DEV] Mock disbursal completed',
    };
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
