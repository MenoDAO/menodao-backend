import { Module } from '@nestjs/common';
import { BotAiModule } from '../ai/ai.module';
import { BookingService } from './booking.service';

@Module({
  imports: [BotAiModule],
  providers: [BookingService],
  exports: [BookingService],
})
export class BookingModule {}
