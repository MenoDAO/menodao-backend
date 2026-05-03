import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNumber,
  IsOptional,
  Min,
  Max,
  IsEnum,
} from 'class-validator';
import { ClinicStatus } from '@prisma/client';
import { RegisterClinicDto } from './register-clinic.dto';

/**
 * DTO for admin-initiated clinic creation via POST /admin/clinics.
 * Extends RegisterClinicDto with optional geo, branch, and status fields.
 * Defaults to PENDING status unless APPROVED is explicitly requested.
 */
export class AdminCreateClinicDto extends RegisterClinicDto {
  // Geo fields
  @ApiPropertyOptional({
    example: -1.2921,
    description: 'Latitude in decimal degrees (-90 to 90).',
  })
  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number;

  @ApiPropertyOptional({
    example: 36.8219,
    description: 'Longitude in decimal degrees (-180 to 180).',
  })
  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number;

  // Branch fields
  @ApiPropertyOptional({ example: 'Westlands Branch' })
  @IsOptional()
  @IsString()
  branchName?: string;

  @ApiPropertyOptional({
    example: 'clx1234...',
    description: 'ID of the parent clinic if this is a branch.',
  })
  @IsOptional()
  @IsString()
  parentClinicId?: string;

  // Status override — defaults to PENDING in service layer
  @ApiPropertyOptional({
    enum: ClinicStatus,
    example: 'PENDING',
    description:
      'Initial status. Set to APPROVED to immediately activate and generate staff credentials.',
  })
  @IsOptional()
  @IsEnum(ClinicStatus)
  status?: ClinicStatus;
}
