import { Module } from '@nestjs/common';
import { AssemblyAiService } from './assemblyai.service';

@Module({
  providers: [AssemblyAiService],
  exports: [AssemblyAiService],
})
export class AssemblyAiModule {}
