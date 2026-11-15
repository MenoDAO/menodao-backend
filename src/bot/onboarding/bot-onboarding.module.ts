import { Module } from '@nestjs/common';
import { BotOnboardingService } from './bot-onboarding.service';

@Module({
  providers: [BotOnboardingService],
  exports: [BotOnboardingService],
})
export class BotOnboardingModule {}
