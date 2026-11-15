import { Module } from '@nestjs/common';
import { BotContextService } from './bot-context.service';

@Module({
  providers: [BotContextService],
  exports: [BotContextService],
})
export class BotContextModule {}
