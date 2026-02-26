import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AdminModule } from '../admin/admin.module';
import { NotificationsService } from './notifications.service';
import {
  NotificationsController,
  AlertsController,
} from './notifications.controller';

@Module({
  imports: [PrismaModule, forwardRef(() => AdminModule)],
  controllers: [NotificationsController, AlertsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
