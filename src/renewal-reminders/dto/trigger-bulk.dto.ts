import { IsInt, Min, Max } from 'class-validator';

export class TriggerBulkDto {
  @IsInt()
  @Min(1)
  @Max(30)
  daysUntilExpiry: number;
}
