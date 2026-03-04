import {
  Injectable,
  UnauthorizedException,
  OnModuleInit,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AdminService implements OnModuleInit {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  /**
   * Initialize default admin user if none exists
   */
  async onModuleInit() {
    const adminCount = await this.prisma.adminUser.count();

    if (adminCount === 0) {
      const defaultUsername =
        this.configService.get<string>('ADMIN_USERNAME') || 'admin';
      const defaultPassword =
        this.configService.get<string>('ADMIN_DEFAULT_PASSWORD') ||
        'menodao2026!';

      const passwordHash = await bcrypt.hash(defaultPassword, 10);

      await this.prisma.adminUser.create({
        data: {
          username: defaultUsername,
          passwordHash,
        },
      });

      this.logger.log(`Default admin user created: ${defaultUsername}`);
    }
  }

  /**
   * Validate admin credentials and return JWT token
   */
  async login(
    username: string,
    password: string,
  ): Promise<{ accessToken: string; admin: { id: string; username: string } }> {
    const admin = await this.prisma.adminUser.findUnique({
      where: { username },
    });

    if (!admin) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(password, admin.passwordHash);

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Update last login
    await this.prisma.adminUser.update({
      where: { id: admin.id },
      data: { lastLogin: new Date() },
    });

    const payload = {
      sub: admin.id,
      username: admin.username,
      type: 'admin',
    };

    const secret = this.configService.get<string>('JWT_SECRET');
    if (!secret) {
      throw new UnauthorizedException('JWT_SECRET is not configured');
    }

    const accessToken = this.jwtService.sign(payload, {
      secret,
      expiresIn: '24h', // Longer expiry for admin sessions
    });

    return {
      accessToken,
      admin: {
        id: admin.id,
        username: admin.username,
      },
    };
  }

  /**
   * Change admin password
   */
  async changePassword(
    adminId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<{ message: string }> {
    const admin = await this.prisma.adminUser.findUnique({
      where: { id: adminId },
    });

    if (!admin) {
      throw new UnauthorizedException('Admin not found');
    }

    const isPasswordValid = await bcrypt.compare(
      currentPassword,
      admin.passwordHash,
    );

    if (!isPasswordValid) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    const newPasswordHash = await bcrypt.hash(newPassword, 10);

    await this.prisma.adminUser.update({
      where: { id: adminId },
      data: { passwordHash: newPasswordHash },
    });

    return { message: 'Password changed successfully' };
  }

  /**
   * Verify admin JWT token
   */
  async validateAdminToken(payload: {
    sub: string;
    type: string;
  }): Promise<{ id: string; username: string } | null> {
    if (payload.type !== 'admin') {
      return null;
    }

    const admin = await this.prisma.adminUser.findUnique({
      where: { id: payload.sub },
      select: { id: true, username: true },
    });

    return admin;
  }

  /**
   * Get admin profile
   */
  async getProfile(adminId: string) {
    const admin = await this.prisma.adminUser.findUnique({
      where: { id: adminId },
      select: {
        id: true,
        username: true,
        lastLogin: true,
        createdAt: true,
      },
    });

    return admin;
  }

  /**
   * Search payments by various criteria
   * Requirements: 1.1, 1.5
   */
  async searchPayments(query: {
    transactionId?: string;
    phoneNumber?: string;
    email?: string;
    status?: string;
    dateFrom?: Date;
    dateTo?: Date;
  }) {
    const where: any = {};

    if (query.transactionId) {
      where.paymentRef = { contains: query.transactionId };
    }

    if (query.status) {
      where.status = query.status;
    }

    if (query.dateFrom || query.dateTo) {
      where.createdAt = {};
      if (query.dateFrom) where.createdAt.gte = query.dateFrom;
      if (query.dateTo) where.createdAt.lte = query.dateTo;
    }

    // If searching by phone or email, need to join with member
    if (query.phoneNumber || query.email) {
      where.member = {};
      if (query.phoneNumber) {
        where.member.phoneNumber = { contains: query.phoneNumber };
      }
      if (query.email) {
        where.member.email = { contains: query.email };
      }
    }

    const payments = await this.prisma.contribution.findMany({
      where,
      include: {
        member: {
          select: {
            id: true,
            phoneNumber: true,
            fullName: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return payments.map((payment) => this.buildPaymentDetailResponse(payment));
  }

  /**
   * Get payment detail by transaction ID
   * Requirements: 1.2, 1.3, 1.4, 1.6, 1.7
   */
  async getPaymentDetail(transactionId: string) {
    const payment = await this.prisma.contribution.findFirst({
      where: {
        OR: [
          { id: transactionId },
          { paymentRef: transactionId },
          { paymentRef: { contains: transactionId } },
        ],
      },
      include: {
        member: {
          select: {
            id: true,
            phoneNumber: true,
            fullName: true,
            subscription: true,
          },
        },
      },
    });

    if (!payment) {
      throw new UnauthorizedException('Payment not found');
    }

    return this.buildPaymentDetailResponse(payment);
  }

  /**
   * Build payment detail response
   */
  private buildPaymentDetailResponse(payment: any) {
    const metadata = payment.metadata || {};

    return {
      id: payment.id,
      transactionId: payment.paymentRef || payment.id,
      userId: payment.memberId,
      userPhone: payment.member?.phoneNumber,
      userEmail: payment.member?.email,
      amount: payment.amount,
      status: payment.status,
      subscriptionType: payment.member?.subscription?.tier || 'N/A',
      paymentFrequency: payment.paymentFrequency || 'MONTHLY',
      createdAt: payment.createdAt,
      updatedAt: payment.updatedAt,
      confirmedAt: payment.confirmedAt,
      claimLimitsAssigned: payment.claimLimitsAssigned || false,
      claimLimitsAssignedAt: payment.claimLimitsAssignedAt,
      sasaPayData: {
        merchantRequestId:
          metadata.merchantRequestId || payment.merchantRequestId,
        checkoutRequestId:
          metadata.checkoutRequestId || payment.checkoutRequestId,
        mpesaReceiptNumber:
          metadata.mpesaReceiptNumber || payment.mpesaReceiptNumber,
      },
      relatedLinks: {
        userProfile: `/admin/members/${payment.memberId}`,
        subscription: `/admin/subscriptions/${payment.member?.subscription?.id}`,
        claims: [],
      },
    };
  }

  /**
   * Search members by phone, email, or ID
   * Requirements: 2.1
   */
  async searchMembers(query: {
    phoneNumber?: string;
    email?: string;
    memberId?: string;
  }) {
    const where: any = {};

    if (query.memberId) {
      where.id = query.memberId;
    }

    if (query.phoneNumber) {
      where.phoneNumber = { contains: query.phoneNumber };
    }

    if (query.email) {
      where.email = { contains: query.email };
    }

    const members = await this.prisma.member.findMany({
      where,
      include: {
        subscription: true,
        contributions: {
          where: { status: 'COMPLETED' },
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
        claims: {
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
      },
      take: 50,
    });

    return members.map((member) => this.buildMemberDetailResponse(member));
  }

  /**
   * Get member detail by ID
   * Requirements: 2.2, 2.3, 2.4, 2.5, 2.6, 2.7
   */
  async getMemberDetail(memberId: string) {
    const member = await this.prisma.member.findUnique({
      where: { id: memberId },
      include: {
        subscription: true,
        contributions: {
          where: { status: 'COMPLETED' },
          orderBy: { createdAt: 'desc' },
        },
        claims: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!member) {
      throw new UnauthorizedException('Member not found');
    }

    return this.buildMemberDetailResponse(member);
  }

  /**
   * Build member detail response
   */
  private buildMemberDetailResponse(member: any) {
    const subscription = member.subscription;
    const totalClaimed = member.claims
      .filter((c: any) => c.status === 'DISBURSED')
      .reduce((sum: number, c: any) => sum + c.amount, 0);

    // Calculate waiting period status
    let waitingPeriodStatus: {
      consultationsExtractions: {
        available: boolean;
        daysRemaining: number;
      };
      restorativeProcedures: {
        available: boolean;
        daysRemaining: number;
      };
    } | null = null;
    if (subscription) {
      const startDate =
        subscription.subscriptionStartDate || subscription.startDate;
      const daysSinceStart = Math.floor(
        (Date.now() - startDate.getTime()) / (1000 * 60 * 60 * 24),
      );

      const isAnnual = subscription.paymentFrequency === 'ANNUAL';
      const emergencyRequired = isAnnual ? 14 : 60;
      const restorativeRequired = isAnnual ? 14 : 90;

      waitingPeriodStatus = {
        consultationsExtractions: {
          available: daysSinceStart >= emergencyRequired,
          daysRemaining: Math.max(0, emergencyRequired - daysSinceStart),
        },
        restorativeProcedures: {
          available: daysSinceStart >= restorativeRequired,
          daysRemaining: Math.max(0, restorativeRequired - daysSinceStart),
        },
      };
    }

    return {
      id: member.id,
      fullName: member.fullName,
      phoneNumber: member.phoneNumber,
      email: member.email,
      location: member.location,
      registrationDate: member.createdAt,
      accountStatus: 'ACTIVE', // TODO: Add account status field
      subscription: subscription
        ? {
            tier: subscription.tier,
            status: subscription.isActive ? 'ACTIVE' : 'INACTIVE',
            startDate: subscription.startDate,
            paymentFrequency: subscription.paymentFrequency,
            annualCapLimit: subscription.annualCapLimit,
            annualCapUsed: subscription.annualCapUsed,
            remainingLimit:
              subscription.annualCapLimit - subscription.annualCapUsed,
          }
        : null,
      paymentHistory: member.contributions.map((c: any) => ({
        id: c.id,
        transactionId: c.paymentRef,
        amount: c.amount,
        date: c.createdAt,
        status: c.status,
      })),
      claimSummary: {
        totalClaims: member.claims.length,
        totalAmountClaimed: totalClaimed,
        remainingLimit: subscription
          ? subscription.annualCapLimit - subscription.annualCapUsed
          : 0,
      },
      waitingPeriodStatus,
    };
  }

  /**
   * Suspend a member
   * Requirements: 3.1, 3.2
   */
  async suspendMember(targetId: string, reason: string, adminId: string) {
    // TODO: Add account status field to Member model
    // For now, we'll deactivate their subscription

    const member = await this.prisma.member.findUnique({
      where: { id: targetId },
      include: { subscription: true },
    });

    if (!member) {
      throw new UnauthorizedException('Member not found');
    }

    if (member.subscription) {
      await this.prisma.subscription.update({
        where: { id: member.subscription.id },
        data: { isActive: false },
      });
    }

    // Log action
    await this.logAdminAction({
      adminId,
      action: 'SUSPEND_MEMBER',
      targetType: 'MEMBER',
      targetId,
      reason,
      metadata: { previousStatus: member.subscription?.isActive },
      ipAddress: '0.0.0.0', // TODO: Get from request
    });

    return {
      success: true,
      message: 'Member suspended successfully',
      updatedRecord: member,
    };
  }

  /**
   * Deactivate a subscription
   * Requirements: 3.3, 3.4
   */
  async deactivateSubscription(
    targetId: string,
    reason: string,
    adminId: string,
  ) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { id: targetId },
    });

    if (!subscription) {
      throw new UnauthorizedException('Subscription not found');
    }

    await this.prisma.subscription.update({
      where: { id: targetId },
      data: {
        isActive: false,
        annualCapUsed: 0, // Revoke claim limits
      },
    });

    // Log action
    await this.logAdminAction({
      adminId,
      action: 'DEACTIVATE_SUBSCRIPTION',
      targetType: 'SUBSCRIPTION',
      targetId,
      reason,
      metadata: { previousStatus: subscription.isActive },
      ipAddress: '0.0.0.0',
    });

    return {
      success: true,
      message: 'Subscription deactivated successfully',
      updatedRecord: subscription,
    };
  }

  /**
   * Verify payment manually
   * Requirements: 3.5, 3.6
   */
  async verifyPaymentManually(
    targetId: string,
    reason: string,
    adminId: string,
  ) {
    const payment = await this.prisma.contribution.findFirst({
      where: {
        OR: [{ id: targetId }, { paymentRef: targetId }],
      },
      include: {
        member: {
          include: { subscription: true },
        },
      },
    });

    if (!payment) {
      throw new UnauthorizedException('Payment not found');
    }

    // Update payment to completed
    await this.prisma.contribution.update({
      where: { id: payment.id },
      data: {
        status: 'COMPLETED',
        confirmedAt: new Date(),
        claimLimitsAssigned: true,
        claimLimitsAssignedAt: new Date(),
      },
    });

    // Activate subscription if not active
    if (payment.member.subscription && !payment.member.subscription.isActive) {
      await this.prisma.subscription.update({
        where: { id: payment.member.subscription.id },
        data: { isActive: true },
      });
    }

    // Log action
    await this.logAdminAction({
      adminId,
      action: 'VERIFY_PAYMENT',
      targetType: 'PAYMENT',
      targetId: payment.id,
      reason,
      metadata: { previousStatus: payment.status },
      ipAddress: '0.0.0.0',
    });

    return {
      success: true,
      message: 'Payment verified and subscription activated',
      updatedRecord: payment,
    };
  }

  /**
   * Log admin action
   * Requirements: 3.8
   */
  private async logAdminAction(data: {
    adminId: string;
    action: string;
    targetType: string;
    targetId: string;
    reason: string;
    metadata?: any;
    ipAddress: string;
  }) {
    await this.prisma.auditLog.create({
      data,
    });

    this.logger.log(
      `Admin action logged: ${data.action} on ${data.targetType} ${data.targetId} by ${data.adminId}`,
    );
  }

  /**
   * Reconcile payments with SasaPay
   * Requirements: 24.1, 24.2, 24.3, 24.4, 24.5, 24.6, 24.7
   */
  async reconcilePayments(dateRange: { from: Date; to: Date }) {
    this.logger.log(
      `Reconciling payments from ${dateRange.from} to ${dateRange.to}`,
    );

    // Get all payments in date range
    const payments = await this.prisma.contribution.findMany({
      where: {
        createdAt: {
          gte: dateRange.from,
          lte: dateRange.to,
        },
      },
      include: {
        member: {
          select: {
            phoneNumber: true,
            fullName: true,
          },
        },
      },
    });

    const results = {
      totalPayments: payments.length,
      matched: 0,
      mismatched: 0,
      corrected: 0,
      discrepancies: [] as any[],
    };

    for (const payment of payments) {
      // TODO: Query SasaPay transaction status API
      // For now, we'll just check if the payment has SasaPay data
      const metadata = (payment.metadata as any) || {};
      const hasSasaPayData =
        metadata.checkoutRequestId || metadata.merchantRequestId;

      if (hasSasaPayData) {
        results.matched++;
      } else {
        results.mismatched++;
        results.discrepancies.push({
          paymentId: payment.id,
          transactionRef: payment.paymentRef,
          amount: payment.amount,
          status: payment.status,
          member: payment.member?.fullName || payment.member?.phoneNumber,
          issue: 'Missing SasaPay data',
        });
      }
    }

    this.logger.log(
      `Reconciliation complete: ${results.matched} matched, ${results.mismatched} mismatched`,
    );

    return results;
  }

  /**
   * Sync payment status with SasaPay
   */
  async syncPaymentStatus(paymentId: string, adminId: string) {
    // TODO: Implement SasaPay transaction status query
    // https://developer.sasapay.app/docs/apis/transaction-status

    const payment = await this.prisma.contribution.findUnique({
      where: { id: paymentId },
    });

    if (!payment) {
      throw new UnauthorizedException('Payment not found');
    }

    // Log action
    await this.logAdminAction({
      adminId,
      action: 'SYNC_PAYMENT_STATUS',
      targetType: 'PAYMENT',
      targetId: paymentId,
      reason: 'Manual sync with SasaPay',
      metadata: { previousStatus: payment.status },
      ipAddress: '0.0.0.0',
    });

    return {
      success: true,
      message: 'Payment status synced (placeholder)',
      payment,
    };
  }
}
