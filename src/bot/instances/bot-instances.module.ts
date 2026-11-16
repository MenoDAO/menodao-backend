import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BotInstanceSecretService } from './bot-instance-secret.service';
import { BotInstanceStore } from './bot-instance.store';

@Module({
  imports: [ConfigModule],
  providers: [BotInstanceSecretService, BotInstanceStore],
  exports: [BotInstanceSecretService, BotInstanceStore],
})
export class BotInstancesModule {}
