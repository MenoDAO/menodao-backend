import { Controller, Post, Get, Body, Query, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiBody, ApiQuery } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminAuthGuard } from '../admin/guards/admin-auth.guard';

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
        platform: { type: 'string', enum: ['web', 'android', 'ios'], description: 'Device platform' },
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
    @Body() body: { title: string; body: string; data?: Record<string, string> },
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
