import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class StatsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Get dashboard overview stats
   */
  async getOverview() {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    startOfWeek.setHours(0, 0, 0, 0);
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);

    const [
      totalMembers,
      newMembersToday,
      newMembersThisWeek,
      newMembersThisMonth,
      activeSubscriptions,
      subscriptionsByTier,
      totalRevenue,
      revenueThisMonth,
      pendingPayments,
      completedPaymentsThisMonth,
      failedPaymentsThisMonth,
      smsCountToday,
      smsCountThisWeek,
      smsCountThisMonth,
    ] = await Promise.all([
      // Total members
      this.prisma.member.count(),

      // New members today
      this.prisma.member.count({
        where: { createdAt: { gte: startOfDay } },
      }),

      // New members this week
      this.prisma.member.count({
        where: { createdAt: { gte: startOfWeek } },
      }),

      // New members this month
      this.prisma.member.count({
        where: { createdAt: { gte: startOfMonth } },
      }),

      // Active subscriptions
      this.prisma.subscription.count({
        where: { isActive: true },
      }),

      // Subscriptions by tier
      this.prisma.subscription.groupBy({
        by: ['tier'],
        _count: true,
        where: { isActive: true },
      }),

      // Total revenue (all completed contributions)
      this.prisma.contribution.aggregate({
        _sum: { amount: true },
        where: { status: 'COMPLETED' },
      }),

      // Revenue this month
      this.prisma.contribution.aggregate({
        _sum: { amount: true },
        where: {
          status: 'COMPLETED',
          createdAt: { gte: startOfMonth },
        },
      }),

      // Pending payments
      this.prisma.contribution.count({
        where: { status: 'PENDING' },
      }),

      // Completed payments this month
      this.prisma.contribution.count({
        where: {
          status: 'COMPLETED',
          createdAt: { gte: startOfMonth },
        },
      }),

      // Failed payments this month
      this.prisma.contribution.count({
        where: {
          status: 'FAILED',
          createdAt: { gte: startOfMonth },
        },
      }),

      // SMS count today
      this.prisma.smsLog.count({
        where: { createdAt: { gte: startOfDay } },
      }),

      // SMS count this week
      this.prisma.smsLog.count({
        where: { createdAt: { gte: startOfWeek } },
      }),

      // SMS count this month
      this.prisma.smsLog.count({
        where: { createdAt: { gte: startOfMonth } },
      }),
    ]);

    // Format subscriptions by tier
    const tierCounts = {
      BRONZE: 0,
      SILVER: 0,
      GOLD: 0,
    };
    subscriptionsByTier.forEach((item) => {
      tierCounts[item.tier] = item._count;
    });

    return {
      members: {
        total: totalMembers,
        newToday: newMembersToday,
        newThisWeek: newMembersThisWeek,
        newThisMonth: newMembersThisMonth,
      },
      subscriptions: {
        active: activeSubscriptions,
        byTier: tierCounts,
      },
      revenue: {
        total: totalRevenue._sum.amount || 0,
        thisMonth: revenueThisMonth._sum.amount || 0,
      },
      payments: {
        pending: pendingPayments,
        completedThisMonth: completedPaymentsThisMonth,
        failedThisMonth: failedPaymentsThisMonth,
      },
      sms: {
        today: smsCountToday,
        thisWeek: smsCountThisWeek,
        thisMonth: smsCountThisMonth,
      },
    };
  }

  /**
   * Get detailed user statistics
   */
  async getUserStats() {
    const now = new Date();
    const last30Days = Array.from({ length: 30 }, (_, i) => {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      date.setHours(0, 0, 0, 0);
      return date;
    }).reverse();

    // Get signups per day for last 30 days
    const signupsPerDay = await Promise.all(
      last30Days.map(async (date) => {
        const nextDay = new Date(date);
        nextDay.setDate(nextDay.getDate() + 1);

        const count = await this.prisma.member.count({
          where: {
            createdAt: {
              gte: date,
              lt: nextDay,
            },
          },
        });

        return {
          date: date.toISOString().split('T')[0],
          count,
        };
      }),
    );

    // Get subscription distribution
    const allSubscriptions = await this.prisma.subscription.groupBy({
      by: ['tier', 'isActive'],
      _count: true,
    });

    return {
      signupsPerDay,
      subscriptionDistribution: allSubscriptions.map((s) => ({
        tier: s.tier,
        isActive: s.isActive,
        count: s._count,
      })),
    };
  }

  /**
   * Get detailed payment statistics
   */
  async getPaymentStats() {
    const now = new Date();
    const last30Days = Array.from({ length: 30 }, (_, i) => {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      date.setHours(0, 0, 0, 0);
      return date;
    }).reverse();

    // Get payments per day for last 30 days
    const paymentsPerDay = await Promise.all(
      last30Days.map(async (date) => {
        const nextDay = new Date(date);
        nextDay.setDate(nextDay.getDate() + 1);

        const [completed, failed, revenue] = await Promise.all([
          this.prisma.contribution.count({
            where: {
              status: 'COMPLETED',
              createdAt: { gte: date, lt: nextDay },
            },
          }),
          this.prisma.contribution.count({
            where: {
              status: 'FAILED',
              createdAt: { gte: date, lt: nextDay },
            },
          }),
          this.prisma.contribution.aggregate({
            _sum: { amount: true },
            where: {
              status: 'COMPLETED',
              createdAt: { gte: date, lt: nextDay },
            },
          }),
        ]);

        return {
          date: date.toISOString().split('T')[0],
          completed,
          failed,
          revenue: revenue._sum.amount || 0,
        };
      }),
    );

    // Payment method distribution
    const paymentMethods = await this.prisma.contribution.groupBy({
      by: ['paymentMethod'],
      _count: true,
      _sum: { amount: true },
      where: { status: 'COMPLETED' },
    });

    return {
      paymentsPerDay,
      paymentMethods: paymentMethods.map((p) => ({
        method: p.paymentMethod,
        count: p._count,
        totalAmount: p._sum.amount || 0,
      })),
    };
  }

  /**
   * Get technical statistics
   */
  async getTechnicalStats() {
    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    startOfWeek.setHours(0, 0, 0, 0);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    // SMS stats by status
    const [smsStats, smsByStatus, recentSmsLogs] = await Promise.all([
      // SMS counts by period
      Promise.all([
        this.prisma.smsLog.count({ where: { createdAt: { gte: startOfDay } } }),
        this.prisma.smsLog.count({
          where: { createdAt: { gte: startOfWeek } },
        }),
        this.prisma.smsLog.count({
          where: { createdAt: { gte: startOfMonth } },
        }),
        this.prisma.smsLog.count(),
      ]),

      // SMS by status
      this.prisma.smsLog.groupBy({
        by: ['status'],
        _count: true,
      }),

      // Recent SMS logs
      this.prisma.smsLog.findMany({
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true,
          phoneNumber: true,
          status: true,
          createdAt: true,
        },
      }),
    ]);

    // Device tokens count
    const deviceTokens = await this.prisma.deviceToken.groupBy({
      by: ['platform'],
      _count: true,
    });

    // Blockchain transactions
    const txStats = await this.prisma.blockchainTransaction.groupBy({
      by: ['status'],
      _count: true,
    });

    return {
      sms: {
        today: smsStats[0],
        thisWeek: smsStats[1],
        thisMonth: smsStats[2],
        total: smsStats[3],
        byStatus: smsByStatus.map((s) => ({
          status: s.status,
          count: s._count,
        })),
        recentLogs: recentSmsLogs,
      },
      deviceTokens: deviceTokens.map((d) => ({
        platform: d.platform,
        count: d._count,
      })),
      blockchain: {
        transactionsByStatus: txStats.map((t) => ({
          status: t.status,
          count: t._count,
        })),
      },
    };
  }

  /**
   * Get recent signups
   */
  async getRecentSignups(limit = 10) {
    return this.prisma.member.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        phoneNumber: true,
        fullName: true,
        createdAt: true,
        subscription: {
          select: {
            tier: true,
            isActive: true,
          },
        },
      },
    });
  }

  /**
   * Get recent payments
   */
  async getRecentPayments(limit = 10) {
    return this.prisma.contribution.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        amount: true,
        status: true,
        paymentMethod: true,
        createdAt: true,
        member: {
          select: {
            phoneNumber: true,
            fullName: true,
          },
        },
      },
    });
  }
}
