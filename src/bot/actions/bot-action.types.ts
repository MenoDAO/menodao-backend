import type { AdminRole } from '@prisma/client';
import type { BotActionName, IntentDataScope } from '../intents/intent.types';

/**
 * Capabilities are the only thing permission checks read. An intent or an LLM
 * plan can *ask* for an action, but it can never grant itself a capability.
 */
export type BotCapability =
  | 'public.info.read'
  | 'education.read'
  | 'booking.read'
  | 'booking.write'
  | 'own.records.read'
  | 'member.records.read'
  | 'clinic.schedule.read'
  | 'clinic.schedule.write'
  | 'audit.read'
  | 'human.handoff'
  | 'feedback.write';

export type BotActorKind = 'MEMBER' | 'ADMIN' | 'STAFF' | 'UNKNOWN';

export interface BotActor {
  kind: BotActorKind;
  /** Present for every resolved member (admins are also members of the chat). */
  memberId?: string;
  adminId?: string;
  adminUsername?: string;
  adminRole?: AdminRole;
  /** True only after an explicit ADMIN session + SMS OTP verification. */
  adminSessionVerified?: boolean;
  displayName?: string;
}

export interface BotActionContext {
  actor: BotActor;
  memberId: string;
  memberPhone: string;
  /** WhatsApp identity used to match an admin phone (may be an @lid). */
  senderId: string;
  language: 'en' | 'sw';
  message: string;
  sessionId: string;
  entities?: {
    clinic?: string;
    doctor?: string;
    date?: string;
    time?: string;
    service?: string;
    memberPhone?: string;
    scope?: IntentDataScope;
  };
}

export interface BotActionResult {
  ok: boolean;
  action: BotActionName;
  reply: string;
  /** The actor lacks the capability for this action. */
  denied?: boolean;
  /** The actor has the capability but needs a fresh verification step. */
  requiresVerification?: boolean;
  /** Set when the caller should hand off to another pipeline (e.g. booking). */
  route?: 'BOOKING';
  metadata?: Record<string, unknown>;
}

export interface BotActionDefinition {
  name: BotActionName;
  description: string;
  capability: BotCapability;
  /** Privileged actions must never be answered from an unverified session. */
  requiresVerifiedAdmin?: boolean;
  /** True when the action can be requested by a member for their own data. */
  memberSelfService?: boolean;
}

export const BOT_ACTION_DEFINITIONS: Record<
  BotActionName,
  BotActionDefinition
> = {
  GET_AVAILABILITY: {
    name: 'GET_AVAILABILITY',
    description: 'Return real free appointment slots for a clinic/date range.',
    capability: 'booking.read',
  },
  START_BOOKING: {
    name: 'START_BOOKING',
    description: 'Enter the booking draft state machine.',
    capability: 'booking.write',
  },
  GET_MY_RECORDS: {
    name: 'GET_MY_RECORDS',
    description: 'Read the sender’s own scoped records after OTP verification.',
    capability: 'own.records.read',
    memberSelfService: true,
  },
  GET_MEMBER_RECORDS: {
    name: 'GET_MEMBER_RECORDS',
    description:
      'Read another member’s scoped records. Admin-only, verified session only.',
    capability: 'member.records.read',
    requiresVerifiedAdmin: true,
  },
  ESCALATE_TO_HUMAN: {
    name: 'ESCALATE_TO_HUMAN',
    description: 'Create a human follow-up lead for the member.',
    capability: 'human.handoff',
  },
  LOG_FEEDBACK: {
    name: 'LOG_FEEDBACK',
    description: 'Record a complaint or compliment for the service team.',
    capability: 'feedback.write',
  },
};
