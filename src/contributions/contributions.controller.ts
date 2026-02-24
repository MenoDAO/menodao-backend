import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  Request,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiBody } from '@nestjs/swagger';
import { ContributionsService } from './contributions.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { InitiatePaymentDto } from './dto/initiate-payment.dto';
import { ClaimsService } from '../claims/claims.service';
import {
  SasaPayC2BCallbackData,
  SasaPayB2CCallbackData,
} from '../sasapay/sasapay.service';

@ApiTags('Contributions')
@Controller('contributions')
export class ContributionsController {
  private readonly logger = new Logger(ContributionsController.name);

  constructor(
    private contributionsService: ContributionsService,
    private claimsService: ClaimsService,
  ) {}

  @Get('summary')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get contribution summary for current member' })
  async getSummary(@Request() req: any) {
    const user = req.user as { id: string };
    return this.contributionsService.getSummary(user.id);
  }

  @Post('pay')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Initiate a contribution payment via M-Pesa' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        amount: { type: 'number', example: 700, description: 'Amount in KES' },
        phoneNumber: {
          type: 'string',
          example: '0712345678',
          description:
            'M-Pesa phone number (optional, defaults to member phone)',
        },
      },
      required: ['amount'],
    },
  })
  async initiatePayment(@Request() req: any, @Body() dto: InitiatePaymentDto) {
    const user = req.user as { id: string };
    return this.contributionsService.initiatePayment(
      user.id,
      dto.amount,
      'MPESA',
      dto.phoneNumber,
    );
  }

  @Get('status/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Check payment status for a contribution' })
  async checkStatus(@Request() req: any, @Param('id') id: string) {
    const user = req.user as { id: string };
    return this.contributionsService.checkPaymentStatus(id, user.id);
  }

  @Post('validation')
  @ApiOperation({
    summary: 'Payment validation endpoint (called by payment provider)',
  })
  async handleValidation(@Body() payload: any) {
    this.logger.log('Validation request received');
    const result = await this.contributionsService.validatePayment(payload);

    // Return format expected by Rift/M-Pesa
    return {
      ResultCode: result.valid ? '0' : '1',
      ResultDesc: result.message,
    };
  }

  @Post('callback')
  @ApiOperation({
    summary: 'Payment confirmation callback (called by payment provider)',
  })
  async handleCallback(@Body() payload: any) {
    this.logger.log('SasaPay callback received');

    // Distinguish between C2B (STK Push) and B2C/B2B (Disbursal)
    // C2B usually has CustomerMobile or TransAmount
    // B2C/B2B usually has RecipientAccountNumber or ReceiverPhoneNumber
    const isB2C = !!(
      payload.RecipientAccountNumber ||
      payload.ReceiverPhoneNumber ||
      payload.TransactionAmount
    );

    if (isB2C) {
      this.logger.log('Routing to ClaimsService (B2C/B2B)');
      const result = await this.claimsService.handleDisbursalCallback(
        payload as SasaPayB2CCallbackData,
      );
      return {
        ResultCode: result.success ? '0' : '1',
        ResultDesc: result.message,
      };
    }

    // Default to C2B
    this.logger.log('Routing to ContributionsService (C2B)');
    const result = await this.contributionsService.handlePaymentCallback(
      payload as SasaPayC2BCallbackData,
    );

    return {
      ResultCode: result.success ? '0' : '1',
      ResultDesc: result.message,
    };
  }

  @Post('webhook')
  @ApiOperation({
    summary: 'Legacy payment webhook (deprecated, use /callback)',
  })
  async handleWebhook(@Body() payload: any) {
    return this.contributionsService.handlePaymentWebhook(payload);
  }
}
