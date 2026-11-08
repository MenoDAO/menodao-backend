import { Module } from '@nestjs/common';
import { VoicePipelineService } from './voice-pipeline.service';

@Module({
  providers: [VoicePipelineService],
  exports: [VoicePipelineService],
})
export class VoicePipelineModule {}
