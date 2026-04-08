import { Module } from '@nestjs/common';
import { ChampionsController } from './champions.controller';
import { ReferralModule } from '../referrals/referral.module';

@Module({
  imports: [ReferralModule],
  controllers: [ChampionsController],
})
export class ChampionsModule {}
