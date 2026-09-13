import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

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
}
