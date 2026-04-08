import { Controller, Get, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import {
  ReferralService,
  LeaderboardEntry,
} from '../referrals/referral.service';

@ApiTags('Champions')
@Controller('champions')
export class ChampionsController {
  private readonly logger = new Logger(ChampionsController.name);
  private leaderboardCache: {
    data: LeaderboardEntry[];
    cachedAt: number;
  } | null = null;
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  constructor(private readonly referralService: ReferralService) {}

  @Get('leaderboard')
  @ApiOperation({
    summary: 'Get top 50 champions leaderboard (public, cached 5 min)',
  })
  async getLeaderboard(): Promise<LeaderboardEntry[]> {
    const now = Date.now();

    if (
      this.leaderboardCache &&
      now - this.leaderboardCache.cachedAt < this.CACHE_TTL_MS
    ) {
      this.logger.log('Returning cached leaderboard');
      return this.leaderboardCache.data;
    }

    this.logger.log('Fetching fresh leaderboard data');
    const data = await this.referralService.getLeaderboard(50);
    this.leaderboardCache = { data, cachedAt: now };
    return data;
  }
}
