import { Module } from '@nestjs/common';
import { PaymentService } from './payment.service';
import { PrismaModule } from '../prisma/prisma.module';
import { SasaPayModule } from '../sasapay/sasapay.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [PrismaModule, SasaPayModule, NotificationsModule],
  providers: [PaymentService],
  exports: [PaymentService],
})
export class PaymentModule {}
