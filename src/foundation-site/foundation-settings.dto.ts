import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

const MEDIA_URL_OPTIONS = {
  protocols: ['http', 'https'] as ['http', 'https'],
  require_protocol: true,
  require_valid_protocol: true,
};

export const FOUNDATION_PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

export class FoundationImpactOverrideDto {
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  registeredMembers?: number | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  contributingMembers?: number | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000)
  approvedFacilities?: number | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100_000)
  campsConducted?: number | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000_000)
  peopleServed?: number | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(47)
  counties?: number | null;
}

export class FoundationClinicOverrideDto {
  @IsString()
  id: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(200)
  displayName?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(300)
  location?: string | null;

  @IsOptional()
  @IsBoolean()
  hidden?: boolean;
}

export class FoundationHeroContentDto {
  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== '')
  @IsUrl(MEDIA_URL_OPTIONS)
  @MaxLength(2000)
  videoUrl?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== '')
  @IsUrl(MEDIA_URL_OPTIONS)
  @MaxLength(2000)
  posterUrl?: string | null;

  @IsOptional()
  @IsIn(FOUNDATION_PLAYBACK_RATES)
  playbackRate?: number;

  @IsOptional()
  @IsBoolean()
  autoplay?: boolean;

  @IsOptional()
  @IsBoolean()
  muted?: boolean;

  @IsOptional()
  @IsBoolean()
  loop?: boolean;
}

export class FoundationFounderVideoDto {
  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== '')
  @IsUrl(MEDIA_URL_OPTIONS)
  @MaxLength(2000)
  videoUrl?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== '')
  @IsUrl(MEDIA_URL_OPTIONS)
  @MaxLength(2000)
  posterUrl?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(160)
  caption?: string | null;

  @IsOptional()
  @IsIn(FOUNDATION_PLAYBACK_RATES)
  playbackRate?: number;

  @IsOptional()
  @IsBoolean()
  muted?: boolean;
}

export class FoundationMediaItemDto {
  @IsString()
  @MaxLength(60)
  id: string;

  @IsIn(['image', 'video'])
  kind: 'image' | 'video';

  @IsUrl(MEDIA_URL_OPTIONS)
  @MaxLength(2000)
  src: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== '')
  @IsUrl(MEDIA_URL_OPTIONS)
  @MaxLength(2000)
  posterUrl?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  alt?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  altSw?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(240)
  caption?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(240)
  captionSw?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== '')
  @IsUrl(MEDIA_URL_OPTIONS)
  @MaxLength(2000)
  href?: string | null;

  @IsOptional()
  @IsIn(FOUNDATION_PLAYBACK_RATES)
  playbackRate?: number;
}

export class FoundationCopyLocaleDto {
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(120)
  eyebrow?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(240)
  h1?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(500)
  subhead?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(80)
  primaryCta?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(80)
  secondaryCta?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(160)
  challengeTitle?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(160)
  pillarsTitle?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(120)
  letterEyebrow?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(240)
  letterTitle?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(1600)
  letterBody?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(600)
  letterSummary?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(160)
  involvedTitle?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(500)
  involvedBody?: string | null;
}

export class FoundationCopyDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => FoundationCopyLocaleDto)
  @IsObject()
  en?: FoundationCopyLocaleDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => FoundationCopyLocaleDto)
  @IsObject()
  sw?: FoundationCopyLocaleDto;
}

export class UpdateFoundationSettingsDto {
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  whatsappNumber?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  anchorClinicId?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(2000)
  clinicalClassification?: string | null;

  @IsOptional()
  @ValidateNested()
  @Type(() => FoundationImpactOverrideDto)
  @IsObject()
  impact?: FoundationImpactOverrideDto;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FoundationClinicOverrideDto)
  clinics?: FoundationClinicOverrideDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => FoundationHeroContentDto)
  @IsObject()
  hero?: FoundationHeroContentDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => FoundationFounderVideoDto)
  @IsObject()
  founderVideo?: FoundationFounderVideoDto;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FoundationMediaItemDto)
  mediaItems?: FoundationMediaItemDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => FoundationCopyDto)
  @IsObject()
  copy?: FoundationCopyDto;
}
