import { NotificationType, NotificationStatus } from '@prisma/client';
import { IsInt, IsOptional, IsEnum, IsDateString, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class NotificationHistoryParams {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize: number;

  @IsOptional()
  @IsEnum(NotificationType)
  type?: NotificationType;

  @IsOptional()
  @IsEnum(NotificationStatus)
  status?: NotificationStatus;

  @IsOptional()
  @IsDateString()
  dateFrom?: Date;

  @IsOptional()
  @IsDateString()
  dateTo?: Date;
}
