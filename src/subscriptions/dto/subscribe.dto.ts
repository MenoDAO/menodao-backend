import { IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { PackageTier } from '@prisma/client';

export class SubscribeDto {
  @ApiProperty({ enum: PackageTier, example: 'GOLD' })
  @IsEnum(PackageTier)
  tier: PackageTier;
}
