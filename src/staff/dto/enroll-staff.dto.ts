import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsEnum, IsOptional } from 'class-validator';
import { StaffRole } from '@prisma/client';

export class EnrollStaffDto {
  @ApiProperty({ example: 'jdoe' })
  @IsString()
  @IsNotEmpty()
  username: string;

  @ApiProperty({ example: 'password123' })
  @IsString()
  @IsNotEmpty()
  password: string;

  @ApiProperty({ example: 'John Doe' })
  @IsString()
  @IsNotEmpty()
  fullName: string;

  @ApiProperty({ enum: StaffRole, example: StaffRole.STAFF })
  @IsEnum(StaffRole)
  role: StaffRole;

  @ApiProperty({ example: 'Nairobi', required: false })
  @IsString()
  @IsOptional()
  branch?: string;
}
