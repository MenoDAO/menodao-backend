export const CALENDAR_PROVIDERS = ['GOOGLE', 'MICROSOFT'] as const;
export type CalendarProvider = (typeof CALENDAR_PROVIDERS)[number];

export const CALENDAR_OWNER_TYPES = ['DOCTOR', 'CLINIC'] as const;
export type CalendarOwnerType = (typeof CALENDAR_OWNER_TYPES)[number];

export interface CalendarConnectionRecord {
  id: string;
  ownerType: string;
  ownerId: string;
  provider: string;
  calendarId: string | null;
  accountEmail: string | null;
  accessToken: string;
  refreshToken: string | null;
  tokenExpiresAt: Date | null;
  scopes: string | null;
  connectedAt: Date;
  lastSyncedAt: Date | null;
}

export interface OAuthTokenResult {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date;
  scopes: string;
}

export interface BusyInterval {
  start: Date;
  end: Date;
}

export interface CalendarEventInput {
  ownerType: CalendarOwnerType;
  ownerId: string;
  provider: CalendarProvider;
  title: string;
  start: Date;
  end: Date;
  description?: string;
}

export interface CalendarEventResult {
  eventId: string;
}

export interface CalendarConnectOptions {
  ownerType: CalendarOwnerType;
  ownerId: string;
  provider: CalendarProvider;
}
