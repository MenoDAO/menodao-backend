import { IsString, IsNotEmpty } from 'class-validator';

export class TriggerMemberDto {
  @IsString()
  @IsNotEmpty()
  memberId: string;
}
