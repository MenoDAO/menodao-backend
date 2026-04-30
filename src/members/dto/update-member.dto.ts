import { IsString, IsOptional, IsIn } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateMemberDto {
  @ApiPropertyOptional({ example: 'John Doe' })
  @IsString()
  @IsOptional()
  fullName?: string;

  @ApiPropertyOptional({ example: 'Mombasa, Kenya' })
  @IsString()
  @IsOptional()
  location?: string;

  @ApiPropertyOptional({ example: 'celo', enum: ['celo', 'base', 'polygon'] })
  @IsString()
  @IsOptional()
  preferredChain?: string;

  @ApiPropertyOptional({
    enum: ['en', 'sw'],
    description: 'Preferred language for UI and notifications',
  })
  @IsString()
  @IsOptional()
  @IsIn(['en', 'sw'])
  preferredLanguage?: string;
}
