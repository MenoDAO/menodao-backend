import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsEnum } from 'class-validator';
import { ClinicStatus } from '@prisma/client';
import { RegisterClinicDto } from './register-clinic.dto';

/**
 * DTO for admin-initiated clinic creation via POST /admin/clinics.
 * Extends RegisterClinicDto with optional branch and status fields.
 * lat/lng are already inherited from RegisterClinicDto.
 * Defaults to PENDING status unless APPROVED is explicitly requested.
 */
export class AdminCreateClinicDto extends RegisterClinicDto {
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
