import { NotificationType, NotificationStatus } from '@prisma/client';

export class NotificationHistoryParams {
  page: number;
  pageSize: number;
  type?: NotificationType;
  status?: NotificationStatus;
  dateFrom?: Date;
  dateTo?: Date;
}
