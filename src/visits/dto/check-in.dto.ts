import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  Matches,
  IsOptional,
  IsObject,
  IsBoolean,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { QuestionnaireDto } from './questionnaire.dto';

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

  @ApiPropertyOptional({
    description: 'Comprehensive Dental Check-Up Questionnaire (CDCQ-v1) data',
    type: QuestionnaireDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => QuestionnaireDto)
  questionnaire?: QuestionnaireDto;
}
