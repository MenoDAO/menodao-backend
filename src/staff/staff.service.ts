import { Injectable, UnauthorizedException, OnModuleInit, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';

@Injectable()
export class StaffService implements OnModuleInit {
  private readonly logger = new Logger(StaffService.name);

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  /**
   * Initialize default staff user if none exists
   */
  async onModuleInit() {
    const staffCount = await this.prisma.staffUser.count();
    
    if (staffCount === 0) {
      const defaultUsername = this.configService.get<string>('STAFF_DEFAULT_USERNAME') || 'staff001';
      const defaultPassword = this.configService.get<string>('STAFF_DEFAULT_PASSWORD') || 'staff2026!';
      const defaultName = this.configService.get<string>('STAFF_DEFAULT_NAME') || 'Clinic Staff';
      
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
  }

  /**
   * Validate staff credentials and return JWT token
   */
  async login(username: string, password: string): Promise<{ accessToken: string; staff: { id: string; username: string; fullName: string; role: string } }> {
    const staff = await this.prisma.staffUser.findUnique({
      where: { username },
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
      },
    };
  }

  /**
   * Change staff password
   */
  async changePassword(staffId: string, currentPassword: string, newPassword: string): Promise<{ message: string }> {
    const staff = await this.prisma.staffUser.findUnique({
      where: { id: staffId },
    });

    if (!staff) {
      throw new UnauthorizedException('Staff not found');
    }

    const isPasswordValid = await bcrypt.compare(currentPassword, staff.passwordHash);
    
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
  async validateStaffToken(payload: { sub: string; type: string }): Promise<{ id: string; username: string; fullName: string; role: string } | null> {
    if (payload.type !== 'staff') {
      return null;
    }

    const staff = await this.prisma.staffUser.findUnique({
      where: { id: payload.sub },
      select: { id: true, username: true, fullName: true, role: true, isActive: true },
    });

    if (!staff || !staff.isActive) {
      return null;
    }

    return {
      id: staff.id,
      username: staff.username,
      fullName: staff.fullName,
      role: staff.role,
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
        lastLogin: true,
        createdAt: true,
      },
    });

    return staff;
  }
}
