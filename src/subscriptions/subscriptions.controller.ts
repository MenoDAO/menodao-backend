import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  Request,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request as ExpressRequest } from 'express';

interface RequestWithUser extends ExpressRequest {
  user: {
    id: string;
    email?: string;
  };
}
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { SubscriptionsService } from './subscriptions.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SubscribeDto } from './dto/subscribe.dto';
import { UpgradeDto } from './dto/upgrade.dto';

@ApiTags('Subscriptions')
@Controller('subscriptions')
export class SubscriptionsController {
  constructor(
    private subscriptionsService: SubscriptionsService,
    private configService: ConfigService,
  ) {}

  @Get('packages')
  @ApiOperation({ summary: 'Get available packages with pricing and benefits' })
  getPackages() {
    return this.subscriptionsService.getPackages();
  }

  @Get('current')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current member subscription' })
  async getCurrent(@Request() req: RequestWithUser) {
    return this.subscriptionsService.getSubscription(req.user.id);
  }

  @Post('subscribe')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Subscribe to a package' })
  async subscribe(@Request() req: RequestWithUser, @Body() dto: SubscribeDto) {
    return this.subscriptionsService.subscribe(req.user.id, dto.tier);
  }

  @Post('upgrade')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Upgrade to a higher tier package' })
  async upgrade(@Request() req: RequestWithUser, @Body() dto: UpgradeDto) {
    return this.subscriptionsService.upgrade(req.user.id, dto.newTier);
  }

  @Post('admin/deactivate-unpaid')
  @ApiOperation({ summary: 'Admin: Deactivate all unpaid subscriptions' })
  @ApiQuery({ name: 'adminKey', required: true, description: 'Admin API key' })
  async deactivateUnpaid(@Query('adminKey') adminKey: string) {
    // Simple admin key check
    const expectedKey = this.configService.get('ADMIN_API_KEY');
    if (!expectedKey || adminKey !== expectedKey) {
      throw new UnauthorizedException('Invalid admin key');
    }

    return this.subscriptionsService.deactivateUnpaidSubscriptions();
  }

  @Post('dev/mock-payment')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: '[DEV ONLY] Mock a successful payment to activate subscription',
  })
  async mockPayment(@Request() req: ExpressRequest, @Body() dto: SubscribeDto) {
    const userId = (req as any).user?.id;
    return this.subscriptionsService.mockPaymentAndActivate(userId, dto.tier);
  }
}
