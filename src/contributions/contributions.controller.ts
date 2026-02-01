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

@ApiTags('Contributions')
@Controller('contributions')
export class ContributionsController {
  private readonly logger = new Logger(ContributionsController.name);

  constructor(private contributionsService: ContributionsService) {}

  @Get('summary')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get contribution summary for current member' })
  async getSummary(@Request() req) {
    return this.contributionsService.getSummary(req.user.id);
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
  async initiatePayment(@Request() req, @Body() dto: InitiatePaymentDto) {
    return this.contributionsService.initiatePayment(
      req.user.id,
      dto.amount,
      'MPESA',
      dto.phoneNumber,
    );
  }

  @Get('status/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Check payment status for a contribution' })
  async checkStatus(@Request() req, @Param('id') id: string) {
    return this.contributionsService.checkPaymentStatus(id, req.user.id);
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
    this.logger.log('Callback request received');
    const result =
      await this.contributionsService.handlePaymentCallback(payload);

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
