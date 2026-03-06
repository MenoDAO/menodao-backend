import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';
import { PrismaService } from '../prisma/prisma.service';

export interface PushDeliveryResult {
  success: boolean;
  successCount: number;
  failureCount: number;
  error?: string;
  timestamp: Date;
}

export interface PushProvider {
  sendPush(
    phoneNumbers: string[],
    message: string,
  ): Promise<PushDeliveryResult>;
}

/**
 * Mock Push Provider for development and testing
 * Logs push notifications without actually sending them
 */
class MockPushProvider implements PushProvider {
  private readonly logger = new Logger('MockPushProvider');

  async sendPush(
    phoneNumbers: string[],
    message: string,
  ): Promise<PushDeliveryResult> {
    this.logger.log(
      `[MOCK PUSH] To: ${phoneNumbers.length} recipients, Message: ${message}`,
    );

    // Simulate network delay
    await new Promise((resolve) => setTimeout(resolve, 100));

    return {
      success: true,
      successCount: phoneNumbers.length,
      failureCount: 0,
      timestamp: new Date(),
    };
  }
}

/**
 * Firebase Cloud Messaging Push Provider
 * Integrates with Firebase for actual push notification delivery
 */
class FirebasePushProvider implements PushProvider {
  private readonly logger = new Logger('FirebasePushProvider');
  private firebaseApp: admin.app.App;

  constructor(
    projectId: string,
    privateKey: string,
    clientEmail: string,
    private prisma: PrismaService,
  ) {
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

      this.logger.log('Firebase push provider initialized');
    } catch (error) {
      this.logger.error('Failed to initialize Firebase client');
      throw error;
    }
  }

  async sendPush(
    phoneNumbers: string[],
    message: string,
  ): Promise<PushDeliveryResult> {
    try {
      // Get device tokens for these phone numbers
      const members = await this.prisma.member.findMany({
        where: {
          phoneNumber: { in: phoneNumbers },
        },
        select: {
          id: true,
        },
      });

      const memberIds = members.map((m) => m.id);

      const deviceTokens = await this.prisma.deviceToken.findMany({
        where: {
          memberId: { in: memberIds },
        },
        select: { token: true },
      });

      if (deviceTokens.length === 0) {
        this.logger.warn('No device tokens found for recipients');
        return {
          success: true,
          successCount: 0,
          failureCount: phoneNumbers.length,
          timestamp: new Date(),
        };
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
            notification: {
              title: 'Notification',
              body: message,
            },
          });

          successCount += response.successCount;
          errorCount += response.failureCount;

          this.logger.log(
            `FCM batch sent: ${response.successCount} success, ${response.failureCount} failed`,
          );
        } catch (error) {
          this.logger.error(`FCM batch send error: ${error.message}`);
          errorCount += batch.length;
        }
      }

      return {
        success: true,
        successCount,
        failureCount: errorCount,
        timestamp: new Date(),
      };
    } catch (error) {
      this.logger.error(`Push notification error: ${error.message}`);
      return {
        success: false,
        successCount: 0,
        failureCount: phoneNumbers.length,
        error: error.message,
        timestamp: new Date(),
      };
    }
  }
}

/**
 * Push Notification Service
 * Handles push notification delivery with support for multiple providers
 * Requirements: 3.11
 */
@Injectable()
export class PushService implements OnModuleInit {
  private readonly logger = new Logger(PushService.name);
  private provider: PushProvider;
  private isConfigured = false;

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {}

  async onModuleInit() {
    this.initializeProvider();
  }

  private initializeProvider(): void {
    const projectId = this.configService.get<string>('FIREBASE_PROJECT_ID');
    const privateKey = this.configService.get<string>('FIREBASE_PRIVATE_KEY');
    const clientEmail = this.configService.get<string>('FIREBASE_CLIENT_EMAIL');

    if (!projectId || !privateKey || !clientEmail) {
      this.logger.warn(
        'Firebase credentials not configured. Using Mock provider (no actual push notifications will be sent).',
      );
      this.provider = new MockPushProvider();
      this.isConfigured = false;
      return;
    }

    try {
      this.provider = new FirebasePushProvider(
        projectId,
        privateKey,
        clientEmail,
        this.prisma,
      );
      this.isConfigured = true;
    } catch (error) {
      this.logger.error(
        `Failed to initialize Firebase provider: ${error.message}. Falling back to Mock provider.`,
      );
      this.provider = new MockPushProvider();
      this.isConfigured = false;
    }
  }

  /**
   * Send push notifications to phone numbers
   * Requirements: 3.11
   *
   * @param phoneNumbers - Array of phone numbers to send push notifications to
   * @param message - Message content to send
   * @returns PushDeliveryResult with success counts and details
   */
  async sendPush(
    phoneNumbers: string[],
    message: string,
  ): Promise<PushDeliveryResult> {
    try {
      const result = await this.provider.sendPush(phoneNumbers, message);

      if (result.success) {
        this.logger.log(
          `Push notifications sent: ${result.successCount} success, ${result.failureCount} failed`,
        );
      } else {
        this.logger.error(`Push notification delivery failed: ${result.error}`);
      }

      return result;
    } catch (error) {
      this.logger.error(
        `Unexpected error sending push notifications: ${error.message}`,
      );
      return {
        success: false,
        successCount: 0,
        failureCount: phoneNumbers.length,
        error: error.message,
        timestamp: new Date(),
      };
    }
  }

  /**
   * Check if push service is properly configured
   */
  isReady(): boolean {
    return this.isConfigured;
  }

  /**
   * Get the current provider name for logging/debugging
   */
  getProviderName(): string {
    return this.provider.constructor.name;
  }
}
