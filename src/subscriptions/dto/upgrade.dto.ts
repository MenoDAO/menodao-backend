import { IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { PackageTier } from '@prisma/client';

export class UpgradeDto {
  @ApiProperty({ enum: PackageTier, example: 'GOLD' })
  @IsEnum(PackageTier)
  newTier: PackageTier;
}
