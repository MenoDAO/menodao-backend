import { Module } from '@nestjs/common';
import { PaymentService } from './payment.service';
import { PrismaModule } from '../prisma/prisma.module';
import { SasaPayModule } from '../sasapay/sasapay.module';

@Module({
  imports: [PrismaModule, SasaPayModule],
  providers: [PaymentService],
  exports: [PaymentService],
})
export class PaymentModule {}
