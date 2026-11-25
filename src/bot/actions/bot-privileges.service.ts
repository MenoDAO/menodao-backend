import { Injectable } from '@nestjs/common';
import type { AdminRole } from '@prisma/client';
import type { BotActor, BotCapability } from './bot-action.types';
import type { IntentDataScope } from '../intents/intent.types';

/**
 * Role → data scopes for member records. This mirrors the matrix used by the
 * existing WhatsApp admin flow, so a privilege cannot be wider in the AI path
 * than it is in the deterministic path.
 */
export const ADMIN_ROLE_SCOPES: Record<AdminRole, IntentDataScope[]> = {
  SUPER_ADMIN: ['PAYMENTS', 'APPOINTMENTS', 'VISITS', 'CLAIMS', 'ACCOUNT'],
  CUSTOMER_SERVICE: ['PAYMENTS', 'APPOINTMENTS', 'CLAIMS', 'ACCOUNT'],
  JUNIOR_ADMIN: ['PAYMENTS', 'APPOINTMENTS'],
};

const MEMBER_CAPABILITIES: BotCapability[] = [
  'public.info.read',
  'education.read',
  'booking.read',
  'booking.write',
  'own.records.read',
  'human.handoff',
  'feedback.write',
];

const ADMIN_CAPABILITIES: BotCapability[] = [
  'member.records.read',
  'clinic.schedule.read',
];

const SUPER_ADMIN_CAPABILITIES: BotCapability[] = [
  'clinic.schedule.write',
  'audit.read',
];

@Injectable()
export class BotPrivilegeService {
  capabilitiesFor(actor: BotActor): Set<BotCapability> {
    const capabilities = new Set<BotCapability>(MEMBER_CAPABILITIES);
    if (
      actor.kind === 'ADMIN' &&
      actor.adminRole &&
      actor.adminSessionVerified
    ) {
      for (const capability of ADMIN_CAPABILITIES) capabilities.add(capability);
      if (actor.adminRole === 'SUPER_ADMIN') {
        for (const capability of SUPER_ADMIN_CAPABILITIES)
          capabilities.add(capability);
      }
    }
    return capabilities;
  }

  can(actor: BotActor, capability: BotCapability): boolean {
    return this.capabilitiesFor(actor).has(capability);
  }

  canReadScope(
    actor: BotActor,
    scope: IntentDataScope | null | undefined,
  ): boolean {
    if (!scope) return false;
    if (
      actor.kind === 'ADMIN' &&
      actor.adminRole &&
      actor.adminSessionVerified
    ) {
      return (ADMIN_ROLE_SCOPES[actor.adminRole] ?? []).includes(scope);
    }
    // A member can always read their own scoped data; the member-data service
    // still enforces OTP and binds the request to the sender.
    return actor.memberId != null;
  }

  /**
   * Short, member-safe description of what the sender may do. Used in denial
   * copy so the bot never leaks the existence of another member's record.
   */
  describeActor(actor: BotActor): string {
    if (actor.kind === 'ADMIN' && actor.adminRole) {
      if (!actor.adminSessionVerified) {
        return 'admin (not verified)';
      }
      return `admin (${actor.adminRole.toLowerCase().replace(/_/g, ' ')})`;
    }
    return 'member';
  }
}
