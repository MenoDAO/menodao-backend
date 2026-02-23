import { Controller, Get, UseGuards, Query } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { StatsService } from './stats.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { AdminAuthGuard } from './guards/admin-auth.guard';

@ApiTags('Admin - Stats')
@Controller('admin/stats')
@UseGuards(AdminAuthGuard)
@ApiBearerAuth()
export class StatsController {
  constructor(
    private statsService: StatsService,
    private analyticsService: AnalyticsService,
  ) {}

  @Get('overview')
  @ApiOperation({ summary: 'Get dashboard overview statistics' })
  async getOverview() {
    return this.statsService.getOverview();
  }

  @Get('users')
  @ApiOperation({ summary: 'Get detailed user statistics' })
  async getUserStats() {
    return this.statsService.getUserStats();
  }

  @Get('payments')
  @ApiOperation({ summary: 'Get detailed payment statistics' })
  async getPaymentStats() {
    return this.statsService.getPaymentStats();
  }

  @Get('technical')
  @ApiOperation({ summary: 'Get technical statistics (SMS, blockchain, etc.)' })
  async getTechnicalStats() {
    return this.statsService.getTechnicalStats();
  }

  @Get('recent-signups')
  @ApiOperation({ summary: 'Get recent member signups' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async getRecentSignups(@Query('limit') limit?: number) {
    return this.statsService.getRecentSignups(limit || 10);
  }

  @Get('recent-payments')
  @ApiOperation({ summary: 'Get recent payments' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async getRecentPayments(@Query('limit') limit?: number) {
    return this.statsService.getRecentPayments(limit || 10);
  }

  @Get('site-visits')
  @ApiOperation({ summary: 'Get site visit analytics metrics' })
  @ApiQuery({ name: 'days', required: false, type: Number })
  async getSiteVisits(@Query('days') days?: number) {
    return this.analyticsService.getMetrics(days || 30);
  }
}
