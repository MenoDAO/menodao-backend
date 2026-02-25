import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TrackVisitDto } from './dto/track-visit.dto';

@Injectable()
export class AnalyticsService {
  constructor(private prisma: PrismaService) {}

  async trackVisit(dto: TrackVisitDto, ip?: string, userAgent?: string) {
    return this.prisma.siteVisit.create({
      data: {
        page: dto.page,
        referrer: dto.referrer || null,
        utmSource: dto.utmSource || null,
        utmMedium: dto.utmMedium || null,
        utmCampaign: dto.utmCampaign || null,
        sessionId: dto.sessionId || null,
        ip: ip ? this.hashIp(ip) : null,
        userAgent: userAgent ? userAgent.substring(0, 512) : null,
      },
    });
  }

  async getMetrics(days = 30) {
    const since = new Date();
    since.setDate(since.getDate() - days);

    const [
      totalVisits,
      uniqueSessions,
      todayVisits,
      visitsPerDay,
      topReferrers,
      topUtmSources,
      topUtmCampaigns,
      topPages,
    ] = await Promise.all([
      // Total visits in range
      this.prisma.siteVisit.count({
        where: { createdAt: { gte: since } },
      }),

      // Unique sessions in range
      this.prisma.siteVisit.groupBy({
        by: ['sessionId'],
        where: {
          createdAt: { gte: since },
          sessionId: { not: null },
        },
      }),

      // Today's visits
      this.prisma.siteVisit.count({
        where: {
          createdAt: {
            gte: new Date(new Date().setHours(0, 0, 0, 0)),
          },
        },
      }),

      // Visits per day
      this.prisma.$queryRaw`
        SELECT 
          DATE("createdAt") as date,
          COUNT(*)::int as count
        FROM "SiteVisit"
        WHERE "createdAt" >= ${since}
        GROUP BY DATE("createdAt")
        ORDER BY date ASC
      ` as Promise<{ date: Date; count: number }[]>,

      // Top referrers
      this.prisma.siteVisit.groupBy({
        by: ['referrer'],
        where: {
          createdAt: { gte: since },
          referrer: { not: null },
        },
        _count: true,
        orderBy: { _count: { referrer: 'desc' } },
        take: 10,
      }),

      // Top UTM sources
      this.prisma.siteVisit.groupBy({
        by: ['utmSource'],
        where: {
          createdAt: { gte: since },
          utmSource: { not: null },
        },
        _count: true,
        orderBy: { _count: { utmSource: 'desc' } },
        take: 10,
      }),

      // Top UTM campaigns
      this.prisma.siteVisit.groupBy({
        by: ['utmCampaign'],
        where: {
          createdAt: { gte: since },
          utmCampaign: { not: null },
        },
        _count: true,
        orderBy: { _count: { utmCampaign: 'desc' } },
        take: 10,
      }),

      // Top pages
      this.prisma.siteVisit.groupBy({
        by: ['page'],
        where: { createdAt: { gte: since } },
        _count: true,
        orderBy: { _count: { page: 'desc' } },
        take: 10,
      }),
    ]);

    return {
      summary: {
        totalVisits,
        uniqueSessions: uniqueSessions.length,
        todayVisits,
        days,
      },
      visitsPerDay: visitsPerDay.map((d) => ({
        date: d.date,
        count: d.count,
      })),
      topReferrers: topReferrers.map((r) => ({
        referrer: r.referrer,
        count: r._count,
      })),
      topUtmSources: topUtmSources.map((s) => ({
        source: s.utmSource,
        count: s._count,
      })),
      topUtmCampaigns: topUtmCampaigns.map((c) => ({
        campaign: c.utmCampaign,
        count: c._count,
      })),
      topPages: topPages.map((p) => ({
        page: p.page,
        count: p._count,
      })),
    };
  }

  /**
   * Simple hash to anonymize IP addresses for privacy.
   * Uses a basic one-way transform — not cryptographically strong,
   * but sufficient for analytics grouping.
   */
  private hashIp(ip: string): string {
    let hash = 0;
    for (let i = 0; i < ip.length; i++) {
      const char = ip.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash |= 0; // Convert to 32-bit integer
    }
    return `hashed_${Math.abs(hash).toString(36)}`;
  }
}
