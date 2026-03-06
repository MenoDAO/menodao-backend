import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  DisbursalStatus,
  PaymentChannel,
  Disbursal,
  ClinicPaymentConfig,
  Prisma,
} from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { SasaPayService } from '../sasapay/sasapay.service';

export interface InitiateDisbursementRequest {
  claimId: string;
  amount: number;
  clinicId: string;
}

export interface DisbursalRecord extends Disbursal {
  statusHistory?: Array<{
    id: string;
    status: DisbursalStatus;
    timestamp: Date;
    metadata?: any;
  }>;
}

@Injectable()
export class DisbursalService {
  private readonly logger = new Logger(DisbursalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly sasapay: SasaPayService,
  ) {}

  /**
   * Initiate a new disbursal for an approved claim
   */
  async initiateDisbursement(
    request: InitiateDisbursementRequest,
  ): Promise<DisbursalRecord> {
    this.logger.log(`Initiating disbursal for claim ${request.claimId}`);

    // Check if disbursal already exists for this claim
    const existingDisbursal = await this.prisma.disbursal.findUnique({
      where: { claimId: request.claimId },
    });

    if (existingDisbursal) {
      throw new BadRequestException(
        `Disbursal already exists for claim ${request.claimId}`,
      );
    }

    // Get clinic payment configuration
    const paymentConfig = await this.getClinicPaymentConfig(request.clinicId);

    // Generate unique transaction reference
    const transactionReference = `DISB_${Date.now()}_${request.claimId.substring(0, 8)}`;

    // Determine recipient identifier based on payment channel
    const recipientIdentifier = this.getRecipientIdentifier(paymentConfig);

    // Create disbursal record
    const disbursal = await this.prisma.disbursal.create({
      data: {
        claimId: request.claimId,
        clinicId: request.clinicId,
        amount: request.amount,
        status: DisbursalStatus.PENDING,
        paymentChannel: paymentConfig.paymentChannel,
        transactionReference,
        recipientIdentifier,
      },
      include: {
        statusHistory: true,
      },
    });

    // Create initial status history entry
    await this.prisma.disbursalStatusHistory.create({
      data: {
        disbursalId: disbursal.id,
        status: DisbursalStatus.PENDING,
        metadata: {
          initiatedBy: 'system',
          claimAmount: request.amount,
        },
      },
    });

    this.logger.log(`Disbursal ${disbursal.id} created with status PENDING`);

    return disbursal;
  }

