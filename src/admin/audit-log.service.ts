import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditLogEntry {
  adminId: string;
  action: string;
  targetType: 'PAYMENT' | 'MEMBER' | 'SUBSCRIPTION' | 'DISBURSAL';
  targetId: string;
  reason: string;
  metadata?: any;
  ipAddress: string;
}

@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Log an admin action
   * Requirements: 3.8, 25.1-25.7
   */
  async logAction(entry: AuditLogEntry) {
    const auditLog = await this.prisma.auditLog.create({
      data: {
        adminId: entry.adminId,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId,
        reason: entry.reason,
        metadata: entry.metadata,
        ipAddress: entry.ipAddress,
      },
    });

    this.logger.log(
      `Admin action logged: ${entry.action} on ${entry.targetType} ${entry.targetId} by ${entry.adminId}`,
    );

    return auditLog;
  }

  /**
   * Get action history for a specific target
   */
  async getActionHistory(targetId: string) {
    return this.prisma.auditLog.findMany({
      where: { targetId },
      include: {
        admin: {
          select: {
            id: true,
            username: true,
          },
        },
      },
      orderBy: { timestamp: 'desc' },
    });
  }

  /**
   * Get all actions by a specific admin
   */
  async getAdminActions(
    adminId: string,
    dateRange?: { from: Date; to: Date },
    limit = 20,
  ) {
    const where: Prisma.AuditLogWhereInput = { adminId };

    if (dateRange) {
      where.timestamp = {
        gte: dateRange.from,
        lte: dateRange.to,
      };
    }

    return this.prisma.auditLog.findMany({
      where,
      orderBy: { timestamp: 'desc' },
      take: Math.min(50, Math.max(1, limit)),
    });
  }

  async getMyActivity(adminId: string, limit = 20) {
    const logs = await this.getAdminActions(adminId, undefined, limit);
    const titles: Record<string, string> = {
      SUSPEND_MEMBER: 'Suspended a member',
      DEACTIVATE_SUBSCRIPTION: 'Deactivated a subscription',
      VERIFY_PAYMENT: 'Verified a payment',
      SYNC_PAYMENT_STATUS: 'Synced payment status',
    };
    return {
      items: logs.map((log) => ({
        id: log.id,
        at: log.timestamp.toISOString(),
        kind: 'AUDIT' as const,
        title: titles[log.action] || log.action.replace(/_/g, ' ').toLowerCase(),
        detail: [log.targetType, log.reason].filter(Boolean).join(' — ') || undefined,
      })),
    };
  }

  /**
   * Get recent audit logs (for admin dashboard)
   */
  async getRecentLogs(limit: number = 50) {
    return this.prisma.auditLog.findMany({
      include: {
        admin: {
          select: {
            id: true,
            username: true,
          },
        },
      },
      orderBy: { timestamp: 'desc' },
      take: limit,
    });
  }
}
