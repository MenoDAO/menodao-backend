import { Module } from '@nestjs/common';
import { BotAiModule } from '../ai/ai.module';
import { FieldDataService } from './field-data.service';
import { FieldMediaStorageService } from './field-media-storage.service';

@Module({
  imports: [BotAiModule],
  providers: [FieldDataService, FieldMediaStorageService],
  exports: [FieldDataService, FieldMediaStorageService],
})
export class FieldDataModule {}
