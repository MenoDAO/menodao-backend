import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { APP_FILTER } from '@nestjs/core';
import { PrismaModule } from '../prisma/prisma.module';
import { AdminModule } from '../admin/admin.module';
import { NotificationsService } from './notifications.service';
import { SanitizationService } from './sanitization.service';
import { FilterService } from './filter.service';
import { SMSService } from './sms.service';
import { PushService } from './push.service';
import {
  NotificationsController,
  AlertsController,
  AdminNotificationController,
} from './notifications.controller';
import { NotificationExceptionFilter } from './filters/notification-exception.filter';

@Module({
  imports: [
    PrismaModule,
    forwardRef(() => AdminModule),
    ThrottlerModule.forRoot([
      {
        ttl: 3600000, // 1 hour in milliseconds
        limit: 10, // 10 requests per hour
      },
    ]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const secret = configService.get<string>('JWT_SECRET');
        if (!secret) {
          throw new Error(
            'JWT_SECRET environment variable is not set. Cannot start the application.',
          );
        }
        return { secret };
      },
    }),
  ],
  controllers: [
    NotificationsController,
    AlertsController,
    AdminNotificationController,
  ],
  providers: [
    NotificationsService,
    SanitizationService,
    FilterService,
    SMSService,
    PushService,
    {
      provide: APP_FILTER,
      useClass: NotificationExceptionFilter,
    },
  ],
  exports: [
    NotificationsService,
    SanitizationService,
    FilterService,
    SMSService,
    PushService,
  ],
})
export class NotificationsModule {}
