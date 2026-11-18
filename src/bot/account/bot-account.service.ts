import { Injectable, Logger } from '@nestjs/common';
import { AuthService } from '../../auth/auth.service';
import { PrismaService } from '../../prisma/prisma.service';

export interface BotAccountSummary {
  phoneNumber: string;
  fullName: string | null;
  preferredLanguage: string | null;
  createdAt: Date;
  subscription: {
    tier: string | null;
    isActive: boolean | null;
    endDate: Date | null;
  } | null;
}

/**
 * BotAccountService — secure, OTP-gated member account info from WhatsApp.
 *
 * The bot is the closest and most consistent touchpoint between the member and
 * the foundation, so it should be able to serve basic personal info without the
 * member bouncing through the website. Security model:
 *
 *  1. Member asks for account info in chat.
 *  2. Bot issues a 6-digit OTP via the existing SMS auth flow (AuthService) and
 *     asks the member to reply with it.
 *  3. Bot verifies the OTP (AuthService.verifyOtp) — failed attempts are not
 *     surfaced with internal detail, just a re-prompt.
 *  4. On success, the bot returns a masked account summary (no clinical,
 *     payment or other sensitive detail).
 */
@Injectable()
export class BotAccountService {
  private readonly logger = new Logger(BotAccountService.name);

  constructor(
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
  ) {}

  /** Step 1: send OTP and ask the member to reply with it. */
  async requestAccountOtp(memberPhone: string): Promise<string> {
    const normalized = (memberPhone || '').replace(/[^\d]/g, '');
    try {
      await this.auth.requestOtp(normalized);
      return 'Please reply with the 6-digit code we just sent to your phone to securely view your account info.';
    } catch (error) {
      this.logger.warn(
        `Bot account info OTP request failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return 'I could not send your verification code right now. Please try again shortly.';
    }
  }

  /** Step 2: verify the member's OTP reply and return the account summary. */
  async respondWithAccountInfo(
    memberPhone: string,
    code: string,
  ): Promise<{ reply: string; verified: boolean }> {
    const normalized = (memberPhone || '').replace(/[^\d]/g, '');
    try {
      const otpResult = await this.auth.verifyOtp(normalized, code);
      const memberId = (otpResult as { member?: { id?: string } })?.member?.id;
      const member = memberId
        ? await this.prisma.member.findUnique({
            where: { id: memberId },
            select: {
              phoneNumber: true,
              fullName: true,
              preferredLanguage: true,
              createdAt: true,
              subscription: {
                select: {
                  tier: true,
                  isActive: true,
                  endDate: true,
                },
              },
            },
          })
        : null;
      const reply = this.buildAccountSummaryReply(member);
      return { reply, verified: true };
    } catch (error) {
      this.logger.warn(
        `Bot account info OTP verification failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return {
        reply:
          'That code did not match or has expired. Please reply with the 6-digit code we sent to your phone to continue.',
        verified: false,
      };
    }
  }

  private buildAccountSummaryReply(
    member: {
      phoneNumber: string;
      fullName: string | null;
      preferredLanguage: string | null;
      createdAt: Date;
      subscription: {
        tier: string | null;
        isActive: boolean | null;
        endDate: Date | null;
      } | null;
    } | null,
  ): string {
    if (!member) {
      return 'I could not read your account details right now. Please try again.';
    }
    const tier = member.subscription?.tier
      ? member.subscription.tier.charAt(0).toUpperCase() +
        member.subscription.tier.slice(1).toLowerCase()
      : 'No active membership';
    const status = member.subscription?.isActive ? 'Active' : 'Not active';
    const since = member.createdAt
      ? new Date(member.createdAt).toISOString().slice(0, 10)
      : 'unknown';
    const maskedPhone = member.phoneNumber
      ? `...${member.phoneNumber.slice(-4)}`
      : '';
    return (
      `Here is your MenoDAO account summary:\n` +
      `• Name: ${member.fullName || 'Member'}\n` +
      `• Phone: ${maskedPhone || member.phoneNumber}\n` +
      `• Membership: ${tier} — ${status}\n` +
      `• Member since: ${since}\n\n` +
      `For payments, claims and full records please open the app or visit https://menodao.org/dashboard.\n`
    );
  }
}
