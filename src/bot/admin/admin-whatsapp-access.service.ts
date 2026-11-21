import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AdminRole, AdminWhatsappSession, Prisma } from '@prisma/client';
import { randomInt } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { SmsService } from '../../sms/sms.service';
import { BotIdentityService } from '../identity/bot-identity.service';
import { hashOtpCode, verifyOtpCode } from '../../auth/otp-hash.util';
import {
  BotMemberDataService,
  MemberDataScope,
} from '../account/bot-member-data.service';

/** The SMS copy says five minutes, so the code really expires in five. */
const OTP_CODE_TTL_MS = 5 * 60 * 1000;
const SESSION_TTL_MS = 10 * 60 * 1000;
const ACCESS_WINDOW_MS = 15 * 60 * 1000;
const LOCK_WINDOW_MS = 60 * 60 * 1000;
const MAX_OTP_REQUESTS_PER_HOUR = 5;
const MAX_VERIFY_ATTEMPTS = 5;
const MAX_LOOKUPS_PER_HOUR = 20;
const MAX_MEMBER_LOOKUPS_PER_HOUR = 10;

const ADMIN_MODE_COMMAND = /^(admin|staff|admin mode|mode admin)$/i;
const EXIT_COMMAND = /^(exit|end|cancel|stop|logout)$/i;
const MENU_COMMAND = /^(menu|help|start)$/i;

/**
 * Role → scopes an admin may read from WhatsApp. Clinical notes are never in
 * this matrix: they stay in the app behind a stronger factor.
 */
const ROLE_SCOPES: Record<AdminRole, MemberDataScope[]> = {
  SUPER_ADMIN: ['PAYMENTS', 'APPOINTMENTS', 'VISITS', 'CLAIMS', 'ACCOUNT'],
  CUSTOMER_SERVICE: ['PAYMENTS', 'APPOINTMENTS', 'CLAIMS', 'ACCOUNT'],
  JUNIOR_ADMIN: ['PAYMENTS', 'APPOINTMENTS'],
};

const SCOPE_LABELS: Record<MemberDataScope, string> = {
  PAYMENTS: 'payments',
  APPOINTMENTS: 'appointments',
  VISITS: 'visits',
  CLAIMS: 'claims',
  ACCOUNT: 'account',
};

export interface AdminWhatsappActor {
  id: string;
  username: string;
  role: AdminRole;
  phoneNumber: string;
}

/**
 * Admin record access from WhatsApp, phase 1 (SMS second factor).
 *
 * Rules:
 *  - only an ACTIVE AdminUser whose registered phone matches the sender can
 *    enter admin mode;
 *  - admin mode is explicit (`ADMIN`), so one phone can still act as a member;
 *  - a request is bound to one member at a time and always needs a fresh SMS
 *    OTP when the member changes;
 *  - the reply builders are the same member-safe ones (no clinical notes,
 *    staff names or full identifiers);
 *  - every attempt is audited in SensitiveDataAccessLog and rate limited.
 *
 * TOTP replaces the SMS factor later, before clinical records are exposed.
 */
@Injectable()
export class AdminWhatsappAccessService {
  private readonly logger = new Logger(AdminWhatsappAccessService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly sms: SmsService,
    private readonly identity: BotIdentityService,
    private readonly memberData: BotMemberDataService,
  ) {}

  /** `BOT_ADMIN_DATA_ACCESS_ENABLED=false` is an instant, redeploy-free kill switch. */
  isEnabled(): boolean {
    return this.config.get<string>('BOT_ADMIN_DATA_ACCESS_ENABLED') !== 'false';
  }

  isAdminModeCommand(text: string): boolean {
    return ADMIN_MODE_COMMAND.test((text || '').trim());
  }

  /** Resolve the sender to an active admin by registered phone. */
  async findAdminBySender(
    senderId: string,
    fallbackPhone?: string | null,
  ): Promise<AdminWhatsappActor | null> {
    const candidate = fallbackPhone || senderId;
    if (!candidate || this.identity.isLid(candidate)) return null;
    const senderE164 = this.normalizePhone(candidate);
    if (!senderE164) return null;

    const admins = await this.prisma.adminUser.findMany({
      where: { isActive: true, phoneNumber: { not: null } },
      select: {
        id: true,
        username: true,
        role: true,
        phoneNumber: true,
      },
    });
    const matches = admins.filter(
      (admin) =>
        admin.phoneNumber &&
        this.normalizePhone(admin.phoneNumber) === senderE164,
    );
    // Fail closed if two admin rows normalise to the same phone. Otherwise the
    // first match would silently borrow the other admin's role.
    const match = matches[0];
    if (matches.length !== 1 || !match?.phoneNumber) return null;
    return {
      id: match.id,
      username: match.username,
      role: match.role,
      phoneNumber: match.phoneNumber,
    };
  }

