import {
  IsNumber,
  IsString,
  IsPositive,
  IsOptional,
  Min,
  Max,
  IsBoolean,
  IsEnum,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PackageTier } from '@prisma/client';

export class InitiatePaymentDto {
  @ApiProperty({
    example: 700,
    description: 'Amount in KES (min 10, max 100000)',
  })
  @IsNumber()
  @IsPositive()
  @Min(10, { message: 'Minimum contribution is KES 10' })
  @Max(100000, { message: 'Maximum contribution is KES 100,000' })
  amount: number;

  @ApiPropertyOptional({
    example: '0712345678',
    description:
      'M-Pesa phone number (optional, defaults to member registered phone)',
  })
  @IsOptional()
  @IsString()
  phoneNumber?: string;

  @ApiPropertyOptional({
    example: 'mpesa',
    description: 'Payment method (currently only mpesa supported)',
    default: 'mpesa',
  })
  @IsOptional()
  @IsString()
  paymentMethod?: string;

  @ApiPropertyOptional({
    example: false,
    description: 'Whether this payment is for a package upgrade',
  })
  @IsOptional()
  @IsBoolean()
  isUpgrade?: boolean;

  @ApiPropertyOptional({
    example: 'SILVER',
    description: 'New tier for upgrade (required if isUpgrade is true)',
    enum: ['BRONZE', 'SILVER', 'GOLD'],
  })
  @IsOptional()
  @IsEnum(PackageTier)
  newTier?: PackageTier;
}
