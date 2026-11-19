/* eslint-disable @typescript-eslint/no-unsafe-assignment -- jest matchers return any */
import type { AuthService } from '../../auth/auth.service';
import type { PrismaService } from '../../prisma/prisma.service';
import { BotMemberDataService } from './bot-member-data.service';

describe('BotMemberDataService', () => {
  let service: BotMemberDataService;
  let prisma: {
    botDataAccessSession: {
      count: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    sensitiveDataAccessLog: { create: jest.Mock };
    subscription: { findUnique: jest.Mock };
    contribution: { findMany: jest.Mock; count: jest.Mock };
    appointment: { findMany: jest.Mock; count: jest.Mock };
    visit: { findMany: jest.Mock };
    claim: { findMany: jest.Mock };
    member: { findUnique: jest.Mock };
  };
  let auth: { requestOtp: jest.Mock; verifyOtp: jest.Mock };

  const member = { id: 'member-1', phoneNumber: '254712345678' };

  beforeEach(() => {
    prisma = {
      botDataAccessSession: {
        count: jest.fn().mockResolvedValue(0),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'session-1' }),
        update: jest.fn().mockResolvedValue({}),
      },
      sensitiveDataAccessLog: { create: jest.fn().mockResolvedValue({}) },
      subscription: { findUnique: jest.fn().mockResolvedValue(null) },
      contribution: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      appointment: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      visit: { findMany: jest.fn().mockResolvedValue([]) },
      claim: { findMany: jest.fn().mockResolvedValue([]) },
      member: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    auth = {
      requestOtp: jest.fn().mockResolvedValue({ message: 'sent' }),
      verifyOtp: jest.fn().mockResolvedValue({ accessToken: 'x', member }),
    };
    service = new BotMemberDataService(
      prisma as unknown as PrismaService,
      auth as unknown as AuthService,
    );
  });

  describe('detectScope', () => {
    it('recognises the payment-history question from a member', () => {
      expect(
        service.detectScope(
          "what's my payment history? have i ever made a payment for membership and how consistent was I?",
        ),
      ).toBe('PAYMENTS');
    });

    it.each([
      ['when is my next appointment', 'APPOINTMENTS'],
      ['show me my booking history', 'APPOINTMENTS'],
      ['what treatment did i get last time', 'VISITS'],
      ['what happened to my claim', 'CLAIMS'],
      ['check my membership details', 'ACCOUNT'],
    ])('maps %s to %s', (text, scope) => {
      expect(service.detectScope(text)).toBe(scope);
    });

    it('does not treat informational payment questions as a data request', () => {
      expect(service.detectScope('how do I pay my membership?')).toBeNull();
      expect(
        service.detectScope('where can I pay my contribution?'),
      ).toBeNull();
      expect(service.detectScope('how much do I pay per month?')).toBeNull();
      expect(service.detectScope('what is MenoDAO?')).toBeNull();
    });
  });

  describe('handleRequest', () => {
    it('sends an OTP and opens a pending session', async () => {
      const reply = await service.handleRequest(member, 'PAYMENTS');

      expect(auth.requestOtp).toHaveBeenCalledWith(member.phoneNumber);
      expect(prisma.botDataAccessSession.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          memberId: member.id,
          scope: 'PAYMENTS',
          status: 'PENDING',
        }),
      });
      expect(reply).toContain('6-digit code');
      expect(prisma.sensitiveDataAccessLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ outcome: 'OTP_SENT' }),
      });
    });

    it('answers directly inside an existing verified window', async () => {
      prisma.botDataAccessSession.findFirst.mockResolvedValueOnce({
        id: 'verified-1',
        status: 'VERIFIED',
      });
      prisma.contribution.findMany.mockResolvedValue([]);

      const reply = await service.handleRequest(member, 'PAYMENTS');

      expect(auth.requestOtp).not.toHaveBeenCalled();
      expect(reply).toContain('do not see any membership payments');
    });

    it('reuses a live pending challenge instead of sending another SMS', async () => {
      prisma.botDataAccessSession.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'pending-1', scope: 'PAYMENTS' });

      const reply = await service.handleRequest(member, 'PAYMENTS');

      expect(auth.requestOtp).not.toHaveBeenCalled();
      expect(prisma.botDataAccessSession.create).not.toHaveBeenCalled();
      expect(reply).toContain('6-digit code');
    });

    it('rate limits repeated OTP requests', async () => {
      prisma.botDataAccessSession.count.mockResolvedValue(5);

      const reply = await service.handleRequest(member, 'PAYMENTS');

      expect(auth.requestOtp).not.toHaveBeenCalled();
      expect(reply).toContain('cannot send another verification code');
      expect(prisma.sensitiveDataAccessLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ outcome: 'RATE_LIMITED' }),
      });
    });
  });

  describe('verify', () => {
    const pending = {
      id: 'session-1',
      scope: 'PAYMENTS',
      attempts: 0,
      status: 'PENDING',
    };

    it('grants access and answers the original scope after a valid code', async () => {
      prisma.botDataAccessSession.findFirst.mockResolvedValue(pending);
      prisma.contribution.findMany.mockResolvedValue([
        {
          month: new Date(),
          amount: 500,
          status: 'COMPLETED',
          confirmedAt: new Date(),
        },
      ]);
      prisma.subscription.findUnique.mockResolvedValue({
        tier: 'SILVER',
        monthlyAmount: 500,
        paymentFrequency: 'MONTHLY',
        isActive: true,
        startDate: new Date(),
        subscriptionStartDate: new Date(),
      });

      const result = await service.verify(member, '123456');

      expect(result.verified).toBe(true);
      expect(result.reply).toContain('membership payment history');
      expect(result.reply).toContain('KES 500');
      expect(prisma.botDataAccessSession.update).toHaveBeenCalledWith({
        where: { id: 'session-1' },
        data: expect.objectContaining({ status: 'VERIFIED' }),
      });
    });

    it('counts a failed code and locks after the fifth attempt', async () => {
      prisma.botDataAccessSession.findFirst.mockResolvedValue({
        ...pending,
        attempts: 4,
      });
      auth.verifyOtp.mockRejectedValue(new Error('bad code'));

      const result = await service.verify(member, '000000');

      expect(result.verified).toBe(false);
      expect(prisma.botDataAccessSession.update).toHaveBeenCalledWith({
        where: { id: 'session-1' },
        data: { attempts: 5, status: 'LOCKED' },
      });
      expect(result.reply).toContain('Too many incorrect codes');
    });
  });

  describe('replies', () => {
    it('summarises consistency and never exposes identifiers', async () => {
      const now = new Date();
      const month = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
      );
      prisma.botDataAccessSession.findFirst.mockResolvedValue({
        id: 'verified-1',
        status: 'VERIFIED',
        scope: 'PAYMENTS',
      });
      prisma.contribution.findMany.mockResolvedValue([
        { month, amount: 500, status: 'COMPLETED', confirmedAt: month },
      ]);
      prisma.subscription.findUnique.mockResolvedValue({
        tier: 'SILVER',
        monthlyAmount: 500,
        paymentFrequency: 'MONTHLY',
        isActive: true,
        startDate: month,
        subscriptionStartDate: month,
      });

      const reply = await service.handleRequest(member, 'PAYMENTS');

      expect(reply).toContain('1 of 1 months paid (100%)');
      expect(reply).not.toContain(member.phoneNumber);
    });

    it('shows failed attempts even when no payment completed', async () => {
      const month = new Date(Date.UTC(2026, 1, 1));
      const failed = {
        month,
        amount: 525,
        status: 'FAILED',
        confirmedAt: null,
      };
      prisma.botDataAccessSession.findFirst.mockResolvedValue({
        id: 'verified-1',
        status: 'VERIFIED',
        scope: 'PAYMENTS',
      });
      prisma.contribution.findMany.mockImplementation(
        (args: { where?: { status?: string } }) =>
          Promise.resolve(args.where?.status === 'COMPLETED' ? [] : [failed]),
      );
      prisma.contribution.count.mockResolvedValue(2);
      prisma.subscription.findUnique.mockResolvedValue({
        tier: 'BRONZE',
        monthlyAmount: 525,
        paymentFrequency: 'MONTHLY',
        isActive: false,
        startDate: month,
        subscriptionStartDate: month,
      });

      const reply = await service.handleRequest(member, 'PAYMENTS');

      expect(reply).toContain('KES 525');
      expect(reply).toContain('Failed');
      expect(reply).toContain('any completed membership payments');
      expect(reply).toContain('Attempts not completed: 2');
    });

    it('lists appointments with clinic and status but no clinical notes', async () => {
      prisma.botDataAccessSession.findFirst.mockResolvedValue({
        id: 'verified-1',
        status: 'VERIFIED',
      });
      prisma.appointment.findMany.mockResolvedValue([
        {
          scheduledAt: new Date(Date.now() + 86_400_000),
          status: 'BOOKED',
          clinic: { name: 'Nairobi Dental Clinic' },
        },
      ]);

      const reply = await service.handleRequest(member, 'APPOINTMENTS');

      expect(reply).toContain('Nairobi Dental Clinic');
      expect(reply).toContain('Booked');
    });
  });
});