  async hasActiveSession(adminId: string): Promise<boolean> {
    return (await this.getActiveSession(adminId)) !== null;
  }

  /**
   * The member a verified admin session is bound to, or null. Privileged
   * actions must compare against this before reading another member's record;
   * a boolean "has a session" is not enough, because the session may be for a
   * different member.
   */
  async getVerifiedMemberId(adminId: string): Promise<string | null> {
    const session = await this.getActiveSession(adminId);
    if (!session || session.status !== 'VERIFIED') return null;
    if (!session.verifiedUntil || session.verifiedUntil <= new Date()) {
      return null;
    }
    return session.memberId ?? null;
  }

  async handleMessage(
    admin: AdminWhatsappActor,
    text: string,
  ): Promise<string> {
    if (!this.isEnabled()) {
      return 'Admin data access is temporarily disabled. Please contact the SUPER_ADMIN.';
    }
    const trimmed = (text || '').trim();
    const session = await this.getActiveSession(admin.id);

    if (!session) {
      const locked = await this.getLock(admin.id);
      if (locked) {
        return 'Admin data access is locked after too many incorrect codes. Try again in about an hour.';
      }
      if (this.isAdminModeCommand(trimmed)) {
        await this.prisma.adminWhatsappSession.create({
          data: {
            adminId: admin.id,
            adminPhone: admin.phoneNumber,
            status: 'AWAITING_MEMBER',
            expiresAt: new Date(Date.now() + SESSION_TTL_MS),
          },
        });
        this.logger.log(`Admin WhatsApp mode started for admin ${admin.id}`);
        return this.adminMenu(admin);
      }
      // The gateway only routes active sessions or the ADMIN command, but never
      // disclose anything if a message slips through.
      return this.adminMenu(admin);
    }

    if (EXIT_COMMAND.test(trimmed)) {
      await this.endSession(session.id);
      // Leaving admin mode must also burn any code that has not been used yet.
      await this.prisma.adminOtpCode.updateMany({
        where: { adminId: admin.id, isUsed: false },
        data: { isUsed: true },
      });
      this.logger.log(`Admin WhatsApp mode ended for admin ${admin.id}`);
      return 'Admin mode ended. You are back in the normal member chat.';
    }

    switch (session.status) {
      case 'AWAITING_MEMBER':
        return this.handleAwaitingMember(admin, trimmed);
      case 'PENDING_OTP':
        return this.handlePendingOtp(admin, session, trimmed);
      case 'VERIFIED':
        return this.handleVerified(admin, session, trimmed);
      default:
        await this.endSession(session.id);
        return this.adminMenu(admin);
    }
  }

  private async handleAwaitingMember(
    admin: AdminWhatsappActor,
    text: string,
  ): Promise<string> {
    if (MENU_COMMAND.test(text) || this.isAdminModeCommand(text)) {
      return this.adminMenu(admin);
    }
    const phone = this.extractPhone(text);
    if (!phone) {
      return "Send the member's phone number (for example 0712 345 678), or EXIT to leave admin mode.";
    }
    return this.requestMemberAccess(admin, phone);
  }

  private async handlePendingOtp(
    admin: AdminWhatsappActor,
    session: AdminWhatsappSession,
    text: string,
  ): Promise<string> {
    if (MENU_COMMAND.test(text) || this.isAdminModeCommand(text)) {
      return this.pendingOtpPrompt(admin);
    }
    if (/^\d{6}$/.test(text)) {
      return this.verifyOtp(admin, session, text);
    }
    const phone = this.extractPhone(text);
    if (phone) return this.requestMemberAccess(admin, phone);
    return this.pendingOtpPrompt(admin);
  }

