import { Module } from '@nestjs/common';
import { FlaresendApiClient } from './flaresend-api.client';
import { WaboxappApiClient } from './waboxapp-api.client';
import { WhatsappApiClient } from './whatsapp-api.client';

@Module({
  providers: [FlaresendApiClient, WaboxappApiClient, WhatsappApiClient],
  exports: [FlaresendApiClient, WaboxappApiClient, WhatsappApiClient],
})
export class WhatsappClientsModule {}
