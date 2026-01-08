import { Injectable, BadRequestException, NotFoundException, Logger, forwardRef, Inject } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BlockchainService } from '../blockchain/blockchain.service';
import { PaymentService, PaymentCallbackData } from '../payments/payment.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { PaymentStatus } from '@prisma/client';

@Injectable()
export class ContributionsService {
  private readonly logger = new Logger(ContributionsService.name);

  constructor(
    private prisma: PrismaService,
    private blockchainService: BlockchainService,
    private paymentService: PaymentService,
    @Inject(forwardRef(() => SubscriptionsService))
    private subscriptionsService: SubscriptionsService,
  ) {}

  /**
   * Initiate a contribution payment via M-Pesa STK Push
   */
  async initiatePayment(memberId: string, amount: number, paymentMethod: string, phoneNumber?: string) {
    // Verify member exists and has subscription
    const member = await this.prisma.member.findUnique({
      where: { id: memberId },
      include: { subscription: true },
    });

    if (!member) {
      throw new BadRequestException('Member not found');
    }

    if (!member.subscription) {
      throw new BadRequestException('Please subscribe to a package first');
    }

    // Use member's phone if not provided
    const paymentPhone = phoneNumber || member.phoneNumber;
    if (!paymentPhone) {
      throw new BadRequestException('Phone number is required for M-Pesa payment');
    }

    // Get the actual charge amount from subscriptions service (uses dev pricing in dev environment)
    const packages = this.subscriptionsService.getPackages();
    const memberPackage = packages.find(p => p.tier === member.subscription?.tier);
    
    // Use the actual charge amount (dev pricing) instead of the frontend amount
    const actualAmount = memberPackage?.actualCharge ?? amount;
    
    this.logger.log(`Payment for ${member.subscription.tier}: display=${amount}, actual=${actualAmount}`);

    // Validate amount (use minimum 1 for dev environment)
    if (actualAmount < 1) {
      throw new BadRequestException('Minimum contribution is KES 1');
    }

    if (actualAmount > 100000) {
      throw new BadRequestException('Maximum contribution is KES 100,000');
    }

    // Create contribution record (store original amount for display)
    const contribution = await this.prisma.contribution.create({
      data: {
        memberId,
        amount, // Store display amount
        month: new Date(),
        paymentMethod: 'MPESA',
        status: PaymentStatus.PENDING,
      },
    });

    // Initiate M-Pesa STK Push with actual charge amount
    const paymentResult = await this.paymentService.initiateSTKPush(
      memberId,
      paymentPhone,
      actualAmount, // Use actual (dev) amount for payment
      contribution.id,
      `MenoDAO ${member.subscription.tier} Contribution`,
    );

    if (!paymentResult.success) {
      // Update contribution to failed if STK push fails
      await this.prisma.contribution.update({
        where: { id: contribution.id },
        data: { status: PaymentStatus.FAILED },
      });

      throw new BadRequestException(paymentResult.error || 'Payment initiation failed');
    }

    this.logger.log(`Payment initiated for member ${memberId}, contribution ${contribution.id}`);

    return {
      contributionId: contribution.id,
      amount,
      paymentMethod: 'MPESA',
      status: 'PENDING',
      reference: paymentResult.reference,
      checkoutRequestId: paymentResult.checkoutRequestId,
      message: 'Please check your phone and enter M-Pesa PIN to complete payment',
    };
  }

  /**
   * Confirm payment after callback from payment provider
   */
  async confirmPayment(contributionId: string, paymentRef: string) {
    const contribution = await this.prisma.contribution.findUnique({
      where: { id: contributionId },
      include: { member: true },
    });

    if (!contribution) {
      throw new NotFoundException('Contribution not found');
    }

    // Record on blockchain
    let txHash: string | null = null;
    try {
      txHash = await this.blockchainService.recordContribution(
        contribution.memberId,
        contribution.amount,
      );
    } catch (error) {
      console.error('Blockchain recording failed:', error);
    }

    // Update contribution
    const updated = await this.prisma.contribution.update({
      where: { id: contributionId },
      data: {
        status: PaymentStatus.COMPLETED,
        paymentRef,
        txHash,
      },
    });

    return updated;
  }

  /**
   * Get contribution summary for a member
   */
  async getSummary(memberId: string) {
    const contributions = await this.prisma.contribution.findMany({
      where: { memberId, status: PaymentStatus.COMPLETED },
    });

    const totalContributed = contributions.reduce((sum, c) => sum + c.amount, 0);
    const monthsContributed = contributions.length;

    return {
      totalContributed,
      monthsContributed,
      recentContributions: contributions.slice(0, 5),
    };
  }

  /**
   * Validate payment request (called before payment is processed)
   */
  async validatePayment(payload: PaymentCallbackData) {
    this.logger.log('Payment validation request received');
    return this.paymentService.validatePayment(payload);
  }

  /**
   * Handle payment callback/confirmation
   */
  async handlePaymentCallback(payload: PaymentCallbackData) {
    this.logger.log('Payment callback received');
    
    const result = await this.paymentService.processCallback(payload);

    // If payment was successful, activate subscription and record on blockchain
    if (result.success && payload.ResultCode === '0' && payload.Paid) {
      try {
        // Find the completed contribution
        const contribution = await this.prisma.contribution.findFirst({
          where: {
            paymentRef: { startsWith: 'menodao_' },
            status: PaymentStatus.COMPLETED,
          },
          orderBy: { updatedAt: 'desc' },
          include: { member: { include: { subscription: true } } },
        });

        if (contribution) {
          // Activate subscription if not already active
          if (contribution.member?.subscription && !contribution.member.subscription.isActive) {
            await this.subscriptionsService.activateSubscription(contribution.memberId);
            this.logger.log(`Subscription activated for member ${contribution.memberId}`);
          }

          // Record on blockchain
          const txHash = await this.blockchainService.recordContribution(
            contribution.memberId,
            contribution.amount,
          );

          if (txHash) {
            await this.prisma.contribution.update({
              where: { id: contribution.id },
              data: { txHash },
            });
            this.logger.log(`Blockchain record created: ${txHash}`);
          }
        }
      } catch (error) {
        this.logger.error(`Post-payment processing failed: ${error.message}`);
      }
    }

    return result;
  }

  /**
   * Check payment status for a contribution
   */
  async checkPaymentStatus(contributionId: string, memberId: string) {
    const contribution = await this.prisma.contribution.findFirst({
      where: { id: contributionId, memberId },
    });

    if (!contribution) {
      throw new NotFoundException('Contribution not found');
    }

    return {
      contributionId: contribution.id,
      status: contribution.status,
      amount: contribution.amount,
      paymentRef: contribution.paymentRef,
      txHash: contribution.txHash,
      createdAt: contribution.createdAt,
      updatedAt: contribution.updatedAt,
    };
  }

  /**
   * Legacy webhook handler (kept for backward compatibility)
   */
  async handlePaymentWebhook(payload: any) {
    return this.handlePaymentCallback(payload);
  }
}
