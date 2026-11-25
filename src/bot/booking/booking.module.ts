import { Module } from '@nestjs/common';
import { BotAiModule } from '../ai/ai.module';
import { SmsModule } from '../../sms/sms.module';
import { CalendarModule } from '../../calendar/calendar.module';
import { WhatsappClientsModule } from '../whatsapp-clients/whatsapp-clients.module';
import { BookingService } from './booking.service';

@Module({
  imports: [BotAiModule, SmsModule, CalendarModule, WhatsappClientsModule],
  providers: [BookingService],
  exports: [BookingService],
})
export class BookingModule { }
