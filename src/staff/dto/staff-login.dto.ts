import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength, IsNotEmpty } from 'class-validator';

export class StaffLoginDto {
  @ApiProperty({ example: 'staff001' })
  @IsString()
  @IsNotEmpty()
  username: string;

  @ApiProperty({ example: 'password123' })
  @IsString()
  @MinLength(6)
  password: string;
}

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  currentPassword: string;

  @ApiProperty()
  @IsString()
  @MinLength(6)
  newPassword: string;
}
