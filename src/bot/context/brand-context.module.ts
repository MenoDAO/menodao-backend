import { Module } from '@nestjs/common';
import { BrandContextService } from './brand-context.service';

@Module({
  providers: [BrandContextService],
  exports: [BrandContextService],
})
export class BrandContextModule {}
