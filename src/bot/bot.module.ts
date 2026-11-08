import { Logger, Module, Provider } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BotAiModule } from './ai/ai.module';
import { AssemblyAiModule } from './assemblyai/assemblyai.module';
import { BookingModule } from './booking/booking.module';
import { VoicePipelineModule } from './voice-pipeline/voice-pipeline.module';
import { WhatsappClientsModule } from './whatsapp-clients/whatsapp-clients.module';
import { FlaresendApiClient } from './whatsapp-clients/flaresend-api.client';
import { WaboxappApiClient } from './whatsapp-clients/waboxapp-api.client';
import { WHATSAPP_CLIENT } from './whatsapp-clients/whatsapp-provider.interface';
import { BotIdentityService } from './identity/bot-identity.service';
import { BotGatewayService } from './webhook/bot-gateway.service';
import { BotGatewayController } from './webhook/bot-gateway.controller';

const logger = new Logger('BotModule');

const whatsappProviderFactory: Provider = {
  provide: WHATSAPP_CLIENT,
  inject: [ConfigService, FlaresendApiClient, WaboxappApiClient],
  useFactory: (
    configService: ConfigService,
    flaresendApiClient: FlaresendApiClient,
    waboxappApiClient: WaboxappApiClient,
  ) => {
    const provider = (
      configService.get<string>('WHATSAPP_PROVIDER') ?? 'flaresend'
    ).toLowerCase();
    logger.log(`Wiring WHATSAPP_CLIENT token to "${provider}" provider.`);
    switch (provider) {
      case 'waboxapp':
        return waboxappApiClient;
      case 'meta':
        // Meta sends go through the existing backend MetaApiService.
        // Fall back to Waboxapp client shape so bot gateway still boots;
        // Meta inbound text stays on /whatsapp/webhook in production.
        logger.warn(
          'WHATSAPP_PROVIDER=meta — bot gateway send uses Waboxapp client; configure Meta via /whatsapp/webhook.',
        );
        return waboxappApiClient;
      case 'flaresend':
      default:
        return flaresendApiClient;
    }
  },
};

@Module({
  imports: [
    ConfigModule,
    BotAiModule,
    AssemblyAiModule,
    BookingModule,
    VoicePipelineModule,
    WhatsappClientsModule,
  ],
  controllers: [BotGatewayController],
  providers: [whatsappProviderFactory, BotIdentityService, BotGatewayService],
  exports: [BotIdentityService, BotGatewayService],
})
export class BotModule {}
