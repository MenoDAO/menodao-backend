import {
  IsEnum,
  IsString,
  IsNumber,
  IsOptional,
  IsPositive,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ClaimType } from '@prisma/client';

export class CreateClaimDto {
  @ApiProperty({ enum: ClaimType, example: 'DENTAL_CHECKUP' })
  @IsEnum(ClaimType)
  claimType: ClaimType;

  @ApiProperty({ example: 'Routine dental checkup at Mombasa camp' })
  @IsString()
  description: string;

  @ApiProperty({ example: 2000, description: 'Claim amount in KES' })
  @IsNumber()
  @IsPositive()
  amount: number;

  @ApiPropertyOptional({ description: 'Camp ID if claim is from a camp visit' })
  @IsString()
  @IsOptional()
  campId?: string;
}
