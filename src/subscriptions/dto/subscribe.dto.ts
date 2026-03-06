import { IsEnum, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { PackageTier, PaymentFrequency } from '@prisma/client';

export class SubscribeDto {
  @ApiProperty({ enum: PackageTier, example: 'GOLD' })
  @IsEnum(PackageTier)
  tier: PackageTier;

  @ApiProperty({
    enum: PaymentFrequency,
    example: 'MONTHLY',
    required: false,
    description: 'Payment frequency (defaults to MONTHLY)',
  })
  @IsEnum(PaymentFrequency)
  @IsOptional()
  paymentFrequency?: PaymentFrequency;
}
