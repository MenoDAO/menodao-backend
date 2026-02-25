import {
  Injectable,
  UnauthorizedException,
  OnModuleInit,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { StaffRole } from '@prisma/client';
import { SmsService } from '../sms/sms.service';
import * as bcrypt from 'bcrypt';

@Injectable()
export class StaffService implements OnModuleInit {
  private readonly logger = new Logger(StaffService.name);

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private smsService: SmsService,
  ) {}

  async sendBulkSms(phoneNumbers: string[], message: string) {
    return this.smsService.sendBulkSms(phoneNumbers, message);
  }

  /**
   * Initialize default staff user if none exists
   */
  async onModuleInit() {
    // Add a delay to ensure Prisma schema is pushed first
    await new Promise((resolve) => setTimeout(resolve, 5000));

    try {
      // Check if the table exists by attempting a simple query
      const staffCount = await this.prisma.staffUser.count().catch(() => {
        this.logger.warn(
          'StaffUser table does not exist yet, skipping initialization',
        );
        return 0;
      });

      if (staffCount === 0) {
        const defaultUsername =
          this.configService.get<string>('STAFF_DEFAULT_USERNAME') ||
          'staff001';
        const defaultPassword =
          this.configService.get<string>('STAFF_DEFAULT_PASSWORD') ||
          'staff2026!';
        const defaultName =
          this.configService.get<string>('STAFF_DEFAULT_NAME') ||
          'Clinic Staff';

        const passwordHash = await bcrypt.hash(defaultPassword, 10);

        await this.prisma.staffUser.create({
          data: {
            username: defaultUsername,
            passwordHash,
            fullName: defaultName,
            role: 'STAFF',
            isActive: true,
          },
        });

        this.logger.log(`Default staff user created: ${defaultUsername}`);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to initialize default staff user: ${message}`);
      // Don't throw - allow module to load even if initialization fails
      // Staff user can be created manually or on next restart
    }
  }

  /**
   * Validate staff credentials and return JWT token
   */
  async login(
    username: string,
    password: string,
  ): Promise<{
    accessToken: string;
    staff: {
      id: string;
      username: string;
      fullName: string;
      role: string;
      clinicId?: string;
    };
  }> {
    const staff = await this.prisma.staffUser.findUnique({
      where: { username },
      include: {
        clinic: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    if (!staff || !staff.isActive) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(password, staff.passwordHash);

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Update last login
    await this.prisma.staffUser.update({
      where: { id: staff.id },
      data: { lastLogin: new Date() },
    });

    const payload = {
      sub: staff.id,
      username: staff.username,
      role: staff.role,
      clinicId: staff.clinicId,
      type: 'staff',
    };

    const accessToken = this.jwtService.sign(payload, {
      expiresIn: '8h', // 8 hour expiry for staff sessions
    });

    return {
      accessToken,
      staff: {
        id: staff.id,
        username: staff.username,
        fullName: staff.fullName,
        role: staff.role,
        clinicId: staff.clinicId || undefined,
      },
    };
  }

  /**
   * Change staff password
   */
  async changePassword(
    staffId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<{ message: string }> {
    const staff = await this.prisma.staffUser.findUnique({
      where: { id: staffId },
    });

    if (!staff) {
      throw new UnauthorizedException('Staff not found');
    }

    const isPasswordValid = await bcrypt.compare(
      currentPassword,
      staff.passwordHash,
    );

    if (!isPasswordValid) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    const newPasswordHash = await bcrypt.hash(newPassword, 10);

    await this.prisma.staffUser.update({
      where: { id: staffId },
      data: { passwordHash: newPasswordHash },
    });

    return { message: 'Password changed successfully' };
  }

  /**
   * Verify staff JWT token
   */
  async validateStaffToken(payload: {
    sub: string;
    type: string;
    clinicId?: string;
  }): Promise<{
    id: string;
    username: string;
    fullName: string;
    role: string;
    clinicId?: string;
  } | null> {
    if (payload.type !== 'staff') {
      return null;
    }

    const staff = await this.prisma.staffUser.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        username: true,
        fullName: true,
        role: true,
        clinicId: true,
        isActive: true,
      },
    });

    if (!staff || !staff.isActive) {
      return null;
    }

    return {
      id: staff.id,
      username: staff.username,
      fullName: staff.fullName,
      role: staff.role,
      clinicId: staff.clinicId || undefined,
    };
  }

  /**
   * Get staff profile
   */
  async getProfile(staffId: string) {
    const staff = await this.prisma.staffUser.findUnique({
      where: { id: staffId },
      select: {
        id: true,
        username: true,
        fullName: true,
        role: true,
        branch: true,
        clinicId: true,
        lastLogin: true,
        createdAt: true,
        clinic: {
          select: {
            id: true,
            name: true,
            subCounty: true,
          },
        },
      },
    });

    return staff;
  }

  /**
   * Enroll a new staff member
   */
  async enrollStaff(data: {
    username: string;
    passwordHash: string;
    fullName: string;
    role: StaffRole;
    branch?: string;
  }) {
    return this.prisma.staffUser.create({
      data: {
        username: data.username,
        passwordHash: data.passwordHash,
        fullName: data.fullName,
        role: data.role,
        branch: data.branch,
        isActive: true,
      },
    });
  }

  /**
   * Get metrics for the staff dashboard
   */
  async getStaffStats(staffId: string) {
    const staff = await this.prisma.staffUser.findUnique({
      where: { id: staffId },
      select: { branch: true },
    });

    const branch = staff?.branch;

    // Count members in the same branch
    const branchMemberCount = branch
      ? await this.prisma.member.count({ where: { branch } })
      : await this.prisma.member.count();

    // Upcoming camps and their registration counts
    const upcomingCamps = await this.prisma.camp.findMany({
      where: {
        isActive: true,
        startDate: { gte: new Date() },
      },
      include: {
        _count: {
          select: { registrations: true },
        },
      },
      take: 5,
      orderBy: { startDate: 'asc' },
    });

    return {
      branchMemberCount,
      upcomingCamps: upcomingCamps.map((c) => ({
        id: c.id,
        name: c.name,
        expectedMembers: c._count.registrations,
        startDate: c.startDate,
        venue: c.venue,
      })),
      totalClaimsPending: await this.prisma.claim.count({
        where: { status: 'PENDING' },
      }),
    };
  }

  async getMembers(filters: { branch?: string; clinicId?: string }) {
    try {
      const where: any = {};

      // If clinicId is provided, only show members who have visited this clinic
      if (filters.clinicId) {
        where.visits = {
          some: {
            staff: {
              clinicId: filters.clinicId,
            },
          },
        };
      } else if (filters.branch) {
        where.branch = filters.branch;
      }

      const members = await this.prisma.member.findMany({
        where,
        select: {
          id: true,
          fullName: true,
          phoneNumber: true,
          branch: true,
          subscription: {
            select: {
              tier: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      return members.map((m) => ({
        id: m.id,
        fullName: m.fullName,
        phoneNumber: m.phoneNumber,
        branch: m.branch,
        tier: m.subscription?.tier || 'BRONZE',
      }));
    } catch (error) {
      this.logger.error('Error fetching members:', error);
      // Return empty array instead of throwing to prevent breaking the UI
      return [];
    }
  }

  async getStaffUsers(filters: { branch?: string; role?: StaffRole }) {
    return this.prisma.staffUser.findMany({
      where: {
        branch: filters.branch,
        role: filters.role,
      },
      select: {
        id: true,
        username: true,
        fullName: true,
        role: true,
        branch: true,
        isActive: true,
        lastLogin: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getClinics() {
    // Return only approved clinics for staff view
    return this.prisma.clinic.findMany({
      where: {
        status: 'APPROVED',
      },
      select: {
        id: true,
        name: true,
        subCounty: true,
        ward: true,
        contactPerson: true,
        contactPhone: true,
        contactEmail: true,
        status: true,
        createdAt: true,
        approvedAt: true,
      },
      orderBy: { name: 'asc' },
    });
  }
}
