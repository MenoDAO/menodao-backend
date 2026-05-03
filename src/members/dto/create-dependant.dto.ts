import { IsString, IsNotEmpty, MaxLength, IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateDependantDto {
  @ApiProperty({ example: 'Jane Doe', maxLength: 100 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  fullName: string;

  @ApiProperty({ example: 'Parent/Child', enum: ['Parent/Child'] })
  @IsString()
  @IsIn(['Parent/Child'])
  relationship: string;
}
