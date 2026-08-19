import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateAppointmentDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  clinicId: string;

  @ApiProperty({ example: '2026-08-21T10:00:00+03:00' })
  @IsDateString()
  scheduledAt: string;

  @ApiProperty({ example: 'Toothache on the upper right side' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  intakeReason: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 10 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  painLevel?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  allergies?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  currentMedications?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  medicalConditions?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  memberNotes?: string;

  @ApiProperty()
  @IsBoolean()
  hasConsent: boolean;
}

export class CancelAppointmentDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(400)
  reason: string;
}

export class RescheduleAppointmentDto {
  @ApiProperty({ example: '2026-08-22T11:00:00+03:00' })
  @IsDateString()
  scheduledAt: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(400)
  reason: string;
}

export class AppointmentNoteDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  note: string;
}
