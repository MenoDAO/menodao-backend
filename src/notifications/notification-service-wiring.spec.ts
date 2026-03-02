import { Test, TestingModule } from '@nestjs/testing';
import { NotificationsService } from './notifications.service';
import { FilterService } from './filter.service';
import { SanitizationService } from './sanitization.service';
import { SMSService } from './sms.service';
import { PushService } from './push.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import {
  NotificationType,
  NotificationStatus,
  PackageTier,
} from '@prisma/client';

/**
 * Task 12.2: Wire FilterService and SanitizationService to NotificationService
 * Task 12.3: Wire SMS and Push services to NotificationService
 * Requirements: 3.11, 4.7, 8.7
 *
 * This test verifies that:
 * 1. FilterService is properly injected into NotificationService
 * 2. SanitizationService is properly injected into NotificationService
 * 3. SMSService is properly injected into NotificationService
 * 4. PushService is properly injected into NotificationService
 * 5. The send workflow uses all services correctly
 * 6. Correct service is called based on notification type
 */
describe('NotificationService - Service Wiring', () => {
  let notificationsService: NotificationsService;
  let filterService: FilterService;
  let sanitizationService: SanitizationService;
  let smsService: SMSService;
  let pushService: PushService;
  let prismaService: PrismaService;

  const mockFilterService = {
    getFilteredRecipients: jest.fn(),
    countFilteredRecipients: jest.fn(),
  };

  const mockSanitizationService = {
    sanitizeMessage: jest.fn(),
    containsSensitiveContent: jest.fn(),
  };

  const mockSMSService = {
    sendSMS: jest.fn(),
  };

  const mockPushService = {
    sendPush: jest.fn(),
    isReady: jest.fn().mockReturnValue(true),
  };

  const mockPrismaService = {
    notification: {
      create: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
      findMany: jest.fn(),
    },
    member: {
      findMany: jest.fn(),
    },
    deviceToken: {
      findMany: jest.fn(),
    },
  };

  const mockConfigService = {
    get: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        {
          provide: FilterService,
          useValue: mockFilterService,
        },
        {
          provide: SanitizationService,
          useValue: mockSanitizationService,
        },
        {
          provide: SMSService,
          useValue: mockSMSService,
        },
        {
          provide: PushService,
          useValue: mockPushService,
        },
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    notificationsService =
      module.get<NotificationsService>(NotificationsService);
    filterService = module.get<FilterService>(FilterService);
    sanitizationService = module.get<SanitizationService>(SanitizationService);
    smsService = module.get<SMSService>(SMSService);
    pushService = module.get<PushService>(PushService);
    prismaService = module.get<PrismaService>(PrismaService);

    // Reset all mocks
    jest.clearAllMocks();
  });

  describe('Service Injection - Requirements 3.11, 8.7', () => {
    it('should have FilterService injected', () => {
      expect(notificationsService['filterService']).toBeDefined();
      expect(notificationsService['filterService']).toBe(filterService);
    });

    it('should have SanitizationService injected', () => {
      expect(notificationsService['sanitizationService']).toBeDefined();
      expect(notificationsService['sanitizationService']).toBe(
        sanitizationService,
      );
    });

    it('should have SMSService injected', () => {
      expect(notificationsService['smsService']).toBeDefined();
      expect(notificationsService['smsService']).toBe(smsService);
    });

    it('should have PushService injected', () => {
      expect(notificationsService['pushService']).toBeDefined();
      expect(notificationsService['pushService']).toBe(pushService);
    });
  });

  describe('Send Workflow Integration - Requirements 4.7, 8.7', () => {
    it('should use FilterService to get recipients', async () => {
      // Arrange
      const filters = {
        packageTypes: [PackageTier.BRONZE, PackageTier.SILVER],
      };
      const recipients = ['+1234567890', '+0987654321'];
      const message = 'Test notification';
      const adminId = 'admin-123';

      mockFilterService.getFilteredRecipients.mockResolvedValue(recipients);
      mockSanitizationService.sanitizeMessage.mockReturnValue(message);
      mockPrismaService.notification.create.mockResolvedValue({
        id: 'notif-123',
        type: NotificationType.SMS,
        recipientCount: recipients.length,
        message: message,
        status: NotificationStatus.PENDING,
        sentBy: adminId,
        filterCriteria: filters,
        successCount: 0,
        failureCount: 0,
        sentAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Act
      await notificationsService.sendNotification(
        {
          type: NotificationType.SMS,
          filters,
          message,
        },
        adminId,
      );

      // Assert
      expect(filterService.getFilteredRecipients).toHaveBeenCalledTimes(1);
      expect(filterService.getFilteredRecipients).toHaveBeenCalledWith(filters);
    });

    it('should use SanitizationService to sanitize message before storage', async () => {
      // Arrange
      const filters = { packageTypes: [PackageTier.GOLD] };
      const recipients = ['+1234567890'];
      const originalMessage = 'Your password is 12345';
      const sanitizedMessage = '[PROTECTED]';
      const adminId = 'admin-123';

      mockFilterService.getFilteredRecipients.mockResolvedValue(recipients);
      mockSanitizationService.sanitizeMessage.mockReturnValue(sanitizedMessage);
      mockPrismaService.notification.create.mockResolvedValue({
        id: 'notif-456',
        type: NotificationType.SMS,
        recipientCount: recipients.length,
        message: sanitizedMessage,
        status: NotificationStatus.PENDING,
        sentBy: adminId,
        filterCriteria: filters,
        successCount: 0,
        failureCount: 0,
        sentAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Act
      await notificationsService.sendNotification(
        {
          type: NotificationType.SMS,
          filters,
          message: originalMessage,
        },
        adminId,
      );

      // Assert
      expect(sanitizationService.sanitizeMessage).toHaveBeenCalledTimes(1);
      expect(sanitizationService.sanitizeMessage).toHaveBeenCalledWith(
        originalMessage,
      );
    });

    it('should store sanitized message in database - Requirement 4.7', async () => {
      // Arrange
      const filters = { singlePhoneNumber: '+1234567890' };
      const recipients = ['+1234567890'];
      const originalMessage = 'Your OTP is 123456';
      const sanitizedMessage = '[PROTECTED]';
      const adminId = 'admin-789';

      mockFilterService.getFilteredRecipients.mockResolvedValue(recipients);
      mockSanitizationService.sanitizeMessage.mockReturnValue(sanitizedMessage);
      mockPrismaService.notification.create.mockResolvedValue({
        id: 'notif-789',
        type: NotificationType.SMS,
        recipientCount: recipients.length,
        message: sanitizedMessage,
        status: NotificationStatus.PENDING,
        sentBy: adminId,
        filterCriteria: filters,
        successCount: 0,
        failureCount: 0,
        sentAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Act
      await notificationsService.sendNotification(
        {
          type: NotificationType.SMS,
          filters,
          message: originalMessage,
        },
        adminId,
      );

      // Assert
      expect(prismaService.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            message: sanitizedMessage, // Sanitized message stored
          }),
        }),
      );
    });

    it('should use both FilterService and SanitizationService in correct order', async () => {
      // Arrange
      const filters = { packageTypes: [PackageTier.BRONZE] };
      const recipients = ['+1111111111', '+2222222222'];
      const message = 'Test message';
      const adminId = 'admin-999';

      mockFilterService.getFilteredRecipients.mockResolvedValue(recipients);
      mockSanitizationService.sanitizeMessage.mockReturnValue(message);
      mockPrismaService.notification.create.mockResolvedValue({
        id: 'notif-999',
        type: NotificationType.SMS,
        recipientCount: recipients.length,
        message: message,
        status: NotificationStatus.PENDING,
        sentBy: adminId,
        filterCriteria: filters,
        successCount: 0,
        failureCount: 0,
        sentAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Act
      await notificationsService.sendNotification(
        {
          type: NotificationType.SMS,
          filters,
          message,
        },
        adminId,
      );

      // Assert - Verify call order
      const filterCallOrder =
        mockFilterService.getFilteredRecipients.mock.invocationCallOrder[0];
      const sanitizeCallOrder =
        mockSanitizationService.sanitizeMessage.mock.invocationCallOrder[0];

      expect(filterCallOrder).toBeLessThan(sanitizeCallOrder);
      expect(filterService.getFilteredRecipients).toHaveBeenCalledWith(filters);
      expect(sanitizationService.sanitizeMessage).toHaveBeenCalledWith(message);
    });
  });

  describe('Preview Recipients - Requirement 8.7', () => {
    it('should use FilterService to count recipients', async () => {
      // Arrange
      const filters = { subscriptionStatus: 'active' as const };
      const expectedCount = 150;

      mockFilterService.countFilteredRecipients.mockResolvedValue(
        expectedCount,
      );

      // Act
      const result = await notificationsService.previewRecipients(filters);

      // Assert
      expect(filterService.countFilteredRecipients).toHaveBeenCalledTimes(1);
      expect(filterService.countFilteredRecipients).toHaveBeenCalledWith(
        filters,
      );
      expect(result.count).toBe(expectedCount);
    });
  });

  describe('Notification Type Routing - Requirement 3.11', () => {
    it('should call SMSService when notification type is SMS', async () => {
      // Arrange
      const filters = { packageTypes: [PackageTier.BRONZE] };
      const recipients = ['+1234567890', '+0987654321'];
      const message = 'Test SMS notification';
      const adminId = 'admin-123';

      mockFilterService.getFilteredRecipients.mockResolvedValue(recipients);
      mockSanitizationService.sanitizeMessage.mockReturnValue(message);
      mockSMSService.sendSMS.mockResolvedValue({
        success: true,
        messageId: 'sms-123',
        timestamp: new Date(),
      });
      mockPrismaService.notification.create.mockResolvedValue({
        id: 'notif-sms-123',
        type: NotificationType.SMS,
        recipientCount: recipients.length,
        message: message,
        status: NotificationStatus.PENDING,
        sentBy: adminId,
        filterCriteria: filters,
        successCount: 0,
        failureCount: 0,
        sentAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      mockPrismaService.notification.update.mockResolvedValue({});

      // Act
      await notificationsService.sendNotification(
        {
          type: NotificationType.SMS,
          filters,
          message,
        },
        adminId,
      );

      // Wait for async operations
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Assert
      expect(smsService.sendSMS).toHaveBeenCalled();
      expect(pushService.sendPush).not.toHaveBeenCalled();
    });

    it('should call PushService when notification type is PUSH', async () => {
      // Arrange
      const filters = { packageTypes: [PackageTier.GOLD] };
      const recipients = ['+1234567890', '+0987654321'];
      const message = 'Test push notification';
      const adminId = 'admin-456';

      mockFilterService.getFilteredRecipients.mockResolvedValue(recipients);
      mockSanitizationService.sanitizeMessage.mockReturnValue(message);
      mockPushService.sendPush.mockResolvedValue({
        success: true,
        successCount: 2,
        failureCount: 0,
        timestamp: new Date(),
      });
      mockPrismaService.notification.create.mockResolvedValue({
        id: 'notif-push-456',
        type: NotificationType.PUSH,
        recipientCount: recipients.length,
        message: message,
        status: NotificationStatus.PENDING,
        sentBy: adminId,
        filterCriteria: filters,
        successCount: 0,
        failureCount: 0,
        sentAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      mockPrismaService.notification.update.mockResolvedValue({});

      // Act
      await notificationsService.sendNotification(
        {
          type: NotificationType.PUSH,
          filters,
          message,
        },
        adminId,
      );

      // Wait for async operations
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Assert
      expect(pushService.sendPush).toHaveBeenCalledWith(recipients, message);
      expect(smsService.sendSMS).not.toHaveBeenCalled();
    });

    it('should not call wrong service for SMS type', async () => {
      // Arrange
      const filters = { singlePhoneNumber: '+1234567890' };
      const recipients = ['+1234567890'];
      const message = 'SMS only';
      const adminId = 'admin-789';

      mockFilterService.getFilteredRecipients.mockResolvedValue(recipients);
      mockSanitizationService.sanitizeMessage.mockReturnValue(message);
      mockSMSService.sendSMS.mockResolvedValue({
        success: true,
        messageId: 'sms-789',
        timestamp: new Date(),
      });
      mockPrismaService.notification.create.mockResolvedValue({
        id: 'notif-789',
        type: NotificationType.SMS,
        recipientCount: recipients.length,
        message: message,
        status: NotificationStatus.PENDING,
        sentBy: adminId,
        filterCriteria: filters,
        successCount: 0,
        failureCount: 0,
        sentAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      mockPrismaService.notification.update.mockResolvedValue({});

      // Act
      await notificationsService.sendNotification(
        {
          type: NotificationType.SMS,
          filters,
          message,
        },
        adminId,
      );

      // Wait for async operations
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Assert - PushService should NOT be called for SMS
      expect(pushService.sendPush).not.toHaveBeenCalled();
    });

    it('should not call wrong service for PUSH type', async () => {
      // Arrange
      const filters = { singlePhoneNumber: '+1234567890' };
      const recipients = ['+1234567890'];
      const message = 'Push only';
      const adminId = 'admin-999';

      mockFilterService.getFilteredRecipients.mockResolvedValue(recipients);
      mockSanitizationService.sanitizeMessage.mockReturnValue(message);
      mockPushService.sendPush.mockResolvedValue({
        success: true,
        successCount: 1,
        failureCount: 0,
        timestamp: new Date(),
      });
      mockPrismaService.notification.create.mockResolvedValue({
        id: 'notif-999',
        type: NotificationType.PUSH,
        recipientCount: recipients.length,
        message: message,
        status: NotificationStatus.PENDING,
        sentBy: adminId,
        filterCriteria: filters,
        successCount: 0,
        failureCount: 0,
        sentAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      mockPrismaService.notification.update.mockResolvedValue({});

      // Act
      await notificationsService.sendNotification(
        {
          type: NotificationType.PUSH,
          filters,
          message,
        },
        adminId,
      );

      // Wait for async operations
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Assert - SMSService should NOT be called for PUSH
      expect(smsService.sendSMS).not.toHaveBeenCalled();
    });
  });
});
