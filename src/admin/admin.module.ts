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
import { BrandContextModule } from '../bot/context/brand-context.module';
import { AdminBrandContextController } from './brand-context.controller';
import { BotInstancesModule } from '../bot/instances/bot-instances.module';
import { BotChatModule } from '../bot/chat/bot-chat.module';
import { WhatsappClientsModule } from '../bot/whatsapp-clients/whatsapp-clients.module';
import { AdminWhatsappController } from './whatsapp/whatsapp-instance.controller';
import { AdminWhatsappService } from './whatsapp/whatsapp-instance.service';
import { AdminBotChatController } from './whatsapp/bot-chat.controller';
import { AdminUsersController } from './admin-users.controller';
import { CapabilityGuard } from './guards/capabilities.guard';

@Global()
@Module({
  imports: [
    PrismaModule,
    AnalyticsModule,
    forwardRef(() => SubscriptionsModule),
    forwardRef(() => ReferralModule),
    BrandContextModule,
    BotInstancesModule,
    BotChatModule,
    WhatsappClientsModule,
  ],
  controllers: [
    AdminController,
    AdminUsersController,
    StatsController,
    UsersController,
    PaymentsController,
    AdminBrandContextController,
    AdminWhatsappController,
    AdminBotChatController,
  ],
  providers: [
    AdminService,
    AuditLogService,
    StatsService,
    AdminAuthGuard,
    RolesGuard,
    CapabilityGuard,
    AdminWhatsappService,
  ],
  exports: [AdminService, AuditLogService, AdminAuthGuard],
})
export class AdminModule {}
