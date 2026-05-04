import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { RenewalReminderService } from './renewal-reminder.service';
import { RenewalReminderController } from './renewal-reminder.controller';

@Module({
  imports: [PrismaModule, NotificationsModule],
  providers: [RenewalReminderService],
  controllers: [RenewalReminderController],
  exports: [RenewalReminderService],
})
export class RenewalReminderModule {}