  private async handleVerified(
    admin: AdminWhatsappActor,
    session: AdminWhatsappSession,
    text: string,
  ): Promise<string> {
    const memberId = session.memberId;
    if (!memberId) {
      await this.endSession(session.id);
      return this.adminMenu(admin);
    }

    if (MENU_COMMAND.test(text) || this.isAdminModeCommand(text)) {
      return `${await this.memberHeader(memberId)}\n\n${this.memberMenu()}`;
    }

    // A phone number starts a new member request, which always needs a fresh OTP.
    const phone = this.extractPhone(text);
    if (phone) return this.requestMemberAccess(admin, phone);

    const scope = this.scopeFromText(text);
    if (!scope) {
      return `I did not understand that.\n\n${this.memberMenu()}`;
    }
    if (!this.canAccess(admin.role, scope)) {
      await this.audit(admin, memberId, scope, 'DENIED', {
        reason: 'role_capability',
        role: admin.role,
        sessionId: session.id,
      });
      return `Your role (${this.roleLabel(admin.role)}) cannot access ${SCOPE_LABELS[scope]} from WhatsApp.`;
    }

    const rateLimited = await this.checkLookupRate(admin, memberId);
    if (rateLimited) return rateLimited;

    const body = await this.memberData.buildScopedReply(memberId, scope);
    const logged = await this.audit(admin, memberId, scope, 'GRANTED', {
      role: admin.role,
      sessionId: session.id,
    });
    if (!logged) {
      return 'I cannot complete this request right now. Please try again.';
    }
    return `${await this.memberHeader(memberId)}\n\n${body}`;
  }

  private async requestMemberAccess(
    admin: AdminWhatsappActor,
    memberPhone: string,
  ): Promise<string> {
    const now = new Date();
    const locked = await this.getLock(admin.id);
    if (locked) {
      return 'Admin data access is locked after too many incorrect codes. Try again in about an hour.';
    }

    const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const recentOtps = await this.prisma.adminOtpCode.count({
      where: { adminId: admin.id, createdAt: { gte: hourAgo } },
    });
    if (recentOtps >= MAX_OTP_REQUESTS_PER_HOUR) {
      await this.audit(admin, null, 'MEMBER_RECORD', 'RATE_LIMITED', {
        reason: 'otp_requests',
      });
      this.logger.warn(`Admin ${admin.id} hit the WhatsApp OTP request limit.`);
      return 'Too many verification codes requested. Please try again in an hour.';
    }

    const member = await this.identity.lookupMemberByPhone(memberPhone);

    // One live request per admin: a new member (or retry) invalidates the old
    // session and any unused code before sending a fresh SMS.
    await this.prisma.adminWhatsappSession.updateMany({
      where: {
        adminId: admin.id,
        status: { in: ['AWAITING_MEMBER', 'PENDING_OTP', 'VERIFIED'] },
      },
      data: { status: 'ENDED' },
    });
    await this.prisma.adminOtpCode.updateMany({
      where: { adminId: admin.id, isUsed: false },
      data: { isUsed: true },
    });

    const code = this.generateCode();
    const adminPhone = this.normalizePhone(admin.phoneNumber);
    const session = await this.prisma.adminWhatsappSession.create({
      data: {
        adminId: admin.id,
        adminPhone: admin.phoneNumber,
        memberId: member?.id ?? null,
        status: 'PENDING_OTP',
        expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
      },
    });
    await this.prisma.adminOtpCode.create({
      data: {
        adminId: admin.id,
        phoneNumber: adminPhone,
        code: hashOtpCode(code),
        expiresAt: new Date(now.getTime() + OTP_CODE_TTL_MS),
      },
    });

    const sms = await this.sms.sendOtp(adminPhone, code, 'en');
    if (!sms.success) {
      await this.prisma.adminOtpCode.updateMany({
        where: { adminId: admin.id, isUsed: false },
        data: { isUsed: true },
      });
      await this.endSession(session.id);
      this.logger.error(
        `Admin OTP SMS failed for admin ${admin.id}: ${sms.error ?? 'unknown error'}`,
      );
      return 'I could not send the verification SMS right now. Please try again in a few minutes.';
    }

    await this.audit(admin, member?.id ?? null, 'MEMBER_RECORD', 'OTP_SENT', {
      memberFound: Boolean(member),
      memberPhoneLast4: memberPhone.slice(-4),
      sessionId: session.id,
    });
    return (
      `I sent a 6-digit code by SMS to your registered admin phone (${this.mask(admin.phoneNumber)}).\n\n` +
      `Reply with the code to continue. The request is for the member ending ${memberPhone.slice(-4)}.`
    );
  }

