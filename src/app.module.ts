import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { MembersModule } from './members/members.module';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';
import { ContributionsModule } from './contributions/contributions.module';
import { ClaimsModule } from './claims/claims.module';
import { CampsModule } from './camps/camps.module';
import { BlockchainModule } from './blockchain/blockchain.module';
import { PrismaModule } from './prisma/prisma.module';
import { SmsModule } from './sms/sms.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    PrismaModule,
    SmsModule,
    AuthModule,
    MembersModule,
    SubscriptionsModule,
    ContributionsModule,
    ClaimsModule,
    CampsModule,
    BlockchainModule,
  ],
})
export class AppModule {}
