import { AdminRole } from '@prisma/client';
import { BotPrivilegeService } from './bot-privileges.service';
import type { BotActor } from './bot-action.types';

describe('BotPrivilegeService', () => {
  const service = new BotPrivilegeService();

  const member: BotActor = { kind: 'MEMBER', memberId: 'member-1' };

  it('gives members their own-data and booking capabilities', () => {
    expect(service.can(member, 'booking.read')).toBe(true);
    expect(service.can(member, 'booking.write')).toBe(true);
    expect(service.can(member, 'own.records.read')).toBe(true);
    expect(service.can(member, 'member.records.read')).toBe(false);
    expect(service.can(member, 'clinic.schedule.write')).toBe(false);
  });

  it('does not privilege an admin phone until the admin session is verified', () => {
    const unverified: BotActor = {
      kind: 'ADMIN',
      memberId: 'member-1',
      adminId: 'admin-1',
      adminRole: AdminRole.SUPER_ADMIN,
      adminSessionVerified: false,
    };
    expect(service.can(unverified, 'member.records.read')).toBe(false);
    expect(service.can(unverified, 'booking.write')).toBe(true);
  });

  it('grants verified admins the capability but only SUPER_ADMIN gets write/audit', () => {
    const superAdmin: BotActor = {
      kind: 'ADMIN',
      adminId: 'admin-1',
      adminRole: AdminRole.SUPER_ADMIN,
      adminSessionVerified: true,
    };
    const cs: BotActor = {
      kind: 'ADMIN',
      adminId: 'admin-2',
      adminRole: AdminRole.CUSTOMER_SERVICE,
      adminSessionVerified: true,
    };
    expect(service.can(superAdmin, 'member.records.read')).toBe(true);
    expect(service.can(superAdmin, 'clinic.schedule.write')).toBe(true);
    expect(service.can(superAdmin, 'audit.read')).toBe(true);

    expect(service.can(cs, 'member.records.read')).toBe(true);
    expect(service.can(cs, 'clinic.schedule.write')).toBe(false);
    expect(service.can(cs, 'audit.read')).toBe(false);
  });

  it('enforces the role → scope matrix for member records', () => {
    const junior: BotActor = {
      kind: 'ADMIN',
      adminId: 'admin-3',
      adminRole: AdminRole.JUNIOR_ADMIN,
      adminSessionVerified: true,
    };
    expect(service.canReadScope(junior, 'PAYMENTS')).toBe(true);
    expect(service.canReadScope(junior, 'APPOINTMENTS')).toBe(true);
    expect(service.canReadScope(junior, 'VISITS')).toBe(false);
    expect(service.canReadScope(junior, 'ACCOUNT')).toBe(false);
  });
});
