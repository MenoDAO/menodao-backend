import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CalendarTokenCipherService } from './calendar-token-cipher.service';
import { CalendarConfigService } from './calendar-config.service';
import { GoogleCalendarProvider } from './google-calendar.provider';
import { MicrosoftCalendarProvider } from './microsoft-calendar.provider';
import { CalendarSyncService } from './calendar-sync.service';

@Module({
  imports: [PrismaModule],
  providers: [
    CalendarTokenCipherService,
    CalendarConfigService,
    GoogleCalendarProvider,
    MicrosoftCalendarProvider,
    CalendarSyncService,
  ],
  exports: [CalendarSyncService, CalendarConfigService],
})
export class CalendarModule {}
