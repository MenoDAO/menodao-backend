import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, Matches } from 'class-validator';

export class CheckInDto {
  @ApiProperty({ example: '0712345678' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^0\d{9}$/, { message: 'Phone number must be in format 0XXXXXXXXX' })
  phoneNumber: string;
}
