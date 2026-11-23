import { Module } from '@nestjs/common';
import { BotPlaygroundController } from './bot-playground.controller';
import { VoicePipelineModule } from '../voice-pipeline/voice-pipeline.module';
import { FieldDataModule } from '../field-data/field-data.module';
import { BotIdentityModule } from '../identity/identity.module';

@Module({
  imports: [VoicePipelineModule, FieldDataModule, BotIdentityModule],
  controllers: [BotPlaygroundController],
})
export class BotPlaygroundModule {}
