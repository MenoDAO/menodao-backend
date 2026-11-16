import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BotChatService } from './bot-chat.service';

@Module({
  imports: [ConfigModule],
  providers: [BotChatService],
  exports: [BotChatService],
})
export class BotChatModule {}
