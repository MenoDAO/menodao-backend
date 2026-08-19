import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CareIntelligenceService } from './care-intelligence.service';

@Injectable()
export class CareSnapshotJob {
  private readonly logger = new Logger(CareSnapshotJob.name);

  constructor(private readonly careIntelligence: CareIntelligenceService) {}

  @Cron('15 2 * * *')
  async snapshotDaily() {
    try {
      await this.careIntelligence.snapshotDailyMetrics();
      this.logger.log('Stored daily care-intelligence metric snapshots');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'unknown';
      this.logger.error(`Daily snapshot failed: ${message}`);
    }
  }
}