  /**
   * Process a pending disbursal by sending payment
   */
  async processDisbursement(disbursalId: string): Promise<void> {
    this.logger.log(`Processing disbursal ${disbursalId}`);

    const disbursal = await this.prisma.disbursal.findUnique({
      where: { id: disbursalId },
      include: {
        clinic: true,
      },
    });

    if (!disbursal) {
      throw new NotFoundException(`Disbursal ${disbursalId} not found`);
    }

    if (disbursal.status !== DisbursalStatus.PENDING) {
      throw new BadRequestException(
        `Disbursal ${disbursalId} is not in PENDING status`,
      );
    }

    // Update status to PROCESSING
    await this.updateDisbursalStatus(disbursalId, DisbursalStatus.PROCESSING, {
      processingStarted: new Date(),
    });

    try {
      // Get clinic payment config
      const paymentConfig = await this.getClinicPaymentConfig(
        disbursal.clinicId,
      );

      // Send payment based on channel
      let result: any;
      switch (paymentConfig.paymentChannel) {
        case PaymentChannel.MPESA_TILL:
          result = await this.sendMPesaTill(
            paymentConfig,
            disbursal.amount,
            disbursal.transactionReference,
          );
          break;
        case PaymentChannel.MPESA_PAYBILL:
          result = await this.sendMPesaPaybill(
            paymentConfig,
            disbursal.amount,
            disbursal.transactionReference,
          );
          break;
        case PaymentChannel.MPESA_MOBILE:
          result = await this.sendMPesaMobile(
            paymentConfig,
            disbursal.amount,
            disbursal.transactionReference,
          );
          break;
        case PaymentChannel.BANK_TRANSFER:
          result = await this.sendBankTransfer(
            paymentConfig,
            disbursal.amount,
            disbursal.transactionReference,
          );
          break;
        default:
          throw new BadRequestException(
            `Unsupported payment channel: ${paymentConfig.paymentChannel}`,
          );
      }

      // Update disbursal with SasaPay response
      await this.prisma.disbursal.update({
        where: { id: disbursalId },
        data: {
          sasaPayRequestId: result.requestId,
          sasaPayCheckoutId: result.checkoutId,
        },
      });

      this.logger.log(`Disbursal ${disbursalId} sent to SasaPay successfully`);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Disbursal ${disbursalId} failed: ${errorMessage}`);

      await this.updateDisbursalStatus(disbursalId, DisbursalStatus.FAILED, {
        error: errorMessage,
        failedAt: new Date(),
      });

      await this.prisma.disbursal.update({
        where: { id: disbursalId },
        data: {
          errorMessage,
        },
      });

      throw error;
    }
  }

  /**
   * Update disbursal status with history tracking
   */
  async updateDisbursalStatus(
    disbursalId: string,
    status: DisbursalStatus,
    metadata?: any,
  ): Promise<void> {
    this.logger.log(`Updating disbursal ${disbursalId} status to ${status}`);

    // Validate status transition
    const disbursal = await this.prisma.disbursal.findUnique({
      where: { id: disbursalId },
    });

    if (!disbursal) {
      throw new NotFoundException(`Disbursal ${disbursalId} not found`);
    }

    this.validateStatusTransition(disbursal.status, status);

    // Update disbursal status
    const updateData: Prisma.DisbursalUpdateInput = {
      status,
      updatedAt: new Date(),
    };

    if (status === DisbursalStatus.COMPLETED) {
      updateData.completedAt = new Date();
    } else if (status === DisbursalStatus.REVERSED) {
      updateData.reversedAt = new Date();
    }

    await this.prisma.disbursal.update({
      where: { id: disbursalId },
      data: updateData,
    });

    // Create status history entry
    await this.prisma.disbursalStatusHistory.create({
      data: {
        disbursalId,
        status,
        metadata,
      },
    });

    this.logger.log(`Disbursal ${disbursalId} status updated to ${status}`);
  }

  /**
   * Reverse a completed disbursal
   */
  async reverseDisbursement(
    disbursalId: string,
    reason: string,
  ): Promise<void> {
    this.logger.log(`Reversing disbursal ${disbursalId}`);

    const disbursal = await this.prisma.disbursal.findUnique({
      where: { id: disbursalId },
      include: {
        claim: {
          include: {
            member: {
              include: {
                subscription: true,
              },
            },
          },
        },
      },
    });

    if (!disbursal) {
      throw new NotFoundException(`Disbursal ${disbursalId} not found`);
    }

    if (disbursal.status !== DisbursalStatus.COMPLETED) {
      throw new BadRequestException(
        `Can only reverse completed disbursals. Current status: ${disbursal.status}`,
      );
    }

    // Update disbursal status to REVERSED
    await this.updateDisbursalStatus(disbursalId, DisbursalStatus.REVERSED, {
      reason,
      reversedBy: 'admin',
    });

    await this.prisma.disbursal.update({
      where: { id: disbursalId },
      data: {
        reversalReason: reason,
      },
    });

    // Restore member's claim limit
    if (disbursal.claim.member.subscription) {
      const subscription = disbursal.claim.member.subscription;
      const newUsed = Math.max(
        0,
        subscription.annualCapUsed - disbursal.amount,
      );

      await this.prisma.subscription.update({
        where: { id: subscription.id },
        data: {
          annualCapUsed: newUsed,
        },
      });

      this.logger.log(
        `Restored ${disbursal.amount} KES to member ${disbursal.claim.memberId} claim limit`,
      );
    }

    this.logger.log(`Disbursal ${disbursalId} reversed successfully`);
  }

  /**
   * Retry a failed disbursal
   */
  async retryDisbursement(disbursalId: string): Promise<void> {
    this.logger.log(`Retrying disbursal ${disbursalId}`);

    const disbursal = await this.prisma.disbursal.findUnique({
      where: { id: disbursalId },
    });

    if (!disbursal) {
      throw new NotFoundException(`Disbursal ${disbursalId} not found`);
    }

    if (disbursal.status !== DisbursalStatus.FAILED) {
      throw new BadRequestException(
        `Can only retry failed disbursals. Current status: ${disbursal.status}`,
      );
    }

    // Reset status to PENDING
    await this.updateDisbursalStatus(disbursalId, DisbursalStatus.PENDING, {
      retryAttempt: true,
      previousError: disbursal.errorMessage,
    });

    // Clear error message
    await this.prisma.disbursal.update({
      where: { id: disbursalId },
      data: {
        errorMessage: null,
      },
    });

    // Process the disbursal
    await this.processDisbursement(disbursalId);
  }

  /**
   * Get clinic payment configuration
   */
  async getClinicPaymentConfig(clinicId: string): Promise<ClinicPaymentConfig> {
    const config = await this.prisma.clinicPaymentConfig.findUnique({
      where: { clinicId },
    });

    if (!config) {
      throw new NotFoundException(
        `Payment configuration not found for clinic ${clinicId}`,
      );
    }

    return config;
  }

  /**
   * Send M-Pesa payment to Till Number
   */
  private async sendMPesaTill(
    config: ClinicPaymentConfig,
    amount: number,
    reference: string,
  ): Promise<any> {
    this.logger.log(
      `Sending M-Pesa Till payment: ${amount} KES to ${config.tillNumber}`,
    );

    if (!config.tillNumber) {
      throw new BadRequestException('Till number not configured');
    }

    // Use SasaPay B2C API with Till Number as account
    const result = await this.sasapay.sendMoney(
      config.tillNumber,
      amount,
      reference,
      `Clinic disbursal - ${reference}`,
    );

    if (!result.status) {
      throw new BadRequestException(`Payment failed: ${result.detail}`);
    }

    return {
      requestId: result.MerchantRequestID,
      checkoutId: result.CheckoutRequestID,
      status: 'PENDING',
    };
  }

  /**
   * Send M-Pesa payment to Paybill Number
   */
  private async sendMPesaPaybill(
    config: ClinicPaymentConfig,
    amount: number,
    reference: string,
  ): Promise<any> {
    this.logger.log(
      `Sending M-Pesa Paybill payment: ${amount} KES to ${config.paybillNumber}`,
    );

    if (!config.paybillNumber) {
      throw new BadRequestException('Paybill number not configured');
    }

    // Use SasaPay B2C API with Paybill Number as account
    const result = await this.sasapay.sendMoney(
      config.paybillNumber,
      amount,
      reference,
      `Clinic disbursal - ${reference}`,
    );

    if (!result.status) {
      throw new BadRequestException(`Payment failed: ${result.detail}`);
    }

    return {
      requestId: result.MerchantRequestID,
      checkoutId: result.CheckoutRequestID,
      status: 'PENDING',
    };
  }

  /**
   * Send M-Pesa payment to Mobile Number
   */
  private async sendMPesaMobile(
    config: ClinicPaymentConfig,
    amount: number,
    reference: string,
  ): Promise<any> {
    this.logger.log(
      `Sending M-Pesa Mobile payment: ${amount} KES to ${config.mobileNumber}`,
    );

    if (!config.mobileNumber) {
      throw new BadRequestException('Mobile number not configured');
    }

    // Use SasaPay B2C API with Mobile Number
    const result = await this.sasapay.sendMoney(
      config.mobileNumber,
      amount,
      reference,
      `Clinic disbursal - ${reference}`,
    );

    if (!result.status) {
      throw new BadRequestException(`Payment failed: ${result.detail}`);
    }

    return {
      requestId: result.MerchantRequestID,
      checkoutId: result.CheckoutRequestID,
      status: 'PENDING',
    };
  }

  /**
   * Send bank transfer payment
   */
  private async sendBankTransfer(
    config: ClinicPaymentConfig,
    amount: number,
    reference: string,
  ): Promise<any> {
    this.logger.log(
      `Sending bank transfer: ${amount} KES to ${config.bankAccountNumber}`,
    );

    if (
      !config.bankAccountNumber ||
      !config.bankName ||
      !config.bankBranchCode
    ) {
      throw new BadRequestException(
        'Bank account details not fully configured',
      );
    }

    // Use SasaPay B2C API with bank account number
    // Note: SasaPay B2C API supports bank transfers via account number
    const result = await this.sasapay.sendMoney(
      config.bankAccountNumber,
      amount,
      reference,
      `Clinic disbursal to ${config.bankName} - ${reference}`,
    );

    if (!result.status) {
      throw new BadRequestException(`Bank transfer failed: ${result.detail}`);
    }

    return {
      requestId: result.MerchantRequestID,
      checkoutId: result.CheckoutRequestID,
      status: 'PENDING',
    };
  }

  /**
   * Get recipient identifier based on payment channel
   */
  private getRecipientIdentifier(config: ClinicPaymentConfig): string {
    switch (config.paymentChannel) {
      case PaymentChannel.MPESA_TILL:
        return config.tillNumber || '';
      case PaymentChannel.MPESA_PAYBILL:
        return config.paybillNumber || '';
      case PaymentChannel.MPESA_MOBILE:
        return config.mobileNumber || '';
      case PaymentChannel.BANK_TRANSFER:
        return config.bankAccountNumber || '';
      default:
        throw new BadRequestException(
          `Unknown payment channel: ${config.paymentChannel}`,
        );
    }
  }

  /**
   * Validate status transition
   */
  private validateStatusTransition(
    currentStatus: DisbursalStatus,
    newStatus: DisbursalStatus,
  ): void {
    const validTransitions: Record<DisbursalStatus, DisbursalStatus[]> = {
      [DisbursalStatus.PENDING]: [
        DisbursalStatus.PROCESSING,
        DisbursalStatus.FAILED,
      ],
      [DisbursalStatus.PROCESSING]: [
        DisbursalStatus.COMPLETED,
        DisbursalStatus.FAILED,
      ],
      [DisbursalStatus.COMPLETED]: [DisbursalStatus.REVERSED],
      [DisbursalStatus.FAILED]: [DisbursalStatus.PENDING], // For retry
      [DisbursalStatus.REVERSED]: [], // Terminal state
    };

    const allowedTransitions = validTransitions[currentStatus] || [];

    if (!allowedTransitions.includes(newStatus)) {
      throw new BadRequestException(
        `Invalid status transition from ${currentStatus} to ${newStatus}`,
      );
    }
  }
}
