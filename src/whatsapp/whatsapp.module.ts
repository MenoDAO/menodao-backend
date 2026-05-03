import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { MembersModule } from '../members/members.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { PaymentModule } from '../payments/payment.module';
import { ClinicsModule } from '../clinics/clinics.module';
import { ReferralModule } from '../referrals/referral.module';
import { Web3Module } from '../web3/web3.module';
import { ContributionsModule } from '../contributions/contributions.module';
import { SessionService } from './session.service';
import { MetaApiService } from './meta-api.service';
import { LlmService } from './llm.service';
import { WhatsAppService } from './whatsapp.service';
import { WhatsAppController } from './whatsapp.controller';
import { SubscriptionFlow } from './flows/subscription.flow';
import { ClaimsFlow } from './flows/claims.flow';
import { DentalAiFlow } from './flows/dental-ai.flow';
import { VisitHistoryFlow } from './flows/visit-history.flow';
import { ReferralsFlow } from './flows/referrals.flow';
import { BlockchainFlow } from './flows/blockchain.flow';
import { AccountSettingsFlow } from './flows/account-settings.flow';
import { EscalationFlow } from './flows/escalation.flow';

@Module({
  imports: [
    HttpModule,
    ConfigModule,
    MembersModule,
    SubscriptionsModule,
    PaymentModule,
    ClinicsModule,
    ReferralModule,
    Web3Module,
    ContributionsModule,
  ],
  controllers: [WhatsAppController],
  providers: [
    SessionService,
    MetaApiService,
    LlmService,
    WhatsAppService,
    SubscriptionFlow,
    ClaimsFlow,
    DentalAiFlow,
    VisitHistoryFlow,
    ReferralsFlow,
    BlockchainFlow,
    AccountSettingsFlow,
    EscalationFlow,
  ],
  exports: [WhatsAppService],
})
export class WhatsAppModule {}
