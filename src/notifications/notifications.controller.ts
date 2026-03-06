import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiBody,
  ApiQuery,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminAuthGuard } from '../admin/guards/admin-auth.guard';
import { NotificationHistoryParams } from './dto/notification-history-params.dto';
import { RecipientFilters } from './dto/recipient-filters.dto';
import { SendRequest } from './dto/send-request.dto';

@ApiTags('Notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(private notificationsService: NotificationsService) {}

  @Post('register')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Register device token for push notifications' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        token: { type: 'string', description: 'FCM device token' },
        platform: {
          type: 'string',
          enum: ['web', 'android', 'ios'],
          description: 'Device platform',
        },
      },
      required: ['token', 'platform'],
    },
  })
  async registerToken(
    @Request() req,
    @Body() body: { token: string; platform: string },
  ) {
    return this.notificationsService.registerDeviceToken(
      req.user.id,
      body.token,
      body.platform,
    );
  }

  @Post('unregister')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Remove device token' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        token: { type: 'string', description: 'FCM device token to remove' },
      },
      required: ['token'],
    },
  })
  async unregisterToken(@Body() body: { token: string }) {
    return this.notificationsService.removeDeviceToken(body.token);
  }
}

@ApiTags('Admin - Alerts')
@Controller('admin/alerts')
@UseGuards(AdminAuthGuard)
@ApiBearerAuth()
export class AlertsController {
  constructor(private notificationsService: NotificationsService) {}

  @Post('send')
  @ApiOperation({ summary: 'Send push notification to all users' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Notification title' },
        body: { type: 'string', description: 'Notification body' },
        data: { type: 'object', description: 'Optional custom data' },
      },
      required: ['title', 'body'],
    },
  })
  async sendNotification(
    @Request() req,
    @Body()
    body: { title: string; body: string; data?: Record<string, string> },
  ) {
    return this.notificationsService.sendToAll(
      body.title,
      body.body,
      body.data,
      req.admin.username,
    );
  }

  @Get('history')
  @ApiOperation({ summary: 'Get notification history' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async getHistory(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.notificationsService.getHistory(
      Number(page) || 1,
      Number(limit) || 20,
    );
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get device token statistics' })
  async getStats() {
    return this.notificationsService.getDeviceStats();
  }
}

/**
 * Admin Notification Controller
 * Handles admin notification system endpoints with authentication and rate limiting
 * Requirements: 7.1, 7.2, 7.3
 */
@ApiTags('Admin - Notifications')
@Controller('admin/notifications')
@UseGuards(AdminAuthGuard)
@ApiBearerAuth()
export class AdminNotificationController {
  constructor(private notificationsService: NotificationsService) {}

  /**
   * Get SMS statistics (today count and all-time count)
   * Requirements: 1.1, 1.2, 5.3
   */
  @Get('sms-stats')
  @ApiOperation({ summary: 'Get SMS usage statistics' })
  async getSMSStats() {
    return this.notificationsService.getSMSStats();
  }

  /**
   * Get notification history with pagination and filters
   * Requirements: 2.1, 5.2
   */
  @Get('history')
  @ApiOperation({ summary: 'Get notification history with pagination' })
  @ApiQuery({ name: 'page', required: true, type: Number })
  @ApiQuery({ name: 'pageSize', required: true, type: Number })
  @ApiQuery({ name: 'type', required: false, enum: ['SMS', 'PUSH'] })
  @ApiQuery({ name: 'status', required: false, type: String })
  @ApiQuery({ name: 'dateFrom', required: false, type: Date })
  @ApiQuery({ name: 'dateTo', required: false, type: Date })
  async getHistory(@Query() params: NotificationHistoryParams) {
    return this.notificationsService.getNotificationHistory(params);
  }

  /**
   * Preview recipient count for given filters
   * Requirements: 3.8, 5.4
   */
  @Post('preview')
  @ApiOperation({ summary: 'Preview recipient count for filters' })
  @ApiBody({ type: RecipientFilters })
  async previewRecipients(@Body() filters: RecipientFilters) {
    return this.notificationsService.previewRecipients(filters);
  }

  /**
   * Send notification to filtered recipients
   * Rate limited to 10 requests per hour per admin
   * Requirements: 3.11, 5.1, 5.4, 7.3
   */
  @Post('send')
  @Throttle({ default: { limit: 10, ttl: 3600000 } }) // 10 per hour
  @ApiOperation({ summary: 'Send notification to filtered recipients' })
  @ApiBody({ type: SendRequest })
  async sendNotification(
    @Request() req: { admin: { id: string } },
    @Body() request: SendRequest,
  ) {
    return this.notificationsService.sendNotification(request, req.admin.id);
  }
}
