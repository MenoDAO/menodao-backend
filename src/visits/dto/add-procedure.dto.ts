import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsUUID } from 'class-validator';

export class AddProcedureDto {
  @ApiProperty()
  @IsUUID()
  @IsNotEmpty()
  visitId: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  procedureId: string;
}
