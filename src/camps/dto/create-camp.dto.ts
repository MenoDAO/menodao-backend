import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  IsDateString,
  IsBoolean,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateCampDto {
  @ApiProperty({ example: 'Nairobi Dental Camp 2024' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: 'Annual dental checkup camp' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ example: 'KICC Grounds' })
  @IsString()
  @IsNotEmpty()
  venue: string;

  @ApiProperty({ example: 'Nairobi' })
  @IsString()
  @IsNotEmpty()
  address: string;

  @ApiProperty({ example: -1.2921 })
  @IsNumber()
  latitude: number;

  @ApiProperty({ example: 36.8219 })
  @IsNumber()
  longitude: number;

  @ApiProperty({ example: '2024-03-01T09:00:00Z' })
  @IsDateString()
  startDate: string;

  @ApiProperty({ example: '2024-03-03T17:00:00Z' })
  @IsDateString()
  endDate: string;

  @ApiProperty({ example: 100 })
  @IsNumber()
  @IsOptional()
  capacity?: number;
}

export class UpdateCampDto {
  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  venue?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  address?: string;

  @ApiProperty({ required: false })
  @IsNumber()
  @IsOptional()
  latitude?: number;

  @ApiProperty({ required: false })
  @IsNumber()
  @IsOptional()
  longitude?: number;

  @ApiProperty({ required: false })
  @IsDateString()
  @IsOptional()
  startDate?: string;

  @ApiProperty({ required: false })
  @IsDateString()
  @IsOptional()
  endDate?: string;

  @ApiProperty({ required: false })
  @IsNumber()
  @IsOptional()
  capacity?: number;

  @ApiProperty({ required: false })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class AssignMemberDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  memberId: string;
}
