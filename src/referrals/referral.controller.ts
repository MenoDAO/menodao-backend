import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
  Request,
  ParseIntPipe,
  DefaultValuePipe,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ReferralService } from './referral.service';

class WithdrawDto {
  amount: number;
}

@ApiTags('Referrals')
@Controller('referrals')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class ReferralController {
  constructor(private readonly referralService: ReferralService) {}

  @Get('my-stats')
  @ApiOperation({ summary: 'Get champion stats for the authenticated member' })
  async getMyStats(@Request() req) {
    return this.referralService.getChampionStats(req.user.id);
  }

  @Get('my-referrals')
  @ApiOperation({ summary: 'Get paginated list of referrals' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async getMyReferrals(
    @Request() req,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
  ) {
    return this.referralService.getChampionReferrals(req.user.id, page, limit);
  }

  @Get('withdrawals')
  @ApiOperation({
    summary: 'Get withdrawal history for the authenticated champion',
  })
  async getWithdrawals(@Request() req) {
    return this.referralService.getWithdrawalHistory(req.user.id);
  }

  @Post('withdraw')
  @ApiOperation({ summary: 'Request a commission withdrawal' })
  async withdraw(@Request() req, @Body() body: WithdrawDto) {
    if (!body.amount || body.amount <= 0) {
      throw new BadRequestException('Withdrawal amount must be greater than 0');
    }
    return this.referralService.requestWithdrawal(req.user.id, body.amount);
  }
}
