import { Module } from '@nestjs/common';
import { ContributionsService } from './contributions.service';
import { ContributionsController } from './contributions.controller';
import { BlockchainModule } from '../blockchain/blockchain.module';
import { PaymentModule } from '../payments/payment.module';

@Module({
  imports: [BlockchainModule, PaymentModule],
  controllers: [ContributionsController],
  providers: [ContributionsService],
  exports: [ContributionsService],
})
export class ContributionsModule {}
