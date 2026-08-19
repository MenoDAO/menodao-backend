import { Global, Module } from '@nestjs/common';
import { CareEventsService } from './care-events.service';
import { CareIntelligenceController } from './care-intelligence.controller';
import { CareIntelligenceService } from './care-intelligence.service';
import { CareSnapshotJob } from './care-snapshot.job';

@Global()
@Module({
  controllers: [CareIntelligenceController],
  providers: [CareEventsService, CareIntelligenceService, CareSnapshotJob],
  exports: [CareEventsService, CareIntelligenceService],
})
export class CareIntelligenceModule {}
