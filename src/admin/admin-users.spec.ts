import { BadRequestException } from '@nestjs/common';
import { createHash } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { AdminService } from './admin.service';

describe('Admin account management', () => {
  let service: AdminService;
  let prisma: {
    adminUser: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      update: jest.Mock;
      count: jest.Mock;
    };
  };

  const admin = (overrides: Record<string, unknown> = {}) => ({
    id: 'admin-1',
    username: 'owner',
    role: 'SUPER_ADMIN',
    phoneNumber: null,
    isActive: true,
    mustChangePassword: false,
    inviteTokenHash: null,
    inviteExpiresAt: null,
    lastLogin: null,
    createdAt: new Date('2026-01-01'),
    ...overrides,
  });

  beforeEach(async () => {
    prisma = {
      adminUser: {
        create: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(admin()),
        findFirst: jest.fn(),
        update: jest
          .fn()
          .mockImplementation(({ data }) => Promise.resolve(admin(data))),
        // Non-zero: prevents onModuleInit from seeding a default admin.
        count: jest.fn().mockResolvedValue(1),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: { sign: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn() } },
      ],
    }).compile();

    service = module.get<AdminService>(AdminService);
  });

  it('stores only a hash of the one-time invite token', async () => {
    prisma.adminUser.create.mockImplementation(({ data }) =>
      Promise.resolve(admin({ ...data, id: 'admin-2' })),
    );

    const result = await service.createAdmin({
      username: 'junior.dev',
      role: 'JUNIOR_ADMIN',
      phoneNumber: '254712345678',
    });

    expect(result.inviteToken).toHaveLength(64);
    const stored = prisma.adminUser.create.mock.calls[0][0].data;
    expect(stored.inviteTokenHash).not.toBe(result.inviteToken);
    expect(stored.inviteTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.passwordHash).not.toBe('');
    expect(stored.mustChangePassword).toBe(true);
    expect(result.admin).not.toHaveProperty('passwordHash');
    expect(result.admin).not.toHaveProperty('inviteTokenHash');
  });

  it('accepts an invite, sets the password and consumes the token', async () => {
    const token = 'a'.repeat(64);
    const hash = createHash('sha256').update(token).digest('hex');
    prisma.adminUser.findFirst.mockResolvedValue(
      admin({
        id: 'admin-2',
        inviteTokenHash: hash,
        inviteExpiresAt: new Date(Date.now() + 60_000),
      }),
    );

    const result = await service.acceptInvite(token, 'strong-password-123');

    expect(result.message).toContain('sign in');
    const update = prisma.adminUser.update.mock.calls[0][0];
    expect(update.data.inviteTokenHash).toBeNull();
    expect(update.data.inviteExpiresAt).toBeNull();
    expect(update.data.mustChangePassword).toBe(false);
    expect(update.data.passwordHash).not.toBe('strong-password-123');
  });

  it('rejects an expired invite without changing the password', async () => {
    const token = 'b'.repeat(64);
    const hash = createHash('sha256').update(token).digest('hex');
    prisma.adminUser.findFirst.mockResolvedValue(
      admin({
        inviteTokenHash: hash,
        inviteExpiresAt: new Date(Date.now() - 60_000),
      }),
    );

    await expect(
      service.acceptInvite(token, 'strong-password-123'),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.adminUser.update).not.toHaveBeenCalled();
  });

  it('protects the last active super admin from demotion and deactivation', async () => {
    prisma.adminUser.count.mockResolvedValue(1);

    await expect(
      service.updateAdmin('admin-1', { role: 'JUNIOR_ADMIN' }, 'someone-else'),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.updateAdmin('admin-1', { isActive: false }, 'someone-else'),
    ).rejects.toThrow(BadRequestException);
  });

  it('allows demoting a super admin when another active one remains', async () => {
    prisma.adminUser.count.mockResolvedValue(2);

    const result = await service.updateAdmin(
      'admin-1',
      { role: 'JUNIOR_ADMIN' },
      'someone-else',
    );

    expect(result.role).toBe('JUNIOR_ADMIN');
  });

  it('does not allow an admin to change their own role or deactivate themselves', async () => {
    await expect(
      service.updateAdmin('admin-1', { role: 'JUNIOR_ADMIN' }, 'admin-1'),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.updateAdmin('admin-1', { isActive: false }, 'admin-1'),
    ).rejects.toThrow(BadRequestException);
  });

  it('never selects credential fields when listing admins', async () => {
    await service.listAdmins();

    const select = prisma.adminUser.findMany.mock.calls[0][0].select;
    expect(select).not.toHaveProperty('passwordHash');
    expect(select).not.toHaveProperty('inviteTokenHash');
  });
});
