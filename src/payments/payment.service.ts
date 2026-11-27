import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import {
  SasaPayService,
  SasaPayC2BCallbackData,
} from '../sasapay/sasapay.service';
import { SmsService } from '../sms/sms.service';
import { PackageTier, PaymentFrequency, CareEventType } from '@prisma/client';
import * as crypto from 'crypto';
import { ReferralService } from '../referrals/referral.service';
import { CareEventsService } from '../care-intelligence/care-events.service';

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
export interface StkCallbackProof {
  reference: string;
  token: string;
}

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);
  private readonly isDevEnvironment: boolean;

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
    private sasaPayService: SasaPayService,
    private smsService: SmsService,
    private referralService: ReferralService,
    @Optional() private careEvents?: CareEventsService,
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
        `Initiating SasaPay STK Push for ***${normalizedPhone.slice(-4)}, amount: ${amount}, ref: ${transactionRef}`,
      );

      // Store the exact merchant reference before asking the provider to charge.
      await this.prisma.contribution.update({
        where: { id: contributionId },
        data: { paymentRef: transactionRef },
      });

      const response = await this.sasaPayService.requestPayment(
        phoneNumber,
        amount,
        transactionRef,
        `${description} - ${transactionRef}`,
      );

      if (response.status) {
        const checkoutRequestId = response.CheckoutRequestID;
        const merchantRequestId = response.MerchantRequestID;

        const identifiers = { checkoutRequestId, merchantRequestId };
        await this.prisma.contribution.update({
          where: { id: contributionId },
          data: identifiers,
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

    // Get existing contribution to preserve metadata
    const existingContribution = await this.prisma.contribution.findUnique({
      where: { id: contributionId },
    });

    await this.prisma.contribution.update({
      where: { id: contributionId },
      data: {
        paymentRef: transactionRef,
        checkoutRequestId: mockCheckoutId,
        merchantRequestId: mockMerchantId,
        metadata: {
          ...((existingContribution?.metadata as object) || {}), // Preserve existing metadata
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
      const receivedAmount = Number(data.Amount ?? data.TransAmount);

      if (expectedAmount !== receivedAmount) {
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
    proof?: StkCallbackProof,
  ): Promise<{
    success: boolean;
    message: string;
    contributionId?: string;
    retryable?: boolean;
  }> {
    try {
      if (
        proof &&
        !this.sasaPayService.verifyStkCallback(proof.reference, proof.token)
      ) {
        return { success: false, message: 'Invalid payment callback' };
      }
      const contribution = await this.findContributionByCallback(
        data,
        proof?.reference,
      );
      if (!contribution)
        return { success: false, message: 'Transaction not found' };

      const metadata = contribution.metadata as {
        isUpgrade?: boolean;
        newTier?: PackageTier;
        purchasedTier?: PackageTier;
        purchasedMonthlyAmount?: number;
        purchasedAnnualCap?: number;
        paymentFrequency?: PaymentFrequency;
        stkSource?: 'WEB' | 'WHATSAPP';
      } | null;
      const isDevelopmentMock =
        this.isDevEnvironment &&
        contribution.checkoutRequestId?.startsWith('MOCK_CHECKOUT_');
      if (!isDevelopmentMock && !proof) {
        return {
          success: false,
          message: 'Missing payment callback verification',
        };
      }
      if (contribution.status === 'COMPLETED') {
        return { success: true, message: 'Payment already processed' };
      }
      if (proof) {
        const checkoutId = this.callbackIdentifier(data.CheckoutRequestID);
        const recordedCheckout =
          contribution.checkoutRequestId ??
          (contribution.metadata as { checkoutRequestId?: string } | null)
            ?.checkoutRequestId;
        if (!checkoutId) {
          return { success: false, message: 'Missing provider checkout ID' };
        }
        if (!recordedCheckout) {
          return {
            success: false,
            retryable: true,
            message: 'Provider checkout ID has not been saved yet',
          };
        }
      }
      const resultCode = this.callbackIdentifier(data.ResultCode);
      if (
        (resultCode === '0' && data.Paid === false) ||
        (resultCode && resultCode !== '0' && data.Paid === true)
      ) {
        return { success: false, message: 'Conflicting payment result' };
      }
      const isSuccess =
        resultCode === '0' || (!resultCode && data.Paid === true);
      const isFailure =
        !isSuccess && (Boolean(resultCode) || data.Paid === false);
      if (!isSuccess && !isFailure)
        return { success: false, message: 'Missing final payment result' };
      const now = new Date();

      if (isFailure) {
        const failed = await this.prisma.contribution.updateMany({
          where: { id: contribution.id, status: 'PENDING' },
          data: {
            status: 'FAILED',
            metadata: {
              ...metadata,
              failedAt: now.toISOString(),
              resultCode: data.ResultCode,
              resultDesc: data.ResultDesc,
            },
          },
        });
        if (failed.count) {
          void this.careEvents?.track({
            type: CareEventType.MEMBERSHIP_PAYMENT_FAILED,
            memberId: contribution.memberId,
            source: metadata?.stkSource,
            metadata: {
              contributionId: contribution.id,
              resultCode: data.ResultCode,
            },
          });
        }
        return { success: true, message: 'Payment failure recorded' };
      }

      const rawAmount = data.TransAmount ?? data.Amount;
      const amount =
        typeof rawAmount === 'number' ||
        (typeof rawAmount === 'string' && /^\d+(?:\.\d+)?$/.test(rawAmount))
          ? Number(rawAmount)
          : NaN;
      const receipt = this.callbackIdentifier(
        data.MpesaReceiptNumber || data.TransactionCode || data.TransID,
      )?.toUpperCase();
      if (amount !== contribution.amount || !receipt) {
        this.logger.warn(
          'Rejected a payment callback with an invalid amount or missing receipt.',
        );
        return {
          success: false,
          message: 'Payment amount or receipt could not be verified',
        };
      }

      const outcome = await this.prisma.$transaction(async (tx) => {
        // Lock the receipt before checking for reuse across concurrent checkouts.
        await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${receipt}, 0))`;
        const usedReceipt = await tx.contribution.findFirst({
          where: {
            id: { not: contribution.id },
            status: 'COMPLETED',
            mpesaReceiptNumber: { equals: receipt, mode: 'insensitive' },
          },
          select: { id: true },
        });
        if (usedReceipt) return 'receipt-in-use' as const;

        const completed = await tx.contribution.updateMany({
          where: { id: contribution.id, status: { in: ['PENDING', 'FAILED'] } },
          data: {
            status: 'COMPLETED',
            confirmedAt: now,
            mpesaReceiptNumber: receipt,
            metadata: {
              ...metadata,
              mpesaReceiptNumber: receipt,
              transactionCode: receipt,
              completedAt: now.toISOString(),
              resultCode: data.ResultCode,
              confirmedAmount: amount,
            },
          },
        });
        if (!completed.count) return null;

        // Serialise entitlement updates across different payments by one member.
        await tx.$queryRaw`SELECT id FROM "Subscription" WHERE "memberId" = ${contribution.memberId} FOR UPDATE`;
        const subscription = await tx.subscription.findUnique({
          where: { memberId: contribution.memberId },
          include: { member: true },
        });
        if (!subscription)
          throw new Error('The paid member has no subscription to activate.');
        const newerPayment = await tx.contribution.findFirst({
          where: {
            memberId: contribution.memberId,
            status: 'COMPLETED',
            paymentMethod: 'MPESA',
            createdAt: { gt: contribution.createdAt },
          },
          select: { id: true },
        });
        if (newerPayment) return { subscription, sendNotice: false };

        const tier =
          metadata?.purchasedTier ?? metadata?.newTier ?? subscription.tier;
        const tierPrices = { BRONZE: 350, SILVER: 550, GOLD: 700 };
        const tierCaps = { BRONZE: 6000, SILVER: 10000, GOLD: 15000 };
        const frequency =
          metadata?.paymentFrequency ?? subscription.paymentFrequency;
        const activated = await tx.subscription.update({
          where: { memberId: contribution.memberId },
          data: {
            isActive: true,
            tier,
            paymentFrequency: frequency,
            monthlyAmount:
              metadata?.purchasedMonthlyAmount ??
              (metadata?.isUpgrade
                ? tierPrices[tier]
                : subscription.monthlyAmount),
            annualCapLimit:
              metadata?.purchasedAnnualCap ??
              (metadata?.isUpgrade
                ? tierCaps[tier]
                : subscription.annualCapLimit),
          },
          include: { member: true },
        });
        await tx.contribution.update({
          where: { id: contribution.id },
          data: { claimLimitsAssigned: true, claimLimitsAssignedAt: now },
        });
        return {
          subscription: activated,
          sendNotice: !subscription.isActive || tier !== subscription.tier,
        };
      });
      if (outcome === 'receipt-in-use') {
        return { success: false, message: 'Payment receipt already used' };
      }
      if (!outcome)
        return { success: true, message: 'Payment already processed' };

      void this.careEvents?.track({
        type: CareEventType.MEMBERSHIP_PAYMENT_SUCCESS,
        memberId: contribution.memberId,
        source: metadata?.stkSource,
        metadata: { contributionId: contribution.id, amount },
      });

      const followUps: Promise<unknown>[] = [
        this.referralService.creditCommission(contribution.id),
      ];
      if (outcome.sendNotice) {
        const { subscription } = outcome;
        if (subscription.member.referredBy) {
          followUps.push(
            this.referralService.updateActiveReferralCount(
              subscription.member.referredBy,
            ),
          );
        }
        const tier =
          subscription.tier[0] + subscription.tier.slice(1).toLowerCase();
        const message =
          subscription.member.preferredLanguage === 'sw'
            ? `Malipo yako yamepokelewa. Uanachama wako wa Meno${tier} sasa unatumika.`
            : `Your payment was received and your Meno${tier} membership is active.`;
        followUps.push(
          this.smsService.sendSms(subscription.member.phoneNumber, message),
        );
      }
      for (const result of await Promise.allSettled(followUps)) {
        if (result.status === 'rejected') {
          this.logger.warn('A follow-up failed after payment was confirmed.');
        }
      }

      return {
        success: true,
        message: 'Payment processed successfully',
        contributionId: contribution.id,
      };
    } catch (error) {
      this.logger.error(
        `Callback processing failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return {
        success: false,
        retryable: true,
        message: 'Callback processing failed',
      };
    }
  }

  private callbackIdentifier(value: unknown): string | undefined {
    if (typeof value === 'number' && Number.isSafeInteger(value)) {
      return String(value);
    }
    return typeof value === 'string' ? value.trim() || undefined : undefined;
  }

  private async findContributionByCallback(
    data: PaymentCallbackData,
    verifiedReference?: string,
  ) {
    const checkoutId = this.callbackIdentifier(data.CheckoutRequestID);
    const merchantId = this.callbackIdentifier(data.MerchantRequestID);
    const references = [
      data.BillRefNumber,
      data.ThirdPartyTransID,
      merchantId,
      verifiedReference,
    ].filter(
      (value): value is string =>
        typeof value === 'string' && /^menodao_[a-z0-9]+$/i.test(value),
    );
    if (!checkoutId && !merchantId && !references.length) return null;
    const candidates = await this.prisma.contribution.findMany({
      where: {
        OR: [
          ...(checkoutId
            ? [
                { checkoutRequestId: checkoutId },
                {
                  metadata: { path: ['checkoutRequestId'], equals: checkoutId },
                },
              ]
            : []),
          ...(merchantId
            ? [
                { merchantRequestId: merchantId },
                {
                  metadata: { path: ['merchantRequestId'], equals: merchantId },
                },
              ]
            : []),
          ...(references.length ? [{ paymentRef: { in: references } }] : []),
        ],
        paymentMethod: 'MPESA',
      },
      take: 2,
    });
    if (candidates.length !== 1) return null;
    const contribution = candidates[0];
    if (verifiedReference && contribution.paymentRef !== verifiedReference)
      return null;
    const metadata = contribution.metadata as {
      checkoutRequestId?: string;
      merchantRequestId?: string;
    } | null;
    const recordedCheckout =
      contribution.checkoutRequestId ?? metadata?.checkoutRequestId;
    const recordedMerchant =
      contribution.merchantRequestId ?? metadata?.merchantRequestId;
    if (
      (checkoutId && recordedCheckout && checkoutId !== recordedCheckout) ||
      (merchantId &&
        recordedMerchant &&
        merchantId !== recordedMerchant &&
        merchantId !== contribution.paymentRef) ||
      (references.length &&
        contribution.paymentRef &&
        !references.includes(contribution.paymentRef))
    )
      return null;
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
        contribution.mpesaReceiptNumber ||
        metadata?.mpesaReceiptNumber ||
        metadata?.transactionCode,
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