  private async verifyOtp(
    admin: AdminWhatsappActor,
    session: AdminWhatsappSession,
    code: string,
  ): Promise<string> {
    const now = new Date();
    const otp = await this.prisma.adminOtpCode.findFirst({
      where: {
        adminId: admin.id,
        isUsed: false,
        expiresAt: { gt: now },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!otp) {
      await this.endSession(session.id);
      return 'That verification code has expired. Send the member phone number again to start a new request.';
    }

    if (!verifyOtpCode(code, otp.code)) {
      const otpAttempts = otp.attempts + 1;
      await this.prisma.adminOtpCode.update({
        where: { id: otp.id },
        data: {
          attempts: otpAttempts,
          ...(otpAttempts >= MAX_VERIFY_ATTEMPTS ? { isUsed: true } : {}),
        },
      });
      const sessionAttempts = session.attempts + 1;
      const lock = sessionAttempts >= MAX_VERIFY_ATTEMPTS;
      await this.prisma.adminWhatsappSession.update({
        where: { id: session.id },
        data: {
          attempts: sessionAttempts,
          ...(lock
            ? {
                status: 'LOCKED',
                expiresAt: new Date(now.getTime() + LOCK_WINDOW_MS),
              }
            : {}),
        },
      });
      await this.audit(
        admin,
        session.memberId,
        'MEMBER_RECORD',
        lock ? 'LOCKED' : 'DENIED',
        { reason: 'wrong_code', sessionId: session.id },
      );
      if (lock) {
        this.logger.error(
          `Admin ${admin.id} locked out of WhatsApp data access after repeated wrong codes.`,
        );
        return 'Too many incorrect codes. Admin data access is locked for one hour.';
      }
      return `That code did not match. ${
        MAX_VERIFY_ATTEMPTS - sessionAttempts
      } attempt(s) left.`;
    }

    await this.prisma.adminOtpCode.update({
      where: { id: otp.id },
      data: { isUsed: true },
    });

    const memberId = session.memberId;
    if (!memberId) {
      await this.endSession(session.id);
      await this.audit(admin, null, 'MEMBER_RECORD', 'DENIED', {
        reason: 'member_not_found',
        sessionId: session.id,
      });
      return 'No member was found for that phone number. Send a different number or EXIT.';
    }

    await this.prisma.adminWhatsappSession.update({
      where: { id: session.id },
      data: {
        status: 'VERIFIED',
        attempts: 0,
        verifiedUntil: new Date(now.getTime() + ACCESS_WINDOW_MS),
      },
    });
    await this.audit(admin, memberId, 'MEMBER_RECORD', 'OTP_VERIFIED', {
      sessionId: session.id,
    });
    return `${await this.memberHeader(memberId)}\n\n${this.memberMenu()}`;
  }

  private async checkLookupRate(
    admin: AdminWhatsappActor,
    memberId: string,
  ): Promise<string | null> {
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const total = await this.prisma.sensitiveDataAccessLog.count({
      where: {
        actorType: 'ADMIN',
        actorId: admin.id,
        outcome: 'GRANTED',
        createdAt: { gte: hourAgo },
      },
    });
    if (total >= MAX_LOOKUPS_PER_HOUR) {
      await this.audit(admin, memberId, 'MEMBER_RECORD', 'RATE_LIMITED', {
        reason: 'hourly_lookups',
      });
      this.logger.warn(`Admin ${admin.id} hit the hourly lookup limit.`);
      return 'Hourly lookup limit reached. Please try again later.';
    }
    const perMember = await this.prisma.sensitiveDataAccessLog.count({
      where: {
        actorType: 'ADMIN',
        actorId: admin.id,
        memberId,
        outcome: 'GRANTED',
        createdAt: { gte: hourAgo },
      },
    });
    if (perMember >= MAX_MEMBER_LOOKUPS_PER_HOUR) {
      await this.audit(admin, memberId, 'MEMBER_RECORD', 'RATE_LIMITED', {
        reason: 'member_lookups',
      });
      this.logger.warn(
        `Admin ${admin.id} hit the per-member lookup limit for ${memberId}.`,
      );
      return 'You have reached the lookup limit for this member. Please try again later.';
    }
    return null;
  }

  private async getActiveSession(
    adminId: string,
  ): Promise<AdminWhatsappSession | null> {
    const now = new Date();
    return this.prisma.adminWhatsappSession.findFirst({
      where: {
        adminId,
        OR: [
          {
            status: { in: ['AWAITING_MEMBER', 'PENDING_OTP'] },
            expiresAt: { gt: now },
          },
          { status: 'VERIFIED', verifiedUntil: { gt: now } },
        ],
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async getLock(adminId: string): Promise<AdminWhatsappSession | null> {
    return this.prisma.adminWhatsappSession.findFirst({
      where: {
        adminId,
        status: 'LOCKED',
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async endSession(id: string): Promise<void> {
    try {
      await this.prisma.adminWhatsappSession.update({
        where: { id },
        data: { status: 'ENDED' },
      });
    } catch {
      /* already gone */
    }
  }

  private async audit(
    admin: AdminWhatsappActor,
    memberId: string | null,
    scope: string,
    outcome: string,
    metadata: Record<string, unknown>,
  ): Promise<boolean> {
    try {
      await this.prisma.sensitiveDataAccessLog.create({
        data: {
          actorType: 'ADMIN',
          actorId: admin.id,
          memberId,
          scope,
          channel: 'WHATSAPP',
          outcome,
          metadata: {
            ...metadata,
            adminRole: admin.role,
            adminPhoneMasked: this.mask(admin.phoneNumber),
          } as Prisma.InputJsonValue,
        },
      });
      return true;
    } catch (error) {
      this.logger.error(
        `Failed to write admin sensitive access log: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return false;
    }
  }

  private async memberHeader(memberId: string): Promise<string> {
    const member = await this.prisma.member.findUnique({
      where: { id: memberId },
      select: {
        fullName: true,
        phoneNumber: true,
        subscription: { select: { tier: true, isActive: true } },
      },
    });
    if (!member) return 'Member record unavailable.';
    const name = member.fullName?.trim() || 'Member';
    const phone = member.phoneNumber
      ? `…${member.phoneNumber.slice(-4)}`
      : 'no phone';
    const membership = member.subscription
      ? `${this.titleCase(member.subscription.tier)}, ${
          member.subscription.isActive ? 'Active' : 'Not active'
        }`
      : 'No membership';
    return `Member: ${name} (${phone}). ${membership}.`;
  }

  private adminMenu(admin: AdminWhatsappActor): string {
    return (
      `MenoDAO admin access\n\n` +
      `Signed in as ${admin.username} (${this.roleLabel(admin.role)}).\n\n` +
      `Send the member's phone number to start a record request. A 6-digit code will be sent by SMS to ${this.mask(
        admin.phoneNumber,
      )}. Each new member requires a new code.\n\n` +
      `Send EXIT at any time to leave admin mode.`
    );
  }

  private pendingOtpPrompt(admin: AdminWhatsappActor): string {
    return `A verification code was sent by SMS to ${this.mask(
      admin.phoneNumber,
    )}.\n\nReply with the 6-digit code, send a different member phone number, or EXIT.`;
  }

  private memberMenu(): string {
    return (
      'What do you need?\n' +
      '1. Payments\n' +
      '2. Appointments\n' +
      '3. Visits\n' +
      '4. Claims\n' +
      '5. Account\n\n' +
      'Reply with a number or the word. Send another member phone number to switch member (a new code is required), or EXIT to leave admin mode.'
    );
  }

  private scopeFromText(text: string): MemberDataScope | null {
    const value = text.toLowerCase().trim();
    if (/^(1|payments?|payment history|malipo)$/.test(value)) return 'PAYMENTS';
    if (/^(2|appointments?|bookings?|miadi)$/.test(value))
      return 'APPOINTMENTS';
    if (/^(3|visits?|treatments?|matibabu)$/.test(value)) return 'VISITS';
    if (/^(4|claims?|madai)$/.test(value)) return 'CLAIMS';
    if (/^(5|account|profile|akaunti)$/.test(value)) return 'ACCOUNT';
    return null;
  }

  private canAccess(role: AdminRole, scope: MemberDataScope): boolean {
    return (ROLE_SCOPES[role] ?? []).includes(scope);
  }

  private extractPhone(text: string): string | null {
    const digits = (text || '').replace(/[^\d]/g, '');
    if (digits.length < 9 || digits.length > 15) return null;
    // A 6-digit verification code is not a phone number.
    if (digits.length === 6) return null;
    return this.normalizePhone(digits);
  }

  /**
   * Normalise Kenyan numbers typed without the leading zero (712345678) as well
   * as the usual 0712… / +254… forms.
   */
  private normalizePhone(input: string): string {
    // Strip WhatsApp JIDs (`254…@s.whatsapp.net`) and device suffixes
    // (`254…:12@s.whatsapp.net`) before normalising the digits.
    const bare = (input || '').split('@')[0].split(':')[0];
    const digits = bare.replace(/[^\d]/g, '');
    if (!digits) return '';
    if (digits.length === 9 && /^7/.test(digits)) {
      return this.identity.normalizeToE164('0' + digits);
    }
    return this.identity.normalizeToE164(digits);
  }

  private generateCode(): string {
    return randomInt(100000, 1000000).toString();
  }

  private mask(phone: string): string {
    return `…${(phone || '').slice(-4)}`;
  }

  private roleLabel(role: AdminRole): string {
    const labels: Record<AdminRole, string> = {
      SUPER_ADMIN: 'Super admin',
      CUSTOMER_SERVICE: 'Customer service',
      JUNIOR_ADMIN: 'Junior admin',
    };
    return labels[role] ?? role;
  }

  private titleCase(value: string): string {
    return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
  }
}
