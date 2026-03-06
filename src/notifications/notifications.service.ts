import {
  Injectable,
  Logger,
  OnModuleInit,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { FilterService } from './filter.service';
import { SanitizationService } from './sanitization.service';
import { NotificationType, NotificationStatus, Prisma } from '@prisma/client';
import * as admin from 'firebase-admin';
import { SMSStatsResponse } from './dto/sms-stats-response.dto';
import { NotificationHistoryParams } from './dto/notification-history-params.dto';
import { HistoryResponse } from './dto/history-response.dto';
import { PreviewResponse } from './dto/preview-response.dto';
import { SendRequest } from './dto/send-request.dto';
import { SendResponse } from './dto/send-response.dto';
import { RecipientFilters } from './dto/recipient-filters.dto';
import { SMSService } from './sms.service';
import { PushService } from './push.service';

@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
    private filterService: FilterService,
    private sanitizationService: SanitizationService,
    private smsService: SMSService,
    private pushService: PushService,
  ) {}

  async onModuleInit() {
    // Services initialize themselves
    this.logger.log('NotificationsService initialized');
  }

  /**
   * Calculate SMS statistics
   * Requirements: 1.1, 1.2, 1.4, 5.6
   */
  async getSMSStats(): Promise<SMSStatsResponse> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [todayCount, allTimeCount] = await Promise.all([
      this.prisma.notification.count({
        where: {
          type: NotificationType.SMS,
          sentAt: {
            gte: today,
          },
        },
      }),
      this.prisma.notification.count({
        where: {
          type: NotificationType.SMS,
        },
      }),
    ]);

    return {
      todayCount,
      allTimeCount,
    };
  }

  /**
   * Retrieve notification history with pagination
   * Requirements: 2.1, 2.2, 2.6, 5.5
   */
  async getNotificationHistory(
    params: NotificationHistoryParams,
  ): Promise<HistoryResponse> {
    const { page, pageSize, type, status, dateFrom, dateTo } = params;
    const skip = (page - 1) * pageSize;

    // Build where clause
    const where: Prisma.NotificationWhereInput = {};

    if (type) {
      where.type = type;
    }

    if (status) {
      where.status = status;
    }

    if (dateFrom || dateTo) {
      where.sentAt = {};
      if (dateFrom) {
        where.sentAt.gte = dateFrom;
      }
      if (dateTo) {
        where.sentAt.lte = dateTo;
      }
    }

    const [notifications, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { sentAt: 'desc' },
        include: {
          sentByAdmin: {
            select: {
              username: true,
            },
          },
        },
      }),
      this.prisma.notification.count({ where }),
    ]);

    return {
      notifications: notifications.map((n) => ({
        id: n.id,
        type: n.type,
        recipientCount: n.recipientCount,
        message: n.message,
        status: n.status,
        deliveryStats: {
          successCount: n.successCount,
          failureCount: n.failureCount,
        },
        sentAt: n.sentAt,
        sentBy: n.sentByAdmin.username,
      })),
      total,
      page,
      pageSize,
    };
  }

  /**
   * Preview recipient count for filters
   * Requirements: 3.8
   */
  async previewRecipients(filters: RecipientFilters): Promise<PreviewResponse> {
    const count = await this.filterService.countFilteredRecipients(filters);
    return { count };
  }

  /**
   * Send notification to filtered recipients
   * Requirements: 3.11, 4.7, 4.8, 6.6, 6.7
   */
  async sendNotification(
    request: SendRequest,
    adminId: string,
  ): Promise<SendResponse> {
    const { type, filters, message } = request;

    // Validate message
    if (!message || message.trim().length === 0) {
      throw new BadRequestException('Message cannot be empty');
    }

    // Get recipient list
    const recipients = await this.filterService.getFilteredRecipients(filters);

    if (recipients.length === 0) {
      throw new BadRequestException(
        'No recipients match the specified filters',
      );
    }

    // Sanitize message for storage
    const sanitizedMessage = this.sanitizationService.sanitizeMessage(message);

    // Create notification record
    const notification = await this.prisma.notification.create({
      data: {
        type,
        recipientCount: recipients.length,
        message: sanitizedMessage,
        status: NotificationStatus.PENDING,
        sentBy: adminId,
        filterCriteria: filters as Prisma.InputJsonValue,
      },
    });

    // Send notifications asynchronously
    this.sendToRecipients(notification.id, type, recipients, message).catch(
      (error) => {
        this.logger.error(
          `Failed to send notifications for ${notification.id}: ${error.message}`,
        );
      },
    );

    return {
      success: true,
      notificationId: notification.id,
      recipientCount: recipients.length,
    };
  }

  /**
   * Send notifications to recipients (internal method)
   */
  private async sendToRecipients(
    notificationId: string,
    type: NotificationType,
    recipients: string[],
    message: string,
  ): Promise<void> {
    let successCount = 0;
    let failureCount = 0;

    // Update status to SENT
    await this.prisma.notification.update({
      where: { id: notificationId },
      data: { status: NotificationStatus.SENT },
    });

    if (type === NotificationType.SMS) {
      // Send SMS to each recipient using SMS service
      for (const phoneNumber of recipients) {
        try {
          const result = await this.smsService.sendSMS(phoneNumber, message);
          if (result.success) {
            successCount++;
          } else {
            this.logger.error(
              `Failed to send SMS to ${phoneNumber}: ${result.error}`,
            );
            failureCount++;
          }
        } catch (error) {
          this.logger.error(
            `Failed to send SMS to ${phoneNumber}: ${error.message}`,
          );
          failureCount++;
        }
      }
    } else if (type === NotificationType.PUSH) {
      // Send push notifications using Push service
      try {
        const result = await this.pushService.sendPush(recipients, message);
        successCount = result.successCount;
        failureCount = result.failureCount;
      } catch (error) {
        this.logger.error(
          `Failed to send push notifications: ${error.message}`,
        );
        failureCount = recipients.length;
      }
    }

    // Update delivery stats and final status
    const finalStatus = this.determineFinalStatus(
      successCount,
      failureCount,
      recipients.length,
    );

    await this.prisma.notification.update({
      where: { id: notificationId },
      data: {
        successCount,
        failureCount,
        status: finalStatus,
      },
    });
  }

  /**
   * Determine final notification status based on delivery results
   */
  private determineFinalStatus(
    successCount: number,
    failureCount: number,
    totalCount: number,
  ): NotificationStatus {
    if (successCount === totalCount) {
      return NotificationStatus.DELIVERED;
    } else if (failureCount === totalCount) {
      return NotificationStatus.FAILED;
    } else {
      return NotificationStatus.PARTIAL;
    }
  }

  /**
   * Update delivery status for a notification
   * Requirements: 9.1, 9.2, 9.3, 9.4, 9.5
   */
  async updateDeliveryStatus(
    notificationId: string,
    recipientPhone: string,
    status: 'delivered' | 'failed',
  ): Promise<void> {
    const notification = await this.prisma.notification.findUnique({
      where: { id: notificationId },
    });

    if (!notification) {
      throw new BadRequestException('Notification not found');
    }

    // Update counts
    const updateData: Prisma.NotificationUpdateInput = {};

    if (status === 'delivered') {
      updateData.successCount = { increment: 1 };
    } else {
      updateData.failureCount = { increment: 1 };
    }

    // Check if all deliveries are complete
    const newSuccessCount =
      notification.successCount + (status === 'delivered' ? 1 : 0);
    const newFailureCount =
      notification.failureCount + (status === 'failed' ? 1 : 0);

    if (newSuccessCount + newFailureCount === notification.recipientCount) {
      updateData.status = this.determineFinalStatus(
        newSuccessCount,
        newFailureCount,
        notification.recipientCount,
      );
    }

    await this.prisma.notification.update({
      where: { id: notificationId },
      data: updateData,
    });
  }

  /**
   * Register a device token for push notifications
   */
  async registerDeviceToken(memberId: string, token: string, platform: string) {
    // Check if token already exists
    const existing = await this.prisma.deviceToken.findUnique({
      where: { token },
    });

    if (existing) {
      // Update if owned by different member
      if (existing.memberId !== memberId) {
        await this.prisma.deviceToken.update({
          where: { token },
          data: { memberId, platform },
        });
      }
      return { success: true, message: 'Token updated' };
    }

    // Create new token
    await this.prisma.deviceToken.create({
      data: {
        memberId,
        token,
        platform,
      },
    });

    this.logger.log(`Device token registered for member ${memberId}`);
    return { success: true, message: 'Token registered' };
  }

  /**
   * Remove a device token
   */
  async removeDeviceToken(token: string) {
    await this.prisma.deviceToken.deleteMany({
      where: { token },
    });
    return { success: true };
  }

  /**
   * Send push notification to all registered devices (legacy method)
   * Note: This method does not create a Notification record in the new schema
   */
  async sendToAll(
    title: string,
    body: string,
    data?: Record<string, string>,
    adminUsername?: string,
  ): Promise<{ success: boolean; sentTo: number; errors: number }> {
    if (!this.pushService.isReady()) {
      this.logger.warn(
        'Push service not configured, skipping push notification',
      );
      return { success: false, sentTo: 0, errors: 0 };
    }

    // Get all device tokens
    const deviceTokens = await this.prisma.deviceToken.findMany({
      select: { token: true },
    });

    if (deviceTokens.length === 0) {
      this.logger.log('No device tokens registered');
      return { success: true, sentTo: 0, errors: 0 };
    }

    const tokens = deviceTokens.map((d) => d.token);
    let successCount = 0;
    let errorCount = 0;

    // Send in batches of 500 (FCM limit)
    const batchSize = 500;
    for (let i = 0; i < tokens.length; i += batchSize) {
      const batch = tokens.slice(i, i + batchSize);

      try {
        const response = await admin.messaging().sendEachForMulticast({
          tokens: batch,
          notification: { title, body },
          data: data || {},
          webpush: {
            fcmOptions: {
              link: 'https://app.menodao.org',
            },
          },
        });

        successCount += response.successCount;
        errorCount += response.failureCount;

        // Remove invalid tokens
        response.responses.forEach((resp, idx) => {
          if (
            !resp.success &&
            resp.error?.code === 'messaging/registration-token-not-registered'
          ) {
            this.removeDeviceToken(batch[idx]).catch(() => {});
          }
        });
      } catch (error) {
        this.logger.error(`FCM batch send error: ${error.message}`);
        errorCount += batch.length;
      }
    }

    this.logger.log(
      `Push notification sent: ${successCount} success, ${errorCount} failed`,
    );
    return { success: true, sentTo: successCount, errors: errorCount };
  }

  /**
   * Send push notification to specific member
   */
  async sendToMember(
    memberId: string,
    title: string,
    body: string,
    data?: Record<string, string>,
  ): Promise<{ success: boolean; sentTo: number }> {
    if (!this.pushService.isReady()) {
      this.logger.warn(
        'Push service not configured, skipping push notification',
      );
      return { success: false, sentTo: 0 };
    }

    const deviceTokens = await this.prisma.deviceToken.findMany({
      where: { memberId },
      select: { token: true },
    });

    if (deviceTokens.length === 0) {
      return { success: true, sentTo: 0 };
    }

    const tokens = deviceTokens.map((d) => d.token);

    try {
      const response = await admin.messaging().sendEachForMulticast({
        tokens,
        notification: { title, body },
        data: data || {},
      });

      return { success: true, sentTo: response.successCount };
    } catch (error) {
      this.logger.error(`FCM send error: ${error.message}`);
      return { success: false, sentTo: 0 };
    }
  }

  /**
   * Get notification history
   */
  async getHistory(page = 1, limit = 20) {
    const skip = (page - 1) * limit;

    const [notifications, total] = await Promise.all([
      this.prisma.notification.findMany({
        skip,
        take: limit,
        orderBy: { sentAt: 'desc' },
      }),
      this.prisma.notification.count(),
    ]);

    return {
      data: notifications,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get device token stats
   */
  async getDeviceStats() {
    const stats = await this.prisma.deviceToken.groupBy({
      by: ['platform'],
      _count: true,
    });

    return stats.map((s) => ({
      platform: s.platform,
      count: s._count,
    }));
  }
}
