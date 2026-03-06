import { NotificationType } from '@prisma/client';
import { RecipientFilters } from './recipient-filters.dto';

export class SendRequest {
  type: NotificationType;
  filters: RecipientFilters;
  message: string;
}
