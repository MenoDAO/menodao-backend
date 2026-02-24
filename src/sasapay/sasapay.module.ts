import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SasaPayService } from './sasapay.service';

@Module({
  imports: [ConfigModule],
  providers: [SasaPayService],
  exports: [SasaPayService],
})
export class SasaPayModule {}
