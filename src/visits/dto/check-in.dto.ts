import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  Matches,
  IsOptional,
  IsObject,
  IsBoolean,
} from 'class-validator';

export class CheckInDto {
  @ApiProperty({ example: '0712345678' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\+?(\d{10,13})$/, {
    message: 'Phone number must be a valid format',
  })
  phoneNumber: string;

  @ApiProperty({
    example: 'Severe toothache in upper right molar',
    required: false,
  })
  @IsOptional()
  @IsString()
  chiefComplaint?: string;

  @ApiProperty({ example: 'Allergic to penicillin', required: false })
  @IsOptional()
  @IsString()
  medicalHistory?: string;

  @ApiProperty({
    example: { bp: '120/80', pulse: 72, temp: 36.6 },
    required: false,
  })
  @IsOptional()
  @IsObject()
  vitals?: Record<string, any>;

  @ApiProperty({
    example: 'Initial observation: Inflamed gums',
    required: false,
  })
  @IsOptional()
  @IsString()
  clinicalNotes?: string;

  @ApiProperty({ example: true })
  @IsBoolean()
  @IsNotEmpty()
  hasConsent: boolean;
}
