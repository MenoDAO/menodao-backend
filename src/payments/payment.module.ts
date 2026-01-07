import { Module } from '@nestjs/common';
import { PaymentService } from './payment.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [PaymentService],
  exports: [PaymentService],
})
export class PaymentModule {}
