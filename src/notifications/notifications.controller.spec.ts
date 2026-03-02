import { Test, TestingModule } from '@nestjs/testing';
import { AdminNotificationController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationType, PackageTier } from '@prisma/client';
import { AdminAuthGuard } from '../admin/guards/admin-auth.guard';

describe('AdminNotificationController - Service Wiring', () => {
  let controller: AdminNotificationController;
  let service: NotificationsService;

  // Mock NotificationsService
  const mockNotificationsService = {
    getSMSStats: jest.fn(),
    getNotificationHistory: jest.fn(),
    previewRecipients: jest.fn(),
    sendNotification: jest.fn(),
  };

  // Mock AdminAuthGuard
  const mockAdminAuthGuard = {
    canActivate: jest.fn(() => true),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminNotificationController],
      providers: [
        {
          provide: NotificationsService,
          useValue: mockNotificationsService,
        },
      ],
    })
      .overrideGuard(AdminAuthGuard)
      .useValue(mockAdminAuthGuard)
      .compile();

    controller = module.get<AdminNotificationController>(
      AdminNotificationController,
    );
    service = module.get<NotificationsService>(NotificationsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Service Injection', () => {
    it('should be defined', () => {
      expect(controller).toBeDefined();
      expect(service).toBeDefined();
    });

    it('should have NotificationsService injected', () => {
      expect(controller['notificationsService']).toBe(service);
    });
  });

  describe('GET /sms-stats - Requirement 5.3', () => {
    it('should call NotificationsService.getSMSStats()', async () => {
      const mockStats = { todayCount: 5, allTimeCount: 100 };
      mockNotificationsService.getSMSStats.mockResolvedValue(mockStats);

      const result = await controller.getSMSStats();

      expect(service.getSMSStats).toHaveBeenCalledTimes(1);
      expect(result).toEqual(mockStats);
    });
  });

  describe('GET /history - Requirement 5.2', () => {
    it('should call NotificationsService.getNotificationHistory() with correct params', async () => {
      const params = {
        page: 1,
        pageSize: 20,
        type: NotificationType.SMS,
      };
      const mockHistory = {
        notifications: [],
        total: 0,
        page: 1,
        pageSize: 20,
      };
      mockNotificationsService.getNotificationHistory.mockResolvedValue(
        mockHistory,
      );

      const result = await controller.getHistory(params);

      expect(service.getNotificationHistory).toHaveBeenCalledTimes(1);
      expect(service.getNotificationHistory).toHaveBeenCalledWith(params);
      expect(result).toEqual(mockHistory);
    });
  });

  describe('POST /preview - Requirement 3.8', () => {
    it('should call NotificationsService.previewRecipients() with filters', async () => {
      const filters = {
        packageTypes: [PackageTier.BRONZE, PackageTier.SILVER],
      };
      const mockPreview = { count: 42 };
      mockNotificationsService.previewRecipients.mockResolvedValue(mockPreview);

      const result = await controller.previewRecipients(filters);

      expect(service.previewRecipients).toHaveBeenCalledTimes(1);
      expect(service.previewRecipients).toHaveBeenCalledWith(filters);
      expect(result).toEqual(mockPreview);
    });
  });

  describe('POST /send - Requirement 5.1', () => {
    it('should call NotificationsService.sendNotification() with request and adminId', async () => {
      const request = {
        type: NotificationType.SMS,
        filters: { packageTypes: [PackageTier.GOLD] },
        message: 'Test notification',
      };
      const adminId = 'admin-123';
      const mockResponse = {
        success: true,
        notificationId: 'notif-456',
        recipientCount: 10,
      };
      mockNotificationsService.sendNotification.mockResolvedValue(mockResponse);

      const req = { admin: { id: adminId } };
      const result = await controller.sendNotification(req, request);

      expect(service.sendNotification).toHaveBeenCalledTimes(1);
      expect(service.sendNotification).toHaveBeenCalledWith(request, adminId);
      expect(result).toEqual(mockResponse);
    });
  });
});
