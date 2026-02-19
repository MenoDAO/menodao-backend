import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { AdminModule } from '../admin/admin.module';
import { NotificationsService } from './notifications.service';
import {
  NotificationsController,
  AlertsController,
} from './notifications.controller';

@Module({
  imports: [
    PrismaModule,
    forwardRef(() => AdminModule),
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
  controllers: [NotificationsController, AlertsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
