import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BlockchainService } from '../blockchain/blockchain.service';
import { PaymentStatus } from '@prisma/client';

@Injectable()
export class ContributionsService {
  constructor(
    private prisma: PrismaService,
    private blockchainService: BlockchainService,
  ) {}

  /**
   * Initiate a contribution payment
   * This would integrate with your onramp API (M-Pesa, card, etc.)
   */
  async initiatePayment(memberId: string, amount: number, paymentMethod: string) {
    // Verify member has subscription
    const subscription = await this.prisma.subscription.findUnique({
      where: { memberId },
    });

    if (!subscription) {
      throw new BadRequestException('Please subscribe to a package first');
    }

    // Create contribution record
    const contribution = await this.prisma.contribution.create({
      data: {
        memberId,
        amount,
        month: new Date(),
        paymentMethod,
        status: PaymentStatus.PENDING,
      },
    });

    // Here you would integrate with your onramp/payment API
    // For example, M-Pesa STK push, card payment, etc.
    // The payment callback would then call confirmPayment()

    return {
      contributionId: contribution.id,
      amount,
      paymentMethod,
      status: 'PENDING',
      // Return payment details from your provider (e.g., M-Pesa checkout URL)
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
   * Webhook handler for payment provider callbacks
   */
  async handlePaymentWebhook(payload: any) {
    // Parse webhook payload based on your payment provider
    // This is a generic structure - customize based on your provider
    const { contributionId, status, reference } = payload;

    if (status === 'success') {
      return this.confirmPayment(contributionId, reference);
    } else {
      return this.prisma.contribution.update({
        where: { id: contributionId },
        data: { status: PaymentStatus.FAILED },
      });
    }
  }
}
