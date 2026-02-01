import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import axios from 'axios';
import * as crypto from 'crypto';

export interface PaymentResult {
  success: boolean;
  transactionId?: string;
  reference?: string;
  checkoutRequestId?: string;
  error?: string;
}

export interface PaymentCallbackData {
  MerchantRequestID?: string;
  CheckoutRequestID?: string;
  ResultCode?: string;
  ResultDesc?: string;
  TransAmount?: string;
  Paid?: boolean;
  CustomerMobile?: string;
  TransactionCode?: string;
}

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);
  private readonly baseUrl = 'https://payments.riftfi.xyz';

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {}

  /**
   * Generate unique transaction reference with menodao_ prefix
   */
  private generateTransactionRef(): string {
    const timestamp = Date.now().toString(36);
    const random = crypto.randomBytes(4).toString('hex');
    return `menodao_${timestamp}${random}`;
  }

  /**
   * Normalize phone number to Kenyan format (254XXXXXXXXX)
   */
  private normalizePhoneNumber(phone: string): string {
    let normalized = phone.replace(/[\s\-\(\)\+]/g, '');
    if (normalized.startsWith('0')) {
      normalized = '254' + normalized.substring(1);
    }
    if (!normalized.startsWith('254')) {
      normalized = '254' + normalized;
    }
    return normalized;
  }

  /**
   * Generate RSA signature for Rift Fiat Wallet API
   */
  private generateSignature(
    method: string,
    url: string,
    timestamp: string,
    nonce: string,
    merchantCode: string,
    body: string,
    privateKey: string,
  ): string {
    const normalizedKey = privateKey.replace(/\\n/g, '\n');
    const signatureString = `${method}\n${url}\n${timestamp}\n${nonce}\n${merchantCode}\n${body}\n`;

    const sign = crypto.createSign('SHA256');
    sign.update(signatureString);
    sign.end();

    return sign.sign(normalizedKey, 'base64');
  }

  /**
   * Initiate M-Pesa STK Push via Rift Fiat Wallet
   */
  async initiateSTKPush(
    memberId: string,
    phoneNumber: string,
    amount: number,
    contributionId: string,
    description: string = 'MenoDAO Contribution',
  ): Promise<PaymentResult> {
    const merchantCode = this.configService.get<string>('RIFT_MERCHANT_CODE');
    const privateKey = this.configService.get<string>('RIFT_PRIVATE_KEY');
    const apiBaseUrl =
      this.configService.get<string>('API_BASE_URL') ||
      'https://api.menodao.org';

    if (!merchantCode || !privateKey) {
      this.logger.error('Rift merchant credentials not configured');
      return {
        success: false,
        error: 'Payment service not configured. Please contact support.',
      };
    }

    try {
      const normalizedPhone = this.normalizePhoneNumber(phoneNumber);
      const transactionRef = this.generateTransactionRef();
      const timestamp = Date.now().toString();
      const nonce = crypto.randomBytes(16).toString('hex');

      const callbackUrl = `${apiBaseUrl}/contributions/callback`;
      const validationUrl = `${apiBaseUrl}/contributions/validation`;

      const requestBody = {
        phone_number: normalizedPhone,
        amount: Math.round(amount),
        currency: 'KES',
        description: `${description} - ${transactionRef}`,
        network: 'Safaricom',
        callback_url: callbackUrl,
        validation_url: validationUrl,
        account_reference: transactionRef,
      };

      const bodyString = JSON.stringify(requestBody);
      const url = '/v1/c2b/collect';

      const signature = this.generateSignature(
        'POST',
        url,
        timestamp,
        nonce,
        merchantCode,
        bodyString,
        privateKey,
      );

      this.logger.log(
        `Initiating STK Push for ${normalizedPhone}, amount: ${amount}`,
      );

      const response = await axios.post(`${this.baseUrl}${url}`, bodyString, {
        headers: {
          'Content-Type': 'application/json',
          'R-Merchant-Code': merchantCode,
          'R-Signature': signature,
          'R-Timestamp': timestamp,
          'R-Nonce-Str': nonce,
        },
        transformRequest: [(data) => data],
      });

      const riftResponse = response.data;

      if (riftResponse.success) {
        const checkoutRequestId =
          riftResponse.checkout_request_id || riftResponse.CheckoutRequestID;
        const transactionCode =
          riftResponse.transaction_code || riftResponse.MerchantRequestID;

        // Update contribution with payment reference
        await this.prisma.contribution.update({
          where: { id: contributionId },
          data: {
            paymentRef: transactionRef,
            metadata: {
              checkoutRequestId,
              transactionCode,
              phoneNumber: normalizedPhone,
              initiatedAt: new Date().toISOString(),
            },
          },
        });

        this.logger.log(
          `STK Push initiated successfully. Ref: ${transactionRef}`,
        );

        return {
          success: true,
          transactionId: contributionId,
          reference: transactionRef,
          checkoutRequestId,
        };
      } else {
        this.logger.error(`STK Push failed: ${riftResponse.message}`);
        return {
          success: false,
          error: riftResponse.message || 'Payment initiation failed',
        };
      }
    } catch (error) {
      this.logger.error(`STK Push error: ${error.message}`);
      if (axios.isAxiosError(error) && error.response) {
        return {
          success: false,
          error: error.response.data?.message || 'Payment service error',
        };
      }
      return {
        success: false,
        error: 'Failed to initiate payment. Please try again.',
      };
    }
  }

  /**
   * Validate incoming payment (called by payment provider before processing)
   */
  async validatePayment(
    data: PaymentCallbackData,
  ): Promise<{ valid: boolean; message: string }> {
    try {
      const { MerchantRequestID, CheckoutRequestID, TransAmount } = data;

      this.logger.log(
        `Validating payment: ${MerchantRequestID || CheckoutRequestID}`,
      );

      // Find the contribution by checkout request ID or transaction code
      const contribution = await this.prisma.contribution.findFirst({
        where: {
          OR: [{ paymentRef: { startsWith: 'menodao_' } }],
          status: 'PENDING',
        },
      });

      if (!contribution) {
        this.logger.warn('No pending contribution found for validation');
        return { valid: false, message: 'Transaction not found' };
      }

      // Validate amount matches
      const expectedAmount = contribution.amount;
      const receivedAmount = parseFloat(TransAmount || '0');

      if (Math.abs(expectedAmount - receivedAmount) > 1) {
        this.logger.warn(
          `Amount mismatch: expected ${expectedAmount}, received ${receivedAmount}`,
        );
        return { valid: false, message: 'Amount mismatch' };
      }

      return { valid: true, message: 'Validation successful' };
    } catch (error) {
      this.logger.error(`Validation error: ${error.message}`);
      return { valid: false, message: 'Validation failed' };
    }
  }

  /**
   * Process payment callback (confirmation from payment provider)
   */
  async processCallback(
    data: PaymentCallbackData,
  ): Promise<{ success: boolean; message: string }> {
    try {
      const {
        MerchantRequestID,
        CheckoutRequestID,
        ResultCode,
        Paid,
        TransAmount,
        CustomerMobile,
        TransactionCode,
      } = data;

      this.logger.log(`Processing callback: ${JSON.stringify(data)}`);

      // Find contribution by metadata
      const contribution = await this.prisma.contribution.findFirst({
        where: {
          paymentRef: { startsWith: 'menodao_' },
          status: 'PENDING',
        },
        include: { member: true },
      });

      if (!contribution) {
        this.logger.warn('No pending contribution found for callback');
        return { success: false, message: 'Transaction not found' };
      }

      const isSuccess = ResultCode === '0' && Paid === true;

      if (isSuccess) {
        // Update contribution to completed
        await this.prisma.contribution.update({
          where: { id: contribution.id },
          data: {
            status: 'COMPLETED',
            metadata: {
              ...((contribution.metadata as object) || {}),
              transactionCode: TransactionCode,
              customerMobile: CustomerMobile,
              completedAt: new Date().toISOString(),
              resultCode: ResultCode,
            },
          },
        });

        this.logger.log(
          `Payment completed for contribution ${contribution.id}`,
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
              resultDesc: data.ResultDesc,
            },
          },
        });

        this.logger.warn(
          `Payment failed for contribution ${contribution.id}: ${data.ResultDesc}`,
        );
        return { success: true, message: 'Payment failure recorded' };
      }
    } catch (error) {
      this.logger.error(`Callback processing error: ${error.message}`);
      return { success: false, message: 'Callback processing failed' };
    }
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
    } | null;

    return {
      status: contribution.status,
      transactionCode: metadata?.transactionCode,
    };
  }
}
