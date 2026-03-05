import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import {
  SasaPayService,
  SasaPayC2BCallbackData,
} from '../sasapay/sasapay.service';
import { PackageTier, PaymentFrequency } from '@prisma/client';
import * as crypto from 'crypto';

export interface PaymentResult {
  success: boolean;
  transactionId?: string;
  reference?: string;
  checkoutRequestId?: string;
  merchantRequestId?: string;
  error?: string;
}

// Re-export SasaPay callback type for backward compatibility
export type PaymentCallbackData = SasaPayC2BCallbackData;

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);
  private readonly isDevEnvironment: boolean;

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
    private sasaPayService: SasaPayService,
  ) {
    this.isDevEnvironment =
      this.configService.get('NODE_ENV') === 'development';
  }

  /**
   * Generate unique transaction reference with menodao_ prefix
   */
  private generateTransactionRef(): string {
    const timestamp = Date.now().toString(36);
    const random = crypto.randomBytes(4).toString('hex');
    return `menodao_${timestamp}${random}`;
  }

  /**
   * Initiate M-Pesa STK Push via SasaPay C2B API
   */
  async initiateSTKPush(
    memberId: string,
    phoneNumber: string,
    amount: number,
    contributionId: string,
    description: string = 'MenoDAO Contribution',
  ): Promise<PaymentResult> {
    // In dev environment without SasaPay configured, use mock payment
    if (this.isDevEnvironment && !this.sasaPayService.isConfigured()) {
      this.logger.warn('[DEV] SasaPay not configured — using mock STK push');
      return this.mockSTKPush(contributionId, phoneNumber, amount);
    }

    if (!this.sasaPayService.isConfigured()) {
      this.logger.error('SasaPay is not configured');
      return {
        success: false,
        error: 'Payment service not configured. Please contact support.',
      };
    }

    try {
      const transactionRef = this.generateTransactionRef();
      const normalizedPhone =
        this.sasaPayService.normalizePhoneNumber(phoneNumber);

      this.logger.log(
        `Initiating SasaPay STK Push for ${normalizedPhone}, amount: ${amount}, ref: ${transactionRef}`,
      );

      const response = await this.sasaPayService.requestPayment(
        phoneNumber,
        amount,
        transactionRef,
        `${description} - ${transactionRef}`,
      );

      if (response.status) {
        const checkoutRequestId = response.CheckoutRequestID;
        const merchantRequestId = response.MerchantRequestID;

        // Update contribution with payment reference and SasaPay IDs
        await this.prisma.contribution.update({
          where: { id: contributionId },
          data: {
            paymentRef: transactionRef,
            metadata: {
              checkoutRequestId,
              merchantRequestId,
              phoneNumber: normalizedPhone,
              initiatedAt: new Date().toISOString(),
              provider: 'sasapay',
              responseCode: response.ResponseCode,
              customerMessage: response.CustomerMessage,
            },
          },
        });

        this.logger.log(
          `SasaPay STK Push initiated. Ref: ${transactionRef}, CheckoutRequestID: ${checkoutRequestId}`,
        );

        return {
          success: true,
          transactionId: contributionId,
          reference: transactionRef,
          checkoutRequestId,
          merchantRequestId,
        };
      } else {
        this.logger.error(`SasaPay STK Push failed: ${response.detail}`);
        return {
          success: false,
          error: response.detail || 'Payment initiation failed',
        };
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(`STK Push error: ${errMsg}`);
      return {
        success: false,
        error: 'Failed to initiate payment. Please try again.',
      };
    }
  }

  /**
   * [DEV ONLY] Mock STK push for testing without SasaPay credentials
   */
  private async mockSTKPush(
    contributionId: string,
    phoneNumber: string,
    amount: number,
  ): Promise<PaymentResult> {
    const transactionRef = this.generateTransactionRef();
    const mockCheckoutId = `MOCK_CHECKOUT_${Date.now()}`;
    const mockMerchantId = `MOCK_MERCHANT_${Date.now()}`;

    await this.prisma.contribution.update({
      where: { id: contributionId },
      data: {
        paymentRef: transactionRef,
        metadata: {
          checkoutRequestId: mockCheckoutId,
          merchantRequestId: mockMerchantId,
          phoneNumber,
          amount,
          initiatedAt: new Date().toISOString(),
          provider: 'mock',
        },
      },
    });

    this.logger.warn(`[DEV] Mock STK Push: ref=${transactionRef}`);

    return {
      success: true,
      transactionId: contributionId,
      reference: transactionRef,
      checkoutRequestId: mockCheckoutId,
      merchantRequestId: mockMerchantId,
    };
  }

  /**
   * Validate incoming payment (called by SasaPay before processing)
   */
  async validatePayment(
    data: PaymentCallbackData,
  ): Promise<{ valid: boolean; message: string }> {
    try {
      const { CheckoutRequestID, MerchantRequestID } = data;

      this.logger.log(
        `Validating payment: CheckoutRequestID=${CheckoutRequestID}, MerchantRequestID=${MerchantRequestID}`,
      );

      // Find the contribution by checkoutRequestId stored in metadata
      const contribution = await this.findContributionByCallback(data);

      if (!contribution) {
        this.logger.warn(
          `No pending contribution found for CheckoutRequestID=${CheckoutRequestID}`,
        );
        return { valid: false, message: 'Transaction not found' };
      }

      // Validate amount matches
      const expectedAmount = contribution.amount;
      const receivedAmount = data.Amount || 0;

      if (Math.abs(expectedAmount - receivedAmount) > 1) {
        this.logger.warn(
          `Amount mismatch: expected ${expectedAmount}, received ${receivedAmount}`,
        );
        return { valid: false, message: 'Amount mismatch' };
      }

      return { valid: true, message: 'Validation successful' };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Validation error: ${errMsg}`);
      return { valid: false, message: 'Validation failed' };
    }
  }

  /**
   * Process payment callback (confirmation from SasaPay)
   */
  async processCallback(
    data: PaymentCallbackData,
  ): Promise<{ success: boolean; message: string }> {
    try {
      this.logger.log(`Processing SasaPay callback: ${JSON.stringify(data)}`);

      const {
        CheckoutRequestID,
        MerchantRequestID,
        ResultCode,
        ResultDesc,
        Amount,
        MpesaReceiptNumber,
        PhoneNumber,
        TransactionDate,
      } = data;

      // Find contribution by SasaPay callback identifiers
      const contribution = await this.findContributionByCallback(data);

      if (!contribution) {
        this.logger.warn(
          `No pending contribution found for callback: CheckoutRequestID=${CheckoutRequestID}, MerchantRequestID=${MerchantRequestID}`,
        );
        return { success: false, message: 'Transaction not found' };
      }

      // SasaPay: ResultCode '0' means success
      const isSuccess = ResultCode === '0';

      if (isSuccess) {
        // Check if this is an upgrade payment BEFORE updating (preserve original metadata)
        const originalMetadata = contribution.metadata as {
          isUpgrade?: boolean;
          newTier?: PackageTier;
        } | null;

        // Update contribution to completed
        await this.prisma.contribution.update({
          where: { id: contribution.id },
          data: {
            status: 'COMPLETED',
            metadata: {
              ...((contribution.metadata as object) || {}),
              mpesaReceiptNumber: MpesaReceiptNumber,
              transactionCode: MpesaReceiptNumber, // Backward compat
              customerMobile: PhoneNumber,
              transactionDate: TransactionDate,
              completedAt: new Date().toISOString(),
              resultCode: ResultCode,
              resultDesc: ResultDesc,
              confirmedAmount: Amount,
            },
          },
        });

        this.logger.log(
          `Payment completed for contribution ${contribution.id}, M-Pesa receipt: ${MpesaReceiptNumber}`,
        );

        // Process upgrade if this was an upgrade payment
        if (originalMetadata?.isUpgrade && originalMetadata?.newTier) {
          this.logger.log(
            `Processing upgrade for member ${contribution.memberId} to ${originalMetadata.newTier}`,
          );

          // This is an upgrade payment - update subscription directly
          const subscription = await this.prisma.subscription.findUnique({
            where: { memberId: contribution.memberId },
          });

          if (subscription) {
            const tierCaps: Record<PackageTier, number> = {
              BRONZE: 6000,
              SILVER: 10000,
              GOLD: 15000,
            };

            const tierPrices: Record<PackageTier, number> = {
              BRONZE: 350,
              SILVER: 550,
              GOLD: 700,
            };

            await this.prisma.subscription.update({
              where: { memberId: contribution.memberId },
              data: {
                tier: originalMetadata.newTier,
                monthlyAmount: tierPrices[originalMetadata.newTier],
                annualCapLimit: tierCaps[originalMetadata.newTier],
              },
            });

            this.logger.log(
              `Upgrade completed for member ${contribution.memberId} to ${originalMetadata.newTier}`,
            );
          } else {
            this.logger.error(
              `No subscription found for member ${contribution.memberId} during upgrade`,
            );
          }
        }

        return { success: true, message: 'Payment processed successfully' };
      } else {
        // Update contribution to failed
        await this.prisma.contribution.update({
          where: { id: contribution.id },
          data: {
            status: 'FAILED',
            metadata: {
              ...((contribution.metadata as object) || {}),
              failedAt: new Date().toISOString(),
              resultCode: ResultCode,
              resultDesc: ResultDesc,
            },
          },
        });

        this.logger.warn(
          `Payment failed for contribution ${contribution.id}: ${ResultDesc}`,
        );
        return { success: true, message: 'Payment failure recorded' };
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Callback processing error: ${errMsg}`);
      return { success: false, message: 'Callback processing failed' };
    }
  }

  /**
   * Find contribution by SasaPay callback identifiers
   * Matches CheckoutRequestID or MerchantRequestID stored in metadata
   */
  private async findContributionByCallback(data: PaymentCallbackData) {
    const { CheckoutRequestID, MerchantRequestID } = data;

    // Try to find by CheckoutRequestID in metadata first (most reliable)
    if (CheckoutRequestID) {
      const contribution = await this.prisma.contribution.findFirst({
        where: {
          status: 'PENDING',
          metadata: {
            path: ['checkoutRequestId'],
            equals: CheckoutRequestID,
          },
        },
        include: { member: true },
      });

      if (contribution) return contribution;
    }

    // Fallback: find by MerchantRequestID in metadata
    if (MerchantRequestID) {
      const contribution = await this.prisma.contribution.findFirst({
        where: {
          status: 'PENDING',
          metadata: {
            path: ['merchantRequestId'],
            equals: MerchantRequestID,
          },
        },
        include: { member: true },
      });

      if (contribution) return contribution;
    }

    // Last resort: find most recent pending contribution with menodao_ ref
    const contribution = await this.prisma.contribution.findFirst({
      where: {
        paymentRef: { startsWith: 'menodao_' },
        status: 'PENDING',
      },
      orderBy: { createdAt: 'desc' },
      include: { member: true },
    });

    return contribution;
  }

  /**
   * Check payment status
   */
  async checkPaymentStatus(contributionId: string): Promise<{
    status: string;
    transactionCode?: string;
  }> {
    const contribution = await this.prisma.contribution.findUnique({
      where: { id: contributionId },
    });

    if (!contribution) {
      return { status: 'NOT_FOUND' };
    }

    const metadata = contribution.metadata as {
      transactionCode?: string;
      mpesaReceiptNumber?: string;
    } | null;

    return {
      status: contribution.status,
      transactionCode:
        metadata?.mpesaReceiptNumber || metadata?.transactionCode,
    };
  }

  /**
   * Calculate payment amount based on tier and frequency
   * Requirements: 20.1, 20.2, 20.3
   */
  async calculatePaymentAmount(
    tier: PackageTier,
    frequency: PaymentFrequency,
  ): Promise<number> {
    this.logger.log(`Calculating payment amount for ${tier} ${frequency}`);

    // Get tier pricing from database or config
    const tierPricing: Record<PackageTier, number> = {
      [PackageTier.BRONZE]: 500, // KES per month
      [PackageTier.SILVER]: 1000,
      [PackageTier.GOLD]: 1500,
    };

    const monthlyAmount = tierPricing[tier];

    if (!monthlyAmount) {
      throw new Error(`Invalid tier: ${tier}`);
    }

    // Calculate yearly as monthly * 12
    if (frequency === PaymentFrequency.ANNUAL) {
      const yearlyAmount = monthlyAmount * 12;
      this.logger.log(
        `Yearly amount for ${tier}: ${monthlyAmount} * 12 = ${yearlyAmount}`,
      );
      return yearlyAmount;
    }

    return monthlyAmount;
  }

  /**
   * Generate callback URL for payment notifications
   * Requirements: 9.1, 9.2, 9.3, 9.4, 9.5
   */
  async generateCallbackUrl(transactionId: string): Promise<string> {
    const apiBaseUrl = this.isDevEnvironment
      ? this.configService.get<string>('API_BASE_URL_DEV') ||
        this.configService.get<string>('API_BASE_URL') ||
        'https://dev-api.menodao.org'
      : this.configService.get<string>('API_BASE_URL') ||
        'https://api.menodao.org';

    const callbackUrl = `${apiBaseUrl}/contributions/callback`;

    // Validate URL is HTTPS
    if (!callbackUrl.startsWith('https://') && !this.isDevEnvironment) {
      this.logger.error(`Invalid callback URL (not HTTPS): ${callbackUrl}`);
      throw new Error('Callback URL must use HTTPS');
    }

    this.logger.log(`Generated callback URL: ${callbackUrl}`);
    return callbackUrl;
  }

  /**
   * Generate redirect URL for post-payment user redirect
   * Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6
   */
  async generateRedirectUrl(transactionId: string): Promise<string> {
    const frontendBaseUrl = this.isDevEnvironment
      ? this.configService.get<string>('FRONTEND_BASE_URL_DEV') ||
        this.configService.get<string>('FRONTEND_BASE_URL') ||
        'https://dev.menodao.org'
      : this.configService.get<string>('FRONTEND_BASE_URL') ||
        'https://menodao.org';

    const redirectUrl = `${frontendBaseUrl}/payment/status?transactionId=${transactionId}`;

    // Validate URL is HTTPS
    if (!redirectUrl.startsWith('https://') && !this.isDevEnvironment) {
      this.logger.error(`Invalid redirect URL (not HTTPS): ${redirectUrl}`);
      throw new Error('Redirect URL must use HTTPS');
    }

    this.logger.log(`Generated redirect URL: ${redirectUrl}`);
    return redirectUrl;
  }

  /**
   * Validate URL format
   */
  async validateUrl(url: string): Promise<boolean> {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'https:' || this.isDevEnvironment;
    } catch {
      return false;
    }
  }

  /**
   * Assign claim limits to member after successful payment
   * Requirements: 3.6, 12.4
   */
  async assignClaimLimits(
    userId: string,
    tier: PackageTier,
    transactionId: string,
  ): Promise<void> {
    this.logger.log(`Assigning claim limits for user ${userId}, tier ${tier}`);

    // Get member's subscription
    const member = await this.prisma.member.findUnique({
      where: { id: userId },
      include: { subscription: true },
    });

    if (!member || !member.subscription) {
      throw new Error(`Member ${userId} has no subscription`);
    }

    // Set claim limit by tier
    await this.setClaimLimitByTier(member.subscription.id, tier);

    // Update contribution record to mark claim limits as assigned
    const contribution = await this.prisma.contribution.findFirst({
      where: {
        memberId: userId,
        paymentRef: { contains: transactionId },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (contribution) {
      await this.prisma.contribution.update({
        where: { id: contribution.id },
        data: {
          claimLimitsAssigned: true,
          claimLimitsAssignedAt: new Date(),
        },
      });
    }

    this.logger.log(`Claim limits assigned for user ${userId}`);
  }

  /**
   * Set claim limit based on tier
   * Requirements: 12.1, 12.2, 12.3
   */
  async setClaimLimitByTier(
    subscriptionId: string,
    tier: PackageTier,
  ): Promise<void> {
    const tierLimits: Record<PackageTier, number> = {
      [PackageTier.BRONZE]: 6000,
      [PackageTier.SILVER]: 10000,
      [PackageTier.GOLD]: 15000,
    };

    const limit = tierLimits[tier];

    if (!limit) {
      throw new Error(`Invalid tier: ${tier}`);
    }

    await this.prisma.subscription.update({
      where: { id: subscriptionId },
      data: {
        annualCapLimit: limit,
      },
    });

    this.logger.log(
      `Set claim limit for subscription ${subscriptionId}: ${limit} KES`,
    );
  }

  /**
   * Verify payment status with SasaPay
   * This can be used for manual verification by admins
   */
  async verifyPaymentWithSasaPay(transactionId: string): Promise<string> {
    // TODO: Implement SasaPay transaction status query
    // https://developer.sasapay.app/docs/apis/transaction-status
    this.logger.log(`Verifying payment ${transactionId} with SasaPay`);
    return 'PENDING';
  }
}
