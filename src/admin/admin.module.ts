import { Module, Global } from '@nestjs/common';
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

@Global()
@Module({
  imports: [PrismaModule, AnalyticsModule, SubscriptionsModule],
  controllers: [
    AdminController,
    StatsController,
    UsersController,
    PaymentsController,
  ],
  providers: [
    AdminService,
    AuditLogService,
    StatsService,
    AdminAuthGuard,
    RolesGuard,
  ],
  exports: [AdminService, AuditLogService, AdminAuthGuard],
})
export class AdminModule {}
