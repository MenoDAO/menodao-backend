import { Module } from '@nestjs/common';
import { BotIdentityService } from './bot-identity.service';

@Module({
  providers: [BotIdentityService],
  exports: [BotIdentityService],
})
export class BotIdentityModule {}
