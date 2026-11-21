import {
  Injectable,
  Optional,
  UnauthorizedException,
  BadRequestException,
  ServiceUnavailableException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { randomInt } from 'crypto';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { SmsService } from '../sms/sms.service';
import { ReferralService } from '../referrals/referral.service';
import { CareEventsService } from '../care-intelligence/care-events.service';
import { CareEventType } from '@prisma/client';
import { hashOtpCode, verifyOtpCode } from './otp-hash.util';

const OTP_TTL_MS = 10 * 60 * 1000;
/** Per-phone SMS request cap. Protects against SMS-cost abuse and spam. */
const MAX_OTP_REQUESTS_PER_HOUR = 10;
/** Wrong guesses allowed before a code is burned. */
const MAX_OTP_ATTEMPTS = 5;

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private smsService: SmsService,
    private referralService: ReferralService,
    @Optional() private careEvents?: CareEventsService,
  ) {}

  /**
   * Generate a 6-digit OTP code
   */
  private generateOtp(): string {
    return randomInt(100000, 1000000).toString();
  }

  /**
   * Check if phone number exists in the system
   */
  async checkPhoneExists(
    phoneNumber: string,
  ): Promise<{ exists: boolean; phoneNumber: string }> {
    const normalizedPhone = this.normalizePhoneNumber(phoneNumber);

    const member = await this.prisma.member.findUnique({
      where: { phoneNumber: normalizedPhone },
    });

    return {
      exists: !!member,
      phoneNumber: normalizedPhone,
    };
  }

  /**
   * Request OTP - sends code to phone number
   * For signup flow, pass createIfNotExists=true
   * For login flow, pass createIfNotExists=false (default)
   */
  async requestOtp(
    phoneNumber: string,
    createIfNotExists: boolean = false,
    fullName?: string,
    location?: string,
    referredBy?: string,
  ): Promise<{ message: string }> {
    // Normalize phone number (ensure it starts with country code)
    const normalizedPhone = this.normalizePhoneNumber(phoneNumber);

    // Throttle per phone: an attacker who knows a number must not be able to
    // trigger unlimited SMS sends (cost) or farm fresh codes to guess.
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentRequests = await this.prisma.oTPCode.count({
      where: { phoneNumber: normalizedPhone, createdAt: { gte: hourAgo } },
    });
    if (recentRequests >= MAX_OTP_REQUESTS_PER_HOUR) {
      throw new HttpException(
        'Too many verification code requests. Please try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Generate OTP
    const code = this.generateOtp();
    const expiresAt = new Date(Date.now() + OTP_TTL_MS);

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
      if (createIfNotExists) {
        member = await this.prisma.member.create({
          data: {
            phoneNumber: normalizedPhone,
            ...(fullName && { fullName }),
            ...(location && { location }),
          },
        });

        // Validate and store referredBy if provided
        if (referredBy) {
          const referrer = await this.prisma.member.findUnique({
            where: { referralCode: referredBy },
            select: { id: true },
          });
          if (referrer) {
            await this.prisma.member.update({
              where: { id: member.id },
              data: { referredBy },
            });
          }
        }

        // Generate referral code (fire-and-forget)
        try {
          await this.referralService.ensureReferralCode(member.id);
        } catch (referralError) {
          console.error(
            `[AuthService] Failed to generate referral code for member ${member.id}: ${referralError?.message}`,
          );
        }

        void this.careEvents?.track({
          type: CareEventType.MEMBER_REGISTERED,
          memberId: member.id,
          source: referredBy ? 'referral' : 'direct',
          county: member.county,
          subCounty: member.subCounty,
          metadata: { referredBy: referredBy || null },
        });
      } else {
        throw new BadRequestException(
          'Phone number not found. Please sign up instead.',
        );
      }
    }

    // Create new OTP (stored as an HMAC hash, never plaintext).
    await this.prisma.oTPCode.create({
      data: {
        code: hashOtpCode(code),
        phoneNumber: normalizedPhone,
        expiresAt,
        memberId: member.id,
      },
    });

    // Send OTP via SMS — use member's preferred language
    const smsResult = await this.smsService.sendOtp(
      normalizedPhone,
      code,
      member?.preferredLanguage,
    );

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

    // Find the newest live code for this phone. Compare the submitted code
    // ourselves so a wrong guess can be counted and the code burned after
    // MAX_OTP_ATTEMPTS. Without this, the public verify endpoint would allow
    // unlimited guesses against a 6-digit code.
    const otpRecord = await this.prisma.oTPCode.findFirst({
      where: {
        phoneNumber: normalizedPhone,
        isUsed: false,
        expiresAt: {
          gt: new Date(),
        },
      },
      orderBy: { createdAt: 'desc' },
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

    if (!verifyOtpCode(code, otpRecord.code)) {
      const attempts = otpRecord.attempts + 1;
      await this.prisma.oTPCode.update({
        where: { id: otpRecord.id },
        data: {
          attempts,
          ...(attempts >= MAX_OTP_ATTEMPTS ? { isUsed: true } : {}),
        },
      });
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

    return this.issueSession(member);
  }

  async issueSessionById(memberId: string) {
    const member = await this.prisma.member.findUnique({
      where: { id: memberId },
      include: { subscription: true },
    });
    if (!member) {
      throw new UnauthorizedException('Member not found');
    }
    return this.issueSession(member);
  }

  private issueSession(member: {
    id: string;
    phoneNumber: string;
    fullName: string | null;
    location: string | null;
    walletAddress: string | null;
    isVerified: boolean;
    subscription?: unknown;
  }) {
    const payload = {
      sub: member.id,
      phone: member.phoneNumber,
      captchaVerified: true,
    };
    return {
      accessToken: this.jwtService.sign(payload),
      member: {
        id: member.id,
        phoneNumber: member.phoneNumber,
        fullName: member.fullName,
        location: member.location,
        walletAddress: member.walletAddress,
        isVerified: member.isVerified,
        subscription: member.subscription,
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
   * Re-issue JWT after CAPTCHA verification (for sessions created before CAPTCHA rollout).
   */
  async refreshCaptchaSession(
    memberId: string,
  ): Promise<{ accessToken: string }> {
    const member = await this.prisma.member.findUnique({
      where: { id: memberId },
    });

    if (!member) {
      throw new UnauthorizedException('Member not found');
    }

    const payload = {
      sub: member.id,
      phone: member.phoneNumber,
      captchaVerified: true,
    };

    return { accessToken: this.jwtService.sign(payload) };
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
