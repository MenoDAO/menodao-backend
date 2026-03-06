import { PackageTier } from '@prisma/client';

export class RecipientFilters {
  packageTypes?: PackageTier[];
  dateJoinedFrom?: Date;
  dateJoinedTo?: Date;
  balanceMin?: number;
  balanceMax?: number;
  subscriptionStatus?: 'active' | 'inactive';
  singlePhoneNumber?: string;
  csvPhoneNumbers?: string[];
}
