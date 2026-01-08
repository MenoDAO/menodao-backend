import { Injectable, UnauthorizedException, OnModuleInit, Logger } from '@nestjs/common';
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
      const defaultUsername = this.configService.get<string>('ADMIN_USERNAME') || 'admin';
      const defaultPassword = this.configService.get<string>('ADMIN_DEFAULT_PASSWORD') || 'menodao2026!';
      
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
  async login(username: string, password: string): Promise<{ accessToken: string; admin: { id: string; username: string } }> {
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

    const accessToken = this.jwtService.sign(payload, {
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
  async changePassword(adminId: string, currentPassword: string, newPassword: string): Promise<{ message: string }> {
    const admin = await this.prisma.adminUser.findUnique({
      where: { id: adminId },
    });

    if (!admin) {
      throw new UnauthorizedException('Admin not found');
    }

    const isPasswordValid = await bcrypt.compare(currentPassword, admin.passwordHash);
    
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
  async validateAdminToken(payload: { sub: string; type: string }): Promise<{ id: string; username: string } | null> {
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
   * DANGER: Clear all data from the database
   * This is a one-time cleanup function - remove after use
   */
  async nukeDatabaseData(confirmationCode: string): Promise<{ message: string; deletedCounts: Record<string, number> }> {
    // Require a specific confirmation code to prevent accidental execution
    if (confirmationCode !== 'CONFIRM_NUKE_ALL_DATA_2026') {
      throw new UnauthorizedException('Invalid confirmation code');
    }

    this.logger.warn('🔥 NUKING ALL DATABASE DATA 🔥');

    const deletedCounts: Record<string, number> = {};

    // Delete in order to respect foreign key constraints
    // 1. Delete device tokens
    const deviceTokens = await this.prisma.deviceToken.deleteMany({});
    deletedCounts.deviceTokens = deviceTokens.count;

    // 2. Delete notifications
    const notifications = await this.prisma.notification.deleteMany({});
    deletedCounts.notifications = notifications.count;

    // 3. Delete SMS logs
    const smsLogs = await this.prisma.smsLog.deleteMany({});
    deletedCounts.smsLogs = smsLogs.count;

    // 4. Delete blockchain transactions
    const blockchainTx = await this.prisma.blockchainTransaction.deleteMany({});
    deletedCounts.blockchainTransactions = blockchainTx.count;

    // 5. Delete camp registrations
    const campRegs = await this.prisma.campRegistration.deleteMany({});
    deletedCounts.campRegistrations = campRegs.count;

    // 6. Delete NFTs
    const nfts = await this.prisma.nFT.deleteMany({});
    deletedCounts.nfts = nfts.count;

    // 7. Delete claims
    const claims = await this.prisma.claim.deleteMany({});
    deletedCounts.claims = claims.count;

    // 8. Delete contributions
    const contributions = await this.prisma.contribution.deleteMany({});
    deletedCounts.contributions = contributions.count;

    // 9. Delete subscriptions
    const subscriptions = await this.prisma.subscription.deleteMany({});
    deletedCounts.subscriptions = subscriptions.count;

    // 10. Delete OTP codes
    const otpCodes = await this.prisma.oTPCode.deleteMany({});
    deletedCounts.otpCodes = otpCodes.count;

    // 11. Delete camps
    const camps = await this.prisma.camp.deleteMany({});
    deletedCounts.camps = camps.count;

    // 12. Delete members
    const members = await this.prisma.member.deleteMany({});
    deletedCounts.members = members.count;

    // 13. Delete admin users (except keep one)
    // Keep the admin user so we can still log in
    const adminUsers = await this.prisma.adminUser.findMany({ take: 1 });
    if (adminUsers.length > 0) {
      await this.prisma.adminUser.deleteMany({
        where: { id: { not: adminUsers[0].id } },
      });
    }
    deletedCounts.adminUsersKept = 1;

    this.logger.warn('🔥 DATABASE NUKE COMPLETE 🔥');
    this.logger.log(`Deleted counts: ${JSON.stringify(deletedCounts)}`);

    return {
      message: 'All data has been deleted. Database is now clean.',
      deletedCounts,
    };
  }
}
