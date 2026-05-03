import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsEmail,
  IsBoolean,
  IsOptional,
  IsInt,
  IsNumber,
  Min,
  Max,
  IsEnum,
  IsArray,
} from 'class-validator';
import { XRayCapability } from '@prisma/client';

/**
 * DTO for partial clinic updates via PATCH /admin/clinics/:id.
 * All fields are optional — only supplied fields are updated.
 */
export class UpdateClinicDto {
  // Section 1: Clinic Details
  @ApiPropertyOptional({ example: 'Mombasa Dental Care' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ example: 'Kisauni' })
  @IsOptional()
  @IsString()
  subCounty?: string;

  @ApiPropertyOptional({ example: 'Opposite Nyali Mall, Links Road' })
  @IsOptional()
  @IsString()
  physicalLocation?: string;

  @ApiPropertyOptional({ example: 'https://maps.google.com/...' })
  @IsOptional()
  @IsString()
  googleMapsLink?: string;

  @ApiPropertyOptional({ example: 'Mon-Sat, 8 AM - 6 PM' })
  @IsOptional()
  @IsString()
  operatingHours?: string;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  operatesOnWeekends?: boolean;

  // Section 2: Contacts
  @ApiPropertyOptional({ example: 'Dr. Jane Mwangi' })
  @IsOptional()
  @IsString()
  leadDentistName?: string;

  @ApiPropertyOptional({ example: '0712345678' })
  @IsOptional()
  @IsString()
  ownerPhone?: string;

  @ApiPropertyOptional({ example: 'Mary Otieno' })
  @IsOptional()
  @IsString()
  managerName?: string;

  @ApiPropertyOptional({ example: '0712345678' })
  @IsOptional()
  @IsString()
  whatsappNumber?: string;

  @ApiPropertyOptional({ example: 'clinic@example.com' })
  @IsOptional()
  @IsEmail()
  email?: string;

  // Section 3: Payment
  @ApiPropertyOptional({ example: '123456' })
  @IsOptional()
  @IsString()
  mpesaTillOrPaybill?: string;

  @ApiPropertyOptional({ example: 'Mombasa Dental Care' })
  @IsOptional()
  @IsString()
  tillPaybillName?: string;

  @ApiPropertyOptional({ example: 'Mombasa Dental Care Ltd' })
  @IsOptional()
  @IsString()
  bankAccountName?: string;

  @ApiPropertyOptional({ example: 'KCB 1234567890' })
  @IsOptional()
  @IsString()
  bankAccountNumber?: string;

  // Section 4: Capacity & Compliance
  @ApiPropertyOptional({ example: 'KMPDC/12345' })
  @IsOptional()
  @IsString()
  kmpdcRegNumber?: string;

  @ApiPropertyOptional({ example: 2 })
  @IsOptional()
  @IsInt()
  @Min(1)
  activeDentalChairs?: number;

  @ApiPropertyOptional({ enum: XRayCapability })
  @IsOptional()
  @IsEnum(XRayCapability)
  xrayCapability?: XRayCapability;

  @ApiPropertyOptional({ example: ['ORTHODONTIST', 'PEDIATRIC'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  specializedServices?: string[];

  // Geo fields
  @ApiPropertyOptional({
    example: -1.2921,
    description:
      'Latitude in decimal degrees (-90 to 90). Set to null to remove.',
  })
  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number | null;

  @ApiPropertyOptional({
    example: 36.8219,
    description:
      'Longitude in decimal degrees (-180 to 180). Set to null to remove.',
  })
  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number | null;

  // Branch fields
  @ApiPropertyOptional({ example: 'Westlands Branch' })
  @IsOptional()
  @IsString()
  branchName?: string;

  @ApiPropertyOptional({
    example: 'clx1234...',
    description: 'ID of the parent clinic if this is a branch.',
  })
  @IsOptional()
  @IsString()
  parentClinicId?: string;
}
