import { Controller, Get, Post, Body, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SubscriptionsService } from './subscriptions.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SubscribeDto } from './dto/subscribe.dto';
import { UpgradeDto } from './dto/upgrade.dto';

@ApiTags('Subscriptions')
@Controller('subscriptions')
export class SubscriptionsController {
  constructor(private subscriptionsService: SubscriptionsService) {}

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
}
