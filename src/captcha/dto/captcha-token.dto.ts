import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class CaptchaTokenDto {
  @ApiProperty({
    description: 'Cloudflare Turnstile response token',
    required: false,
  })
  @IsOptional()
  @IsString()
  captchaToken?: string;
}
