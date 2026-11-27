import { Module, forwardRef } from '@nestjs/common';
import { WhatsappClientsModule } from '../bot/whatsapp-clients/whatsapp-clients.module';
import { WhatsappMonthlyRenewalJob } from './whatsapp-monthly-renewal.job';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { RenewalReminderService } from './renewal-reminder.service';
import { RenewalReminderController } from './renewal-reminder.controller';

@Module({
  imports: [PrismaModule, WhatsappClientsModule, forwardRef(() => NotificationsModule)],
  providers: [RenewalReminderService, WhatsappMonthlyRenewalJob],
  controllers: [RenewalReminderController],
  exports: [RenewalReminderService],
})
export class RenewalReminderModule {}
