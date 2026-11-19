/* eslint-disable @typescript-eslint/no-unsafe-assignment -- jest matchers return any */
import type { ConfigService } from '@nestjs/config';
import { AdminRole } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SmsService } from '../../sms/sms.service';
import type { BotIdentityService } from '../identity/bot-identity.service';
import type { BotMemberDataService } from '../account/bot-member-data.service';
import { AdminWhatsappAccessService } from './admin-whatsapp-access.service';

const normalize = (value: string): string => {
  const digits = (value || '').replace(/[^\d]/g, '');
  if (!digits) return '';
  if (digits.startsWith('0')) return '+254' + digits.slice(1);
  return '+' + digits;
};

describe('AdminWhatsappAccessService', () => {
  const prisma = {
    adminUser: { findMany: jest.fn() },
    adminWhatsappSession: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    adminOtpCode: {
      count: jest.fn(),
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    sensitiveDataAccessLog: {
      create: jest.fn(),
      count: jest.fn(),
    },
    member: { findUnique: jest.fn() },
  };

  const config = { get: jest.fn() };
  const sms = { sendOtp: jest.fn() };
  const identity = {
    isLid: jest.fn(),
    normalizeToE164: jest.fn(),
    lookupMemberByPhone: jest.fn(),
  };
  const memberData = { buildScopedReply: jest.fn() };

  const service = new AdminWhatsappAccessService(
    prisma as unknown as PrismaService,
    config as unknown as ConfigService,
    sms as unknown as SmsService,
    identity as unknown as BotIdentityService,
    memberData as unknown as BotMemberDataService,
  );

  const admin = {
    id: 'admin-1',
    username: 'admin',
    role: AdminRole.SUPER_ADMIN,
    phoneNumber: '+254713278107',
  };

  const awaitingSession = {
    id: 'session-1',
    adminId: admin.id,
    adminPhone: admin.phoneNumber,
    memberId: null,
    status: 'AWAITING_MEMBER',
    attempts: 0,
  };

  const pendingSession = {
    id: 'session-1',
    adminId: admin.id,
    adminPhone: admin.phoneNumber,
    memberId: 'member-1',
    status: 'PENDING_OTP',
    attempts: 0,
  };

  const verifiedSession = {
    id: 'session-1',
    adminId: admin.id,
    adminPhone: admin.phoneNumber,
    memberId: 'member-1',
    status: 'VERIFIED',
    attempts: 0,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.adminUser.findMany.mockResolvedValue([]);
    prisma.adminWhatsappSession.findFirst.mockResolvedValue(null);
    prisma.adminWhatsappSession.create.mockResolvedValue({ id: 'session-1' });
    prisma.adminWhatsappSession.update.mockResolvedValue({});
    prisma.adminWhatsappSession.updateMany.mockResolvedValue({ count: 0 });
    prisma.adminOtpCode.count.mockResolvedValue(0);
    prisma.adminOtpCode.create.mockResolvedValue({ id: 'otp-1' });
    prisma.adminOtpCode.findFirst.mockResolvedValue(null);
    prisma.adminOtpCode.update.mockResolvedValue({});
    prisma.adminOtpCode.updateMany.mockResolvedValue({ count: 0 });
    prisma.sensitiveDataAccessLog.create.mockResolvedValue({});
    prisma.sensitiveDataAccessLog.count.mockResolvedValue(0);
    prisma.member.findUnique.mockResolvedValue(null);
    config.get.mockReturnValue(undefined);
    sms.sendOtp.mockResolvedValue({ success: true });
    identity.isLid.mockReturnValue(false);
    identity.normalizeToE164.mockImplementation(normalize);
    identity.lookupMemberByPhone.mockResolvedValue(null);
    memberData.buildScopedReply.mockResolvedValue('record reply');
  });

  describe('identity', () => {
    it('matches an active admin by normalised phone', async () => {
      prisma.adminUser.findMany.mockResolvedValue([
        {
          id: 'admin-1',
          username: 'admin',
          role: AdminRole.SUPER_ADMIN,
          phoneNumber: '0713278107',
        },
      ]);

      const result = await service.findAdminBySender('254713278107');

      expect(result).toMatchObject({
        id: 'admin-1',
        role: AdminRole.SUPER_ADMIN,
      });
    });

    it('matches a WhatsApp JID with a device suffix', async () => {
      prisma.adminUser.findMany.mockResolvedValue([
        {
          id: 'admin-1',
          username: 'admin',
          role: AdminRole.SUPER_ADMIN,
          phoneNumber: '+254713278107',
        },
      ]);

      const result = await service.findAdminBySender(
        '254713278107:12@s.whatsapp.net',
      );

      expect(result?.id).toBe('admin-1');
    });

    it('fails closed when two admins share a normalised phone', async () => {
      prisma.adminUser.findMany.mockResolvedValue([
        {
          id: 'admin-1',
          username: 'admin',
          role: AdminRole.SUPER_ADMIN,
          phoneNumber: '0713278107',
        },
        {
          id: 'admin-2',
          username: 'staff',
          role: AdminRole.CUSTOMER_SERVICE,
          phoneNumber: '+254713278107',
        },
      ]);

      await expect(
        service.findAdminBySender('254713278107'),
      ).resolves.toBeNull();
    });

    it('ignores unknown phones and LIDs without a phone fallback', async () => {
      prisma.adminUser.findMany.mockResolvedValue([
        {
          id: 'admin-1',
          username: 'admin',
          role: AdminRole.SUPER_ADMIN,
          phoneNumber: '0713278107',
        },
      ]);
      identity.isLid.mockReturnValue(true);

      await expect(
        service.findAdminBySender('254700000000'),
      ).resolves.toBeNull();
      await expect(service.findAdminBySender('123@lid')).resolves.toBeNull();
    });

    it('only accepts the explicit ADMIN command', () => {
      expect(service.isAdminModeCommand(' ADMIN ')).toBe(true);
      expect(service.isAdminModeCommand('staff')).toBe(true);
      expect(service.isAdminModeCommand('administer')).toBe(false);
      expect(service.isAdminModeCommand('hello')).toBe(false);
    });

    it('returns the kill-switch message when disabled', async () => {
      config.get.mockReturnValue('false');

      const reply = await service.handleMessage(admin, 'ADMIN');

      expect(reply).toContain('temporarily disabled');
      expect(prisma.adminWhatsappSession.create).not.toHaveBeenCalled();
    });
  });

  describe('admin mode', () => {
    it('starts admin mode and asks for a member phone', async () => {
      const reply = await service.handleMessage(admin, 'ADMIN');

      expect(reply).toContain('MenoDAO admin access');
      expect(prisma.adminWhatsappSession.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          adminId: admin.id,
          status: 'AWAITING_MEMBER',
        }),
      });
    });

    it('sends an SMS OTP for a member phone', async () => {
      prisma.adminWhatsappSession.findFirst
        .mockResolvedValueOnce(awaitingSession)
        .mockResolvedValueOnce(null);
      identity.lookupMemberByPhone.mockResolvedValue({
        id: 'member-1',
        phoneNumber: '+254713278107',
      });

      const reply = await service.handleMessage(admin, '0713278107');

      expect(reply).toContain('sent a 6-digit code');
      expect(reply).toContain('ending 8107');
      expect(sms.sendOtp).toHaveBeenCalledWith(
        '+254713278107',
        expect.stringMatching(/^\d{6}$/),
        'en',
      );
      expect(prisma.adminWhatsappSession.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          memberId: 'member-1',
          status: 'PENDING_OTP',
        }),
      });
    });

    it('rate limits OTP requests', async () => {
      prisma.adminWhatsappSession.findFirst
        .mockResolvedValueOnce(awaitingSession)
        .mockResolvedValueOnce(null);
      prisma.adminOtpCode.count.mockResolvedValue(5);

      const reply = await service.handleMessage(admin, '0713278107');

      expect(reply).toContain('Too many verification codes');
      expect(sms.sendOtp).not.toHaveBeenCalled();
      expect(prisma.sensitiveDataAccessLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ outcome: 'RATE_LIMITED' }),
      });
    });

    it('verifies the code and shows the member menu', async () => {
      prisma.adminWhatsappSession.findFirst.mockResolvedValue(pendingSession);
      prisma.adminOtpCode.findFirst.mockResolvedValue({
        id: 'otp-1',
        code: '123456',
        attempts: 0,
      });
      prisma.member.findUnique.mockResolvedValue({
        fullName: 'Caleb Kiragu',
        phoneNumber: '+254713278107',
        subscription: null,
      });

      const reply = await service.handleMessage(admin, '123456');

      expect(reply).toContain('Member: Caleb Kiragu (…8107)');
      expect(reply).toContain('What do you need?');
      expect(prisma.adminWhatsappSession.update).toHaveBeenCalledWith({
        where: { id: 'session-1' },
        data: expect.objectContaining({ status: 'VERIFIED' }),
      });
    });

    it('locks the session after five wrong codes', async () => {
      prisma.adminWhatsappSession.findFirst.mockResolvedValue({
        ...pendingSession,
        attempts: 4,
      });
      prisma.adminOtpCode.findFirst.mockResolvedValue({
        id: 'otp-1',
        code: '123456',
        attempts: 4,
      });

      const reply = await service.handleMessage(admin, '000000');

      expect(reply).toContain('locked for one hour');
      expect(prisma.adminOtpCode.update).toHaveBeenCalledWith({
        where: { id: 'otp-1' },
        data: { attempts: 5, isUsed: true },
      });
      expect(prisma.adminWhatsappSession.update).toHaveBeenCalledWith({
        where: { id: 'session-1' },
        data: expect.objectContaining({ status: 'LOCKED' }),
      });
    });

    it('does not reveal a member when the phone was not found', async () => {
      prisma.adminWhatsappSession.findFirst.mockResolvedValue({
        ...pendingSession,
        memberId: null,
      });
      prisma.adminOtpCode.findFirst.mockResolvedValue({
        id: 'otp-1',
        code: '123456',
        attempts: 0,
      });

      const reply = await service.handleMessage(admin, '123456');

      expect(reply).toContain('No member was found');
      expect(prisma.member.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('verified access', () => {
    it('answers a permitted scope and audits it', async () => {
      prisma.adminWhatsappSession.findFirst.mockResolvedValue(verifiedSession);
      prisma.member.findUnique.mockResolvedValue({
        fullName: 'Caleb Kiragu',
        phoneNumber: '+254713278107',
        subscription: null,
      });

      const reply = await service.handleMessage(admin, '1');

      expect(memberData.buildScopedReply).toHaveBeenCalledWith(
        'member-1',
        'PAYMENTS',
      );
      expect(reply).toContain('record reply');
      expect(prisma.sensitiveDataAccessLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actorType: 'ADMIN',
          actorId: admin.id,
          memberId: 'member-1',
          scope: 'PAYMENTS',
          outcome: 'GRANTED',
        }),
      });
    });

    it('denies a scope outside the role', async () => {
      prisma.adminWhatsappSession.findFirst.mockResolvedValue(verifiedSession);

      const reply = await service.handleMessage(
        { ...admin, role: AdminRole.JUNIOR_ADMIN },
        '3',
      );

      expect(reply).toContain('cannot access visits');
      expect(memberData.buildScopedReply).not.toHaveBeenCalled();
      expect(prisma.sensitiveDataAccessLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ outcome: 'DENIED' }),
      });
    });

    it('rate limits lookups per admin', async () => {
      prisma.adminWhatsappSession.findFirst.mockResolvedValue(verifiedSession);
      prisma.sensitiveDataAccessLog.count.mockResolvedValue(20);

      const reply = await service.handleMessage(admin, '1');

      expect(reply).toContain('Hourly lookup limit');
      expect(memberData.buildScopedReply).not.toHaveBeenCalled();
    });

    it('starts a fresh OTP when switching member', async () => {
      prisma.adminWhatsappSession.findFirst
        .mockResolvedValueOnce(verifiedSession)
        .mockResolvedValueOnce(null);
      identity.lookupMemberByPhone.mockResolvedValue({
        id: 'member-2',
        phoneNumber: '+254700000000',
      });

      const reply = await service.handleMessage(admin, '0700000000');

      expect(reply).toContain('sent a 6-digit code');
      expect(sms.sendOtp).toHaveBeenCalled();
      expect(prisma.adminWhatsappSession.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          memberId: 'member-2',
          status: 'PENDING_OTP',
        }),
      });
    });

    it('ends admin mode on EXIT', async () => {
      prisma.adminWhatsappSession.findFirst.mockResolvedValue(verifiedSession);

      const reply = await service.handleMessage(admin, 'EXIT');

      expect(reply).toContain('Admin mode ended');
      expect(prisma.adminWhatsappSession.update).toHaveBeenCalledWith({
        where: { id: 'session-1' },
        data: { status: 'ENDED' },
      });
      expect(prisma.adminOtpCode.updateMany).toHaveBeenCalledWith({
        where: { adminId: admin.id, isUsed: false },
        data: { isUsed: true },
      });
    });
  });
});
