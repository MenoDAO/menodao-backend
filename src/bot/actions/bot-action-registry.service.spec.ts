/* eslint-disable @typescript-eslint/no-unsafe-assignment -- mocks are plain objects */
import { AdminRole } from '@prisma/client';
import { BotActionRegistryService } from './bot-action-registry.service';
import { BotPrivilegeService } from './bot-privileges.service';
import type { BotActionContext, BotActor } from './bot-action.types';

describe('BotActionRegistryService', () => {
  const prisma = {
    botLead: { create: jest.fn() },
    sensitiveDataAccessLog: { create: jest.fn(), count: jest.fn() },
  };
  const booking = { describeAvailability: jest.fn() };
  const identity = { lookupMemberByPhone: jest.fn() };
  const memberData = {
    handleRequest: jest.fn(),
    buildScopedReply: jest.fn(),
  };
  const adminAccess = { getVerifiedMemberId: jest.fn() };

  const service = new BotActionRegistryService(
    prisma as never,
    booking as never,
    identity as never,
    memberData as never,
    adminAccess as never,
    new BotPrivilegeService(),
  );

  const member: BotActor = { kind: 'MEMBER', memberId: 'member-1' };
  const verifiedSuperAdmin: BotActor = {
    kind: 'ADMIN',
    memberId: 'member-1',
    adminId: 'admin-1',
    adminRole: AdminRole.SUPER_ADMIN,
    adminSessionVerified: true,
  };

  const baseContext = (
    actor: BotActor,
    overrides: Partial<BotActionContext> = {},
  ): BotActionContext => ({
    actor,
    memberId: 'member-1',
    memberPhone: '+254712345678',
    senderId: '254712345678',
    language: 'en',
    message: 'look up member 0712 345 678',
    sessionId: 'session-1',
    entities: { scope: 'APPOINTMENTS', memberPhone: '0712345678' },
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.sensitiveDataAccessLog.create.mockResolvedValue({});
    prisma.sensitiveDataAccessLog.count.mockResolvedValue(0);
    prisma.botLead.create.mockResolvedValue({});
  });

  it('denies a member trying to read another member’s records', async () => {
    const result = await service.execute(
      'GET_MEMBER_RECORDS',
      baseContext(member),
    );

    expect(result.denied).toBe(true);
    expect(result.reply).toMatch(/permission/i);
    expect(identity.lookupMemberByPhone).not.toHaveBeenCalled();
    expect(prisma.sensitiveDataAccessLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ outcome: 'DENIED' }),
      }),
    );
  });

  it('requires verification for an admin whose session is not verified', async () => {
    const unverified: BotActor = {
      ...verifiedSuperAdmin,
      adminSessionVerified: false,
    };
    const result = await service.execute(
      'GET_MEMBER_RECORDS',
      baseContext(unverified),
    );

    expect(result.denied).toBe(true);
    expect(result.reply).toMatch(/verification/i);
    expect(identity.lookupMemberByPhone).not.toHaveBeenCalled();
  });

  it('refuses a verified session bound to a different member', async () => {
    identity.lookupMemberByPhone.mockResolvedValue({ id: 'member-2' });
    adminAccess.getVerifiedMemberId.mockResolvedValue('member-1');

    const result = await service.execute(
      'GET_MEMBER_RECORDS',
      baseContext(verifiedSuperAdmin),
    );

    expect(result.requiresVerification).toBe(true);
    expect(result.reply).toMatch(/different member/i);
    expect(memberData.buildScopedReply).not.toHaveBeenCalled();
  });

  it('reads a member record for a verified admin bound to that member', async () => {
    identity.lookupMemberByPhone.mockResolvedValue({ id: 'member-1' });
    adminAccess.getVerifiedMemberId.mockResolvedValue('member-1');
    memberData.buildScopedReply.mockResolvedValue('Appointments: none');

    const result = await service.execute(
      'GET_MEMBER_RECORDS',
      baseContext(verifiedSuperAdmin),
    );

    expect(result.ok).toBe(true);
    expect(result.reply).toContain('Appointments');
    expect(memberData.buildScopedReply).toHaveBeenCalledWith(
      'member-1',
      'APPOINTMENTS',
    );
    expect(prisma.sensitiveDataAccessLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ outcome: 'GRANTED' }),
      }),
    );
  });

  it('lets a member read their own records through OTP-gated access', async () => {
    memberData.handleRequest.mockResolvedValue('Reply with the SMS code.');

    const result = await service.execute(
      'GET_MY_RECORDS',
      baseContext(member, {
        message: 'what is my membership status?',
        entities: { scope: 'ACCOUNT' },
      }),
    );

    expect(result.ok).toBe(true);
    expect(memberData.handleRequest).toHaveBeenCalledWith(
      { id: 'member-1', phoneNumber: '+254712345678' },
      'ACCOUNT',
    );
  });

  it('creates a human handoff lead', async () => {
    const result = await service.execute(
      'ESCALATE_TO_HUMAN',
      baseContext(member, { message: 'please call me' }),
    );

    expect(result.ok).toBe(true);
    expect(prisma.botLead.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: 'HUMAN_HANDOFF' }),
      }),
    );
  });
});
