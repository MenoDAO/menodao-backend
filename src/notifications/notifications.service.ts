import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import * as admin from 'firebase-admin';

@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly logger = new Logger(NotificationsService.name);
  private firebaseApp: admin.app.App | null = null;
  private isFirebaseConfigured = false;

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {}

  async onModuleInit() {
    await this.initializeFirebase();
  }

  private async initializeFirebase() {
    const projectId = this.configService.get<string>('FIREBASE_PROJECT_ID');
    const privateKey = this.configService.get<string>('FIREBASE_PRIVATE_KEY');
    const clientEmail = this.configService.get<string>('FIREBASE_CLIENT_EMAIL');

    if (!projectId || !privateKey || !clientEmail) {
      this.logger.warn(
        'Firebase credentials not configured. Push notifications disabled.',
      );
      return;
    }

    try {
      // Parse the private key (handle escaped newlines)
      const parsedPrivateKey = privateKey.replace(/\\n/g, '\n');

      this.firebaseApp = admin.initializeApp({
        credential: admin.credential.cert({
          projectId,
          privateKey: parsedPrivateKey,
          clientEmail,
        }),
      });

      this.isFirebaseConfigured = true;
      this.logger.log('Firebase initialized successfully');
    } catch (error) {
      this.logger.error(`Failed to initialize Firebase: ${error.message}`);
    }
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
   * Send push notification to all registered devices
   */
  async sendToAll(
    title: string,
    body: string,
    data?: Record<string, string>,
    adminUsername?: string,
  ): Promise<{ success: boolean; sentTo: number; errors: number }> {
    if (!this.isFirebaseConfigured) {
      this.logger.warn('Firebase not configured, skipping push notification');

      // Still log the notification attempt
      await this.prisma.notification.create({
        data: {
          title,
          body,
          data: data || {},
          sentTo: 0,
          sentBy: adminUsername || 'system',
        },
      });

      return { success: false, sentTo: 0, errors: 0 };
    }

    // Get all device tokens
    const deviceTokens = await this.prisma.deviceToken.findMany({
      select: { token: true },
    });

    if (deviceTokens.length === 0) {
      this.logger.log('No device tokens registered');

      await this.prisma.notification.create({
        data: {
          title,
          body,
          data: data || {},
          sentTo: 0,
          sentBy: adminUsername || 'system',
        },
      });

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

    // Log notification
    await this.prisma.notification.create({
      data: {
        title,
        body,
        data: data || {},
        sentTo: successCount,
        sentBy: adminUsername || 'system',
      },
    });

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
    if (!this.isFirebaseConfigured) {
      this.logger.warn('Firebase not configured, skipping push notification');
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
