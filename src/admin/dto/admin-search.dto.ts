import { IsOptional, IsString, IsEnum, IsDateString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentStatus } from '@prisma/client';

export class PaymentSearchQuery {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  transactionId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  phoneNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  email?: string;

  @ApiPropertyOptional({ enum: PaymentStatus })
  @IsOptional()
  @IsEnum(PaymentStatus)
  status?: PaymentStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dateTo?: string;
}

export class MemberSearchQuery {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  phoneNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  memberId?: string;
}

export class AdminActionRequest {
  @ApiPropertyOptional({
    enum: [
      'SUSPEND_MEMBER',
      'DEACTIVATE_SUBSCRIPTION',
      'VERIFY_PAYMENT',
      'REVERSE_DISBURSAL',
      'RETRY_DISBURSAL',
    ],
  })
  @IsString()
  action: string;

  @ApiPropertyOptional()
  @IsString()
  targetId: string;

  @ApiPropertyOptional()
  @IsString()
  reason: string;
}

export class ReconciliationRequest {
  @ApiPropertyOptional()
  @IsDateString()
  from: string;

  @ApiPropertyOptional()
  @IsDateString()
  to: string;
}
