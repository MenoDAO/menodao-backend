import { Controller, Get, Post, Body, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ContributionsService } from './contributions.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { InitiatePaymentDto } from './dto/initiate-payment.dto';

@ApiTags('Contributions')
@Controller('contributions')
export class ContributionsController {
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
  @ApiOperation({ summary: 'Initiate a contribution payment' })
  async initiatePayment(@Request() req, @Body() dto: InitiatePaymentDto) {
    return this.contributionsService.initiatePayment(
      req.user.id,
      dto.amount,
      dto.paymentMethod,
    );
  }

  @Post('webhook')
  @ApiOperation({ summary: 'Payment provider webhook callback' })
  async handleWebhook(@Body() payload: any) {
    return this.contributionsService.handlePaymentWebhook(payload);
  }
}
