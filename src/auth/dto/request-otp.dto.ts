import {
  IsString,
  IsNotEmpty,
  Matches,
  IsOptional,
  IsBoolean,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RequestOtpDto {
  @ApiProperty({
    example: '+254712345678',
    description: 'Phone number to send OTP to',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^(\+?254|0)\d{8,9}$/, {
    message: 'Please provide a valid Kenyan phone number',
  })
  phoneNumber: string;

  @ApiProperty({
    example: false,
    description:
      'Create member if phone number does not exist (for signup flow)',
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  createIfNotExists?: boolean;

  @ApiProperty({
    example: 'Jane Doe',
    description: 'Full name of the user (for signup flow)',
    required: false,
  })
  @IsOptional()
  @IsString()
  fullName?: string;

  @ApiProperty({
    example: 'Nairobi',
    description: 'Location/county of the user (for signup flow)',
    required: false,
  })
  @IsOptional()
  @IsString()
  location?: string;
}
