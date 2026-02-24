import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsEmail,
  IsBoolean,
  IsOptional,
  IsInt,
  Min,
  IsEnum,
  IsArray,
} from 'class-validator';
import { XRayCapability } from '@prisma/client';

export class RegisterClinicDto {
  // Section 1: Clinic Details
  @ApiProperty({ example: 'Mombasa Dental Care' })
  @IsString()
  name: string;

  @ApiProperty({ example: 'Kisauni' })
  @IsString()
  subCounty: string;

  @ApiProperty({ example: 'Opposite Nyali Mall, Links Road' })
  @IsString()
  physicalLocation: string;

  @ApiPropertyOptional({ example: 'https://maps.google.com/...' })
  @IsOptional()
  @IsString()
  googleMapsLink?: string;

  @ApiProperty({ example: 'Mon-Sat, 8 AM - 6 PM' })
  @IsString()
  operatingHours: string;

  @ApiProperty({ example: false })
  @IsBoolean()
  operatesOnWeekends: boolean;

  // Section 2: Contacts
  @ApiProperty({ example: 'Dr. Jane Mwangi' })
  @IsString()
  leadDentistName: string;

  @ApiProperty({ example: '0712345678' })
  @IsString()
  ownerPhone: string;

  @ApiPropertyOptional({ example: 'Mary Otieno' })
  @IsOptional()
  @IsString()
  managerName?: string;

  @ApiProperty({ example: '0712345678' })
  @IsString()
  whatsappNumber: string;

  @ApiPropertyOptional({ example: 'clinic@example.com' })
  @IsOptional()
  @IsEmail()
  email?: string;

  // Section 3: Payment
  @ApiProperty({ example: '123456' })
  @IsString()
  mpesaTillOrPaybill: string;

  @ApiProperty({ example: 'Mombasa Dental Care' })
  @IsString()
  tillPaybillName: string;

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

  @ApiProperty({ example: 2 })
  @IsInt()
  @Min(1)
  activeDentalChairs: number;

  @ApiProperty({ enum: XRayCapability, example: 'NONE' })
  @IsEnum(XRayCapability)
  xrayCapability: XRayCapability;

  @ApiPropertyOptional({
    example: ['ORTHODONTIST', 'PEDIATRIC'],
    description: 'Specialized services available on call',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  specializedServices?: string[];

  // Section 5: Agreement
  @ApiProperty({ example: true })
  @IsBoolean()
  agreedToRateCard: boolean;

  @ApiProperty({ example: true })
  @IsBoolean()
  agreedToNoChargePolicy: boolean;
}
