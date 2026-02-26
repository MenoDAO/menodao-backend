import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import {
  SasaPayService,
  SasaPayC2BCallbackData,
} from '../sasapay/sasapay.service';
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

      // Validate amount matches - handle different field names
      const expectedAmount = contribution.amount;
      const receivedAmount =
        data.Amount || (data.TransAmount ? parseFloat(data.TransAmount) : 0);

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

      const { CheckoutRequestID, MerchantRequestID, ResultCode, ResultDesc } =
        data;

      // Extract amount from various possible fields
      const amount =
        data.Amount ||
        (data.TransAmount ? parseFloat(data.TransAmount) : undefined);

      // Extract receipt number from various possible fields
      const receiptNumber =
        data.MpesaReceiptNumber || data.TransactionCode || data.TransID;

      // Extract phone number from various possible fields
      const phoneNumber =
        data.PhoneNumber || data.CustomerMobile || data.MSISDN;

      // Extract transaction date/time
      const transactionDate = data.TransactionDate || data.TransTime;

      // Find contribution by SasaPay callback identifiers
      const contribution = await this.findContributionByCallback(data);

      if (!contribution) {
        this.logger.warn(
          `No pending contribution found for callback: CheckoutRequestID=${CheckoutRequestID}, MerchantRequestID=${MerchantRequestID}`,
        );
        return { success: false, message: 'Transaction not found' };
      }

      // SasaPay: ResultCode '0' means success, or Paid=true
      const isSuccess = ResultCode === '0' || data.Paid === true;

      if (isSuccess) {
        // Update contribution to completed
        await this.prisma.contribution.update({
          where: { id: contribution.id },
          data: {
            status: 'COMPLETED',
            metadata: {
              ...((contribution.metadata as object) || {}),
              mpesaReceiptNumber: receiptNumber,
              transactionCode: receiptNumber, // Backward compat
              customerMobile: phoneNumber,
              transactionDate: transactionDate,
              completedAt: new Date().toISOString(),
              resultCode: ResultCode,
              resultDesc: ResultDesc,
              confirmedAmount: amount,
              fullCallbackData: JSON.parse(JSON.stringify(data)), // Store full callback for debugging
            },
          },
        });

        this.logger.log(
          `Payment completed for contribution ${contribution.id}, M-Pesa receipt: ${receiptNumber}`,
        );
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
}
