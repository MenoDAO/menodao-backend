import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  VOUCHER_CHANNELS,
  VOUCHER_STATUSES,
} from '../voucher.service';

export class CreateVoucherBatchDto {
  @ApiProperty({ example: 50, minimum: 1, maximum: 500 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  count: number;

  @ApiPropertyOptional({ example: 'SMILE' })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9-]{2,10}$/)
  prefix?: string;

  @ApiPropertyOptional({ example: 'November outreach camp' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}

export class ListVouchersQuery {
  @ApiPropertyOptional({ enum: VOUCHER_STATUSES })
  @IsOptional()
  @IsIn([...VOUCHER_STATUSES])
  status?: (typeof VOUCHER_STATUSES)[number];

  @ApiPropertyOptional({ description: 'Code, recipient name, or phone' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit = 50;
}

export class RedeemVoucherDto {
  @ApiPropertyOptional({ description: 'Name of the person redeeming the voucher' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  redeemedBy?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class ShareVoucherDto {
  @ApiProperty({ enum: VOUCHER_CHANNELS })
  @IsIn([...VOUCHER_CHANNELS])
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  channel: (typeof VOUCHER_CHANNELS)[number];
}

export class VerifyVoucherDto {
  @ApiProperty({ example: 'SMILE-K7Q2M' })
  @IsString()
  @MinLength(4)
  @MaxLength(64)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  code: string;
}
