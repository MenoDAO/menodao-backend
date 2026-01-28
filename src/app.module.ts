import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { MembersModule } from './members/members.module';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';
import { ContributionsModule } from './contributions/contributions.module';
import { ClaimsModule } from './claims/claims.module';
import { CampsModule } from './camps/camps.module';
import { BlockchainModule } from './blockchain/blockchain.module';
import { PrismaModule } from './prisma/prisma.module';
import { SmsModule } from './sms/sms.module';
import { AdminModule } from './admin/admin.module';
import { NotificationsModule } from './notifications/notifications.module';
import { ProceduresModule } from './procedures/procedures.module';
import { StaffModule } from './staff/staff.module';
import { VisitsModule } from './visits/visits.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    PrismaModule,
    SmsModule,
    StaffModule,
    ProceduresModule,
    VisitsModule,
    AuthModule,
    MembersModule,
    SubscriptionsModule,
    ContributionsModule,
    ClaimsModule,
    CampsModule,
    BlockchainModule,
    AdminModule,
    NotificationsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
