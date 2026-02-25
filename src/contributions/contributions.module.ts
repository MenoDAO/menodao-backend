import { Module, forwardRef } from '@nestjs/common';
import { ContributionsService } from './contributions.service';
import { ContributionsController } from './contributions.controller';
import { BlockchainModule } from '../blockchain/blockchain.module';
import { PaymentModule } from '../payments/payment.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { ClaimsModule } from '../claims/claims.module';

@Module({
  imports: [
    BlockchainModule,
    PaymentModule,
    forwardRef(() => SubscriptionsModule),
    ClaimsModule,
  ],
  controllers: [ContributionsController],
  providers: [ContributionsService],
  exports: [ContributionsService],
})
export class ContributionsModule {}
