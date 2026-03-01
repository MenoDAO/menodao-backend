import { Module } from '@nestjs/common';
import { SubscriptionsService } from './subscriptions.service';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionRulesService } from './subscription-rules.service';
import { BlockchainModule } from '../blockchain/blockchain.module';

@Module({
  imports: [BlockchainModule],
  controllers: [SubscriptionsController],
  providers: [SubscriptionsService, SubscriptionRulesService],
  exports: [SubscriptionsService, SubscriptionRulesService],
})
export class SubscriptionsModule {}
