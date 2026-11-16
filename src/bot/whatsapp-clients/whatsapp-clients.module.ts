import { Module } from '@nestjs/common';
import { BotInstancesModule } from '../instances/bot-instances.module';
import { FlaresendApiClient } from './flaresend-api.client';
import { WaboxappApiClient } from './waboxapp-api.client';
import { WhatsappApiClient } from './whatsapp-api.client';

@Module({
  imports: [BotInstancesModule],
  providers: [FlaresendApiClient, WaboxappApiClient, WhatsappApiClient],
  exports: [FlaresendApiClient, WaboxappApiClient, WhatsappApiClient],
})
export class WhatsappClientsModule {}
