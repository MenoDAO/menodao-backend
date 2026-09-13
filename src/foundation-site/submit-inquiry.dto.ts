import { IsObject, IsString } from 'class-validator';

export class SubmitFoundationInquiryDto {
  @IsString()
  formId: string;

  @IsObject()
  fields: Record<string, unknown>;
}
