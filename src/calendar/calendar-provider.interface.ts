import {
  BusyInterval,
  CalendarConnectionRecord,
  CalendarEventInput,
  CalendarEventResult,
  CalendarOwnerType,
  CalendarProvider,
  OAuthTokenResult,
} from './calendar.types';

export interface ICalendarProvider {
  readonly provider: CalendarProvider;
  /** true when client id/secret are configured for this provider. */
  readonly configured: boolean;

  buildAuthorizationUrl(options: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    scopes: string[];
    state: string;
  }): string;

  exchangeCode(options: {
    code: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    scopes: string[];
  }): Promise<OAuthTokenResult>;

  refreshAccessToken(options: {
    refreshToken: string;
    clientId: string;
    clientSecret: string;
    scopes?: string;
  }): Promise<OAuthTokenResult>;

  getUserEmail(accessToken: string): Promise<string | null>;

  getBusyIntervals(options: {
    accessToken: string;
    refreshToken: string | null;
    expiresAt: Date | null;
    calendarId: string | null;
    from: Date;
    to: Date;
    timeZone: string;
  }): Promise<BusyInterval[]>;

  createEvent(
    options: {
      accessToken: string;
      refreshToken: string | null;
      expiresAt: Date | null;
      calendarId: string | null;
      event: CalendarEventInput;
    },
  ): Promise<CalendarEventResult>;

  updateEvent(
    options: {
      accessToken: string;
      refreshToken: string | null;
      expiresAt: Date | null;
      calendarId: string | null;
      eventId: string;
      event: CalendarEventInput;
    },
  ): Promise<CalendarEventResult>;

  deleteEvent(
    options: {
      accessToken: string;
      refreshToken: string | null;
      expiresAt: Date | null;
      calendarId: string | null;
      eventId: string;
    },
  ): Promise<{ ok: boolean }>;
}
