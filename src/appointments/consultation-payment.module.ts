import { Module } from '@nestjs/common';
import { CalendarModule } from '../calendar/calendar.module';
import { SasaPayModule } from '../sasapay/sasapay.module';
import { SmsModule } from '../sms/sms.module';
import { WhatsappPaymentNoticeModule } from '../payments/whatsapp-payment-notice.module';
import { ConsultationPaymentService } from './consultation-payment.service';

@Module({
  imports: [CalendarModule, SasaPayModule, SmsModule, WhatsappPaymentNoticeModule],
  providers: [ConsultationPaymentService],
  exports: [ConsultationPaymentService],
})
export class ConsultationPaymentModule {}
