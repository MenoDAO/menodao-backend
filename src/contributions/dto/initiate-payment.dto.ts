import { IsNumber, IsString, IsPositive, IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class InitiatePaymentDto {
  @ApiProperty({ example: 700, description: 'Amount in KES' })
  @IsNumber()
  @IsPositive()
  amount: number;

  @ApiProperty({ example: 'mpesa', enum: ['mpesa', 'card', 'crypto'] })
  @IsString()
  @IsIn(['mpesa', 'card', 'crypto'])
  paymentMethod: string;
}
