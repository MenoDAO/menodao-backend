import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { SmsService } from '../sms/sms.service';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private smsService: SmsService,
  ) {}

  /**
   * Generate a 6-digit OTP code
   */
  private generateOtp(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  /**
   * Request OTP - sends code to phone number
   */
  async requestOtp(phoneNumber: string): Promise<{ message: string }> {
    // Normalize phone number (ensure it starts with country code)
    const normalizedPhone = this.normalizePhoneNumber(phoneNumber);

    // Generate OTP
    const code = this.generateOtp();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

    // Invalidate any existing unused OTPs for this number
    await this.prisma.oTPCode.updateMany({
      where: {
        phoneNumber: normalizedPhone,
        isUsed: false,
      },
      data: {
        isUsed: true,
      },
    });

    // Find or create member
    let member = await this.prisma.member.findUnique({
      where: { phoneNumber: normalizedPhone },
    });

    if (!member) {
      member = await this.prisma.member.create({
        data: { phoneNumber: normalizedPhone },
      });
    }

    // Create new OTP
    await this.prisma.oTPCode.create({
      data: {
        code,
        phoneNumber: normalizedPhone,
        expiresAt,
        memberId: member.id,
      },
    });

    // Send OTP via SMS
    const smsResult = await this.smsService.sendOtp(normalizedPhone, code);

    if (!smsResult.success) {
      // Log the error but don't expose internal details
      console.error(
        `[AuthService] Failed to send OTP to ${normalizedPhone}: ${smsResult.error}`,
      );

      // Throw appropriate error based on the failure type
      throw new ServiceUnavailableException(
        smsResult.error ||
          'Failed to send verification code. Please try again later.',
      );
    }

    return { message: 'OTP sent successfully' };
  }

  /**
   * Verify OTP and return JWT token
   */
  async verifyOtp(
    phoneNumber: string,
    code: string,
  ): Promise<{ accessToken: string; member: any }> {
    const normalizedPhone = this.normalizePhoneNumber(phoneNumber);

    // Find valid OTP
    const otpRecord = await this.prisma.oTPCode.findFirst({
      where: {
        phoneNumber: normalizedPhone,
        code,
        isUsed: false,
        expiresAt: {
          gt: new Date(),
        },
      },
      include: {
        member: {
          include: {
            subscription: true,
          },
        },
      },
    });

    if (!otpRecord || !otpRecord.memberId) {
      throw new UnauthorizedException('Invalid or expired OTP');
    }

    // Mark OTP as used
    await this.prisma.oTPCode.update({
      where: { id: otpRecord.id },
      data: { isUsed: true },
    });

    // Update member as verified
    const member = await this.prisma.member.update({
      where: { id: otpRecord.memberId },
      data: { isVerified: true },
      include: {
        subscription: true,
      },
    });

    // Generate JWT
    const payload = {
      sub: member.id,
      phone: member.phoneNumber,
    };
    const accessToken = this.jwtService.sign(payload);

    return {
      accessToken,
      member: {
        id: member.id,
        phoneNumber: member.phoneNumber,
        fullName: member.fullName,
        location: member.location,
        walletAddress: member.walletAddress,
        isVerified: member.isVerified,
        subscription: (member as any).subscription,
      },
    };
  }

  /**
   * Normalize phone number to include country code
   */
  private normalizePhoneNumber(phone: string): string {
    // Remove spaces and special characters
    let cleaned = phone.replace(/[\s\-\(\)]/g, '');

    // Handle Kenyan numbers
    if (cleaned.startsWith('0')) {
      cleaned = '+254' + cleaned.substring(1);
    } else if (cleaned.startsWith('254')) {
      cleaned = '+' + cleaned;
    } else if (!cleaned.startsWith('+')) {
      cleaned = '+' + cleaned;
    }

    return cleaned;
  }

  /**
   * Validate JWT token and return member
   */
  async validateToken(memberId: string) {
    const member = await this.prisma.member.findUnique({
      where: { id: memberId },
      include: {
        subscription: true,
      },
    });

    if (!member) {
      throw new UnauthorizedException('Member not found');
    }

    return member;
  }
}
