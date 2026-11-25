import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  FIELD_CONTRIBUTOR_ROLES,
  FIELD_SUBMISSION_STATUSES,
} from '../../bot/field-data/field-data.service';

export class CreateFieldContributorDto {
  @ApiProperty({ example: '+254712345678' })
  @IsString()
  @MinLength(9)
  @MaxLength(20)
  phoneNumber: string;

  @ApiProperty({ example: 'Dr. Amina Yusuf' })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  displayName: string;

  @ApiPropertyOptional({ enum: FIELD_CONTRIBUTOR_ROLES })
  @IsOptional()
  @IsIn([...FIELD_CONTRIBUTOR_ROLES])
  role?: (typeof FIELD_CONTRIBUTOR_ROLES)[number];

  @ApiPropertyOptional({ example: 'Mikindani Hospital Dental Unit' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  organization?: string;
}

export class UpdateFieldContributorDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  displayName?: string;

  @ApiPropertyOptional({ enum: FIELD_CONTRIBUTOR_ROLES })
  @IsOptional()
  @IsIn([...FIELD_CONTRIBUTOR_ROLES])
  role?: (typeof FIELD_CONTRIBUTOR_ROLES)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  organization?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ReviewFieldSubmissionDto {
  @ApiProperty({ enum: ['PROCESSED', 'REJECTED', 'NEEDS_REVIEW'] })
  @IsIn(['PROCESSED', 'REJECTED', 'NEEDS_REVIEW'])
  status: 'PROCESSED' | 'REJECTED' | 'NEEDS_REVIEW';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  reviewNotes?: string;

  @ApiPropertyOptional({ description: 'Corrected structured extraction.' })
  @IsOptional()
  @IsObject()
  extracted?: Record<string, unknown>;
}

export class ListFieldSubmissionsQuery {
  @ApiPropertyOptional({ enum: FIELD_SUBMISSION_STATUSES })
  @IsOptional()
  @IsIn([...FIELD_SUBMISSION_STATUSES])
  status?: (typeof FIELD_SUBMISSION_STATUSES)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  contributorId?: string;

  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit = 50;
}

/** Query DTO for the binary media route; the token itself is still a header. */
export class FieldMediaQuery {
  @ApiPropertyOptional({ description: 'Short-lived bearer token for <video>/<img> tags.' })
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.slice(0, 2048) : value))
  token?: string;
}
