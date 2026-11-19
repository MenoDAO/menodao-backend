import { Module } from '@nestjs/common';
import { BrandContextService } from './brand-context.service';
import { ContextFileService } from './context-file.service';
import { ContextFileStorageService } from './context-file-storage.service';
import { ContextFileExtractService } from './context-file-extract.service';

@Module({
  providers: [
    BrandContextService,
    ContextFileService,
    ContextFileStorageService,
    ContextFileExtractService,
  ],
  exports: [
    BrandContextService,
    ContextFileService,
    ContextFileStorageService,
    ContextFileExtractService,
  ],
})
export class BrandContextModule {}
