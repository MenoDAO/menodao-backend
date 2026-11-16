import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

const PHONE_PATTERN = /^\+?[0-9][0-9\s-]{6,19}$/;

export class CreateWhatsappInstanceDto {
  @ApiPropertyOptional({ example: 'Clinic main line' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  label?: string;

  @ApiPropertyOptional({
    example: '254713278107',
    description: 'The number that will be linked to the new instance.',
  })
  @IsOptional()
  @IsString()
  @Matches(PHONE_PATTERN, {
    message: 'phoneNumber must be international digits, e.g. 254713278107',
  })
  phoneNumber?: string;
}

export class RelinkWhatsappInstanceDto {
  @ApiProperty({
    example: '254713278107',
    description:
      'The number to link to this instance. The current WhatsApp session is ' +
      'dropped; the instance id and its key are kept.',
  })
  @IsString()
  @Matches(PHONE_PATTERN, {
    message: 'phoneNumber must be international digits, e.g. 254713278107',
  })
  phoneNumber: string;
}

export class PairingCodeDto {
  @ApiPropertyOptional({
    example: '254713278107',
    description: 'Defaults to the number stored on the instance.',
  })
  @IsOptional()
  @IsString()
  @Matches(PHONE_PATTERN, {
    message: 'phoneNumber must be international digits, e.g. 254713278107',
  })
  phoneNumber?: string;
}

export class SetInstanceKeyDto {
  @ApiProperty({
    description:
      'Instance-scoped key from the FlareSend dashboard. Stored encrypted at ' +
      'rest and never returned by any endpoint.',
  })
  @IsString()
  @MinLength(16)
  apiKey: string;
}

export class UpdateWhatsappInstanceDto {
  @ApiPropertyOptional({ example: 'Clinic main line' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  label?: string;

  @ApiPropertyOptional({
    description:
      'Bookkeeping only: FlareSend has no API for the instance webhook, so the ' +
      'value has to be set in their dashboard. Stored here so the operator can ' +
      'see which URL was intended.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  webhookUrl?: string;
}
