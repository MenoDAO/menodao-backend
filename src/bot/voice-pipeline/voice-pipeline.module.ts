import { Module } from '@nestjs/common';
import { BotAiModule } from '../ai/ai.module';
import { AssemblyAiModule } from '../assemblyai/assemblyai.module';
import { BookingModule } from '../booking/booking.module';
import { BotIdentityModule } from '../identity/identity.module';
import { VoicePipelineService } from './voice-pipeline.service';

@Module({
  imports: [BotAiModule, AssemblyAiModule, BookingModule, BotIdentityModule],
  providers: [VoicePipelineService],
  exports: [VoicePipelineService],
})
export class VoicePipelineModule {}
