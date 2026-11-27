import { Module } from '@nestjs/common';
import { CalendarModule } from '../calendar/calendar.module';
import { SasaPayModule } from '../sasapay/sasapay.module';
import { SmsModule } from '../sms/sms.module';
import { ConsultationPaymentService } from './consultation-payment.service';

@Module({
  imports: [CalendarModule, SasaPayModule, SmsModule],
  providers: [ConsultationPaymentService],
  exports: [ConsultationPaymentService],
})
export class ConsultationPaymentModule {}
