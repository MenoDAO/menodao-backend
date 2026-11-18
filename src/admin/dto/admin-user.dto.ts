import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export const ADMIN_ROLES = [
  'SUPER_ADMIN',
  'JUNIOR_ADMIN',
  'CUSTOMER_SERVICE',
] as const;

export class CreateAdminDto {
  @ApiProperty({ example: 'junior.dev' })
  @IsString()
  @MinLength(3)
  @MaxLength(64)
  @Matches(/^[a-zA-Z0-9._-]+$/, {
    message:
      'Username may contain letters, numbers, dots, dashes and underscores',
  })
  username: string;

  @ApiProperty({ enum: ADMIN_ROLES, example: 'JUNIOR_ADMIN' })
  @IsIn([...ADMIN_ROLES])
  role: (typeof ADMIN_ROLES)[number];

  @ApiPropertyOptional({ example: '254712345678' })
  @IsOptional()
  @IsString()
  @Matches(/^\+?\d{9,15}$/, {
    message: 'Phone number must be 9-15 digits, optionally prefixed with +',
  })
  phoneNumber?: string;
}

export class UpdateAdminDto {
  @ApiPropertyOptional({ enum: ADMIN_ROLES })
  @IsOptional()
  @IsIn([...ADMIN_ROLES])
  role?: (typeof ADMIN_ROLES)[number];

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ example: '254712345678', nullable: true })
  @IsOptional()
  @IsString()
  @Matches(/^\+?\d{9,15}$/, {
    message: 'Phone number must be 9-15 digits, optionally prefixed with +',
  })
  phoneNumber?: string | null;
}

export class AcceptInviteDto {
  @ApiProperty({ description: 'One-time invite token shown at creation' })
  @IsString()
  @MinLength(32)
  token: string;

  @ApiProperty({ example: 'a-strong-password' })
  @IsString()
  @MinLength(8)
  password: string;
}
