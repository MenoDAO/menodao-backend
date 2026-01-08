import { Controller, Get, Post, Body, UseGuards, Request, Query, UnauthorizedException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
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
  async getCurrent(@Request() req) {
    return this.subscriptionsService.getSubscription(req.user.id);
  }

  @Post('subscribe')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Subscribe to a package' })
  async subscribe(@Request() req, @Body() dto: SubscribeDto) {
    return this.subscriptionsService.subscribe(req.user.id, dto.tier);
  }

  @Post('upgrade')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Upgrade to a higher tier package' })
  async upgrade(@Request() req, @Body() dto: UpgradeDto) {
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
}
