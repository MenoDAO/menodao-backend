import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, Matches } from 'class-validator';

export class CheckInDto {
  @ApiProperty({ example: '0712345678' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^0\d{9}$/, { message: 'Phone number must be in format 0XXXXXXXXX' })
  phoneNumber: string;

  @ApiProperty({
    example: 'Severe toothache in upper right molar',
    required: false,
  })
  @IsString()
  chiefComplaint?: string;

  @ApiProperty({ example: 'Allergic to penicillin', required: false })
  @IsString()
  medicalHistory?: string;

  @ApiProperty({
    example: { bp: '120/80', pulse: 72, temp: 36.6 },
    required: false,
  })
  vitals?: Record<string, any>;

  @ApiProperty({
    example: 'Initial observation: Inflamed gums',
    required: false,
  })
  @IsString()
  clinicalNotes?: string;

  @ApiProperty({ example: true })
  @IsNotEmpty()
  hasConsent: boolean;
}
