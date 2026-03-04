import { Module } from '@nestjs/common';
import { DisbursalService } from './disbursal.service';
import { PrismaModule } from '../prisma/prisma.module';
import { SasaPayModule } from '../sasapay/sasapay.module';

@Module({
  imports: [PrismaModule, SasaPayModule],
  providers: [DisbursalService],
  exports: [DisbursalService],
})
export class DisbursalModule {}
