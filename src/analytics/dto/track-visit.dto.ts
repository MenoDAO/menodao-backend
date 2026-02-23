import { IsString, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class TrackVisitDto {
  @ApiProperty({ description: 'URL path visited', example: '/' })
  @IsString()
  page: string;

  @ApiPropertyOptional({ description: 'HTTP referrer' })
  @IsOptional()
  @IsString()
  referrer?: string;

  @ApiPropertyOptional({ description: 'UTM source parameter' })
  @IsOptional()
  @IsString()
  utmSource?: string;

  @ApiPropertyOptional({ description: 'UTM medium parameter' })
  @IsOptional()
  @IsString()
  utmMedium?: string;

  @ApiPropertyOptional({ description: 'UTM campaign parameter' })
  @IsOptional()
  @IsString()
  utmCampaign?: string;

  @ApiPropertyOptional({ description: 'Client-side session ID' })
  @IsOptional()
  @IsString()
  sessionId?: string;
}
