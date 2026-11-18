import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { BRAND_CONTEXT_KINDS } from '../../bot/context/brand-context.service';

/** Where a context document comes from. GOOGLE_DRIVE is reserved for the sync. */
export const BRAND_CONTEXT_SOURCES = ['MANUAL', 'GOOGLE_DRIVE'] as const;

export type BrandContextSource = (typeof BRAND_CONTEXT_SOURCES)[number];

export class CreateBrandContextDocumentDto {
  @ApiProperty({
    enum: BRAND_CONTEXT_KINDS,
    default: 'BIBLE',
    description:
      'Retrieval bucket. BRAND = voice/positioning, ETHICS = matters of ethics, ' +
      'OPERATING = operating principles, CLINICAL = clinical protocols, ' +
      'POLICY = pricing/membership/escalation, BIBLE = everything else.',
  })
  @IsOptional()
  @IsIn([...BRAND_CONTEXT_KINDS])
  kind?: (typeof BRAND_CONTEXT_KINDS)[number];

  @ApiPropertyOptional({ example: 'Escalation boundaries' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @ApiProperty({
    example:
      'Never give a clinical diagnosis or name a medication. Escalate anything ' +
      'emergency-shaped to the nearest clinic.',
  })
  @IsString()
  @MinLength(1)
  content: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({ enum: BRAND_CONTEXT_SOURCES, default: 'MANUAL' })
  @IsOptional()
  @IsIn([...BRAND_CONTEXT_SOURCES])
  source?: BrandContextSource;

  @ApiPropertyOptional({
    description: 'Google Drive file id (used when source is GOOGLE_DRIVE).',
  })
  @IsOptional()
  @IsString()
  externalId?: string;

  @ApiPropertyOptional({ description: 'Link back to the source document.' })
  @IsOptional()
  @IsString()
  externalUrl?: string;
}

export class UpdateBrandContextDocumentDto {
  @ApiPropertyOptional({ enum: BRAND_CONTEXT_KINDS })
  @IsOptional()
  @IsIn([...BRAND_CONTEXT_KINDS])
  kind?: (typeof BRAND_CONTEXT_KINDS)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  content?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({ enum: BRAND_CONTEXT_SOURCES })
  @IsOptional()
  @IsIn([...BRAND_CONTEXT_SOURCES])
  source?: BrandContextSource;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  externalId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  externalUrl?: string | null;

  @ApiPropertyOptional({
    description: 'Set by the Google Drive sync once a pull succeeds.',
  })
  @IsOptional()
  lastSyncedAt?: Date | null;
}

export class ImportBrandContextDto {
  @ApiProperty({ enum: BRAND_CONTEXT_KINDS, default: 'BIBLE' })
  @IsOptional()
  @IsIn([...BRAND_CONTEXT_KINDS])
  kind?: (typeof BRAND_CONTEXT_KINDS)[number];

  @ApiPropertyOptional({
    example: 'Dr. Papi operating principles',
    description: 'Used as the fallback title for sections without a heading.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @ApiProperty({
    description:
      'The full guide text. Markdown headings are used to split it into one ' +
      'retrievable document per section.',
  })
  @IsString()
  @MinLength(1)
  content: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({ enum: BRAND_CONTEXT_SOURCES, default: 'MANUAL' })
  @IsOptional()
  @IsIn([...BRAND_CONTEXT_SOURCES])
  source?: BrandContextSource;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  externalId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  externalUrl?: string;
}

export class PreviewBrandContextDto {
  @ApiProperty({
    example: 'what should I do if a patient has facial swelling?',
    description: 'The question to simulate retrieval against.',
  })
  @IsString()
  @MinLength(1)
  query: string;

  @ApiPropertyOptional({ enum: BRAND_CONTEXT_KINDS, default: 'BIBLE' })
  @IsOptional()
  @IsIn([...BRAND_CONTEXT_KINDS])
  kind?: (typeof BRAND_CONTEXT_KINDS)[number];

  @ApiPropertyOptional({ default: 3, minimum: 1, maximum: 10 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  topK?: number;
}
