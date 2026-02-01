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
}
