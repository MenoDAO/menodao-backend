import { NotificationRecord } from './notification-record.dto';

export class HistoryResponse {
  notifications: NotificationRecord[];
  total: number;
  page: number;
  pageSize: number;
}
