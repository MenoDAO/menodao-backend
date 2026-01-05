import { IsString, IsNotEmpty, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RequestOtpDto {
  @ApiProperty({
    example: '+254712345678',
    description: 'Phone number to send OTP to',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^(\+?254|0)?[17]\d{8}$/, {
    message: 'Please provide a valid Kenyan phone number',
  })
  phoneNumber: string;
}
