import { Module } from '@nestjs/common';
import { SubscriptionsService } from './subscriptions.service';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionRulesService } from './subscription-rules.service';
import { BlockchainModule } from '../blockchain/blockchain.module';
import { RenewalReminderModule } from '../renewal-reminders/renewal-reminder.module';

@Module({
  imports: [BlockchainModule, RenewalReminderModule],
  controllers: [SubscriptionsController],
  providers: [SubscriptionsService, SubscriptionRulesService],
  exports: [SubscriptionsService, SubscriptionRulesService],
})
export class SubscriptionsModule {}
