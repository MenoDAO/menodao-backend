import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, Matches } from 'class-validator';

export class SearchMemberDto {
  @ApiProperty({ example: '0712345678' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\+?(\d{10,13})$/, {
    message: 'Phone number must be a valid format',
  })
  phoneNumber: string;
}
