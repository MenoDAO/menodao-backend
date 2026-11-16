import { Module, Global, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AuditLogService } from './audit-log.service';
import { StatsController } from './stats.controller';
import { StatsService } from './stats.service';
import { UsersController } from './users.controller';
import { PaymentsController } from './payments.controller';
import { AdminAuthGuard } from './guards/admin-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { AnalyticsModule } from '../analytics/analytics.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { ReferralModule } from '../referrals/referral.module';
import { BotContextModule } from '../bot/context/bot-context.module';
import { AdminBotContextController } from './bot-context.controller';
import { BotInstancesModule } from '../bot/instances/bot-instances.module';
import { BotChatModule } from '../bot/chat/bot-chat.module';
import { WhatsappClientsModule } from '../bot/whatsapp-clients/whatsapp-clients.module';
import { AdminWhatsappController } from './whatsapp/whatsapp-instance.controller';
import { AdminWhatsappService } from './whatsapp/whatsapp-instance.service';
import { AdminBotChatController } from './whatsapp/bot-chat.controller';

@Global()
@Module({
  imports: [
    PrismaModule,
    AnalyticsModule,
    forwardRef(() => SubscriptionsModule),
    forwardRef(() => ReferralModule),
    BotContextModule,
    BotInstancesModule,
    BotChatModule,
    WhatsappClientsModule,
  ],
  controllers: [
    AdminController,
    StatsController,
    UsersController,
    PaymentsController,
    AdminBotContextController,
    AdminWhatsappController,
    AdminBotChatController,
  ],
  providers: [
    AdminService,
    AuditLogService,
    StatsService,
    AdminAuthGuard,
    RolesGuard,
    AdminWhatsappService,
  ],
  exports: [AdminService, AuditLogService, AdminAuthGuard],
})
export class AdminModule {}
