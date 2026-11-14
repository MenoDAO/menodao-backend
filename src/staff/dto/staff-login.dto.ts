import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength, IsNotEmpty } from 'class-validator';
import { CaptchaTokenDto } from '../../captcha/dto/captcha-token.dto';

export class StaffLoginDto extends CaptchaTokenDto {
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

export class SetupPasswordDto {
  @ApiProperty({ description: 'One-time token from the setup link' })
  @IsString()
  @IsNotEmpty()
  token: string;

  @ApiProperty()
  @IsString()
  @MinLength(8)
  newPassword: string;
}
