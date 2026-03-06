import { NotificationType, NotificationStatus } from '@prisma/client';

export class NotificationRecord {
  id: string;
  type: NotificationType;
  recipientCount: number;
  message: string; // Sanitized content
  status: NotificationStatus;
  deliveryStats: {
    successCount: number;
    failureCount: number;
  };
  sentAt: Date;
  sentBy: string; // Admin username
}
