import { Module } from '@nestjs/common';
import { WhatsappPaymentNoticeModule } from './whatsapp-payment-notice.module';
import { PaymentService } from './payment.service';
import { PrismaModule } from '../prisma/prisma.module';
import { SasaPayModule } from '../sasapay/sasapay.module';
import { SmsModule } from '../sms/sms.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ReferralModule } from '../referrals/referral.module';

@Module({
  imports: [
    PrismaModule,
    SasaPayModule,
    SmsModule,
    NotificationsModule,
    ReferralModule,
    WhatsappPaymentNoticeModule,
  ],
  providers: [PaymentService],
  exports: [PaymentService],
})
export class PaymentModule {}
