import { SetMetadata } from '@nestjs/common';

/**
 * Fine-grained permissions for mixed admin controllers. Roles are the coarse
 * gate (`@Roles`); capabilities are the per-action gate. They live in code so
 * they are reviewable and cannot drift in a database.
 */
export type Capability =
  | 'admins.manage'
  | 'members.read'
  | 'members.write'
  | 'subscriptions.grant'
  | 'subscriptions.revoke'
  | 'alerts.send'
  | 'payments.read'
  | 'payments.verify'
  | 'withdrawals.read'
  | 'withdrawals.approve'
  | 'clinics.read'
  | 'clinics.write'
  | 'brand_context.read'
  | 'brand_context.write'
  | 'whatsapp.manage'
  | 'conversations.read'
  | 'conversations.erase'
  | 'audit.read'
  | 'staff.manage';

export const ALL_CAPABILITIES: Capability[] = [
  'admins.manage',
  'members.read',
  'members.write',
  'subscriptions.grant',
  'subscriptions.revoke',
  'alerts.send',
  'payments.read',
  'payments.verify',
  'withdrawals.read',
  'withdrawals.approve',
  'clinics.read',
  'clinics.write',
  'brand_context.read',
  'brand_context.write',
  'whatsapp.manage',
  'conversations.read',
  'conversations.erase',
  'audit.read',
  'staff.manage',
];

const SUPPORT_CAPABILITIES: Capability[] = [
  'members.read',
  'subscriptions.grant',
  'subscriptions.revoke',
  'alerts.send',
  'payments.read',
  'withdrawals.read',
  'clinics.read',
  'brand_context.read',
  'conversations.read',
];

/** Read-mostly plus the small chores the junior dev/ops hire needs. */
const JUNIOR_CAPABILITIES: Capability[] = [
  'members.read',
  'subscriptions.grant',
  'subscriptions.revoke',
  'alerts.send',
  'payments.read',
  'withdrawals.read',
  'clinics.read',
  'brand_context.read',
  'conversations.read',
];

export const ROLE_CAPABILITIES: Record<string, Capability[]> = {
  SUPER_ADMIN: ALL_CAPABILITIES,
  JUNIOR_ADMIN: JUNIOR_CAPABILITIES,
  CUSTOMER_SERVICE: SUPPORT_CAPABILITIES,
};

export const CAPABILITIES_KEY = 'capabilities';

/** Requires every listed capability on top of any `@Roles` gate. */
export const Capability = (...capabilities: Capability[]) =>
  SetMetadata(CAPABILITIES_KEY, capabilities);
