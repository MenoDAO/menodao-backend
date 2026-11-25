import { Injectable } from '@nestjs/common';
import { ICalendarProvider } from './calendar-provider.interface';
import {
  BusyInterval,
  CalendarEventInput,
  CalendarEventResult,
  OAuthTokenResult,
} from './calendar.types';

/**
 * Google Calendar provider.
 *
 * Talks to the Google Calendar REST API directly (no SDK dependency) so the
 * plumbing can be swapped into either Google Calendar or Microsoft 365 without
 * changing call sites. Token refresh, free/busy lookup and event create/update/
 * delete all funnel through here.
 */
@Injectable()
export class GoogleCalendarProvider implements ICalendarProvider {
  readonly provider = 'GOOGLE' as const;

  readonly configured: boolean = Boolean(
    process.env.GOOGLE_CALENDAR_CLIENT_ID &&
    process.env.GOOGLE_CALENDAR_CLIENT_SECRET,
  );

  private get clientId(): string {
    return process.env.GOOGLE_CALENDAR_CLIENT_ID || '';
  }

  private get clientSecret(): string {
    return process.env.GOOGLE_CALENDAR_CLIENT_SECRET || '';
  }

  private get redirectUri(): string {
    return (
      process.env.GOOGLE_CALENDAR_REDIRECT_URI ||
      process.env.CALENDAR_REDIRECT_URI ||
      ''
    );
  }

  private get scopes(): string[] {
    return ['https://www.googleapis.com/auth/calendar.events'];
  }

  private get tokenEndpoint(): string {
    return 'https://oauth2.googleapis.com/token';
  }

  async refreshAccessToken(options: {
    refreshToken: string;
    clientId: string;
    clientSecret: string;
    scopes?: string;
  }): Promise<OAuthTokenResult> {
    const response = await fetch(this.tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: options.refreshToken,
        client_id: options.clientId,
        client_secret: options.clientSecret,
      }),
    });
    const data = (await response.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    if (!response.ok || typeof data.access_token !== 'string') {
      throw new Error('GOOGLE_TOKEN_REFRESH_FAILED');
    }
    const expiresIn = Number(data.expires_in) || 3600;
    return {
      accessToken: data.access_token,
      refreshToken: (data.refresh_token as string) ?? options.refreshToken,
      expiresAt: new Date(Date.now() + expiresIn * 1000),
      scopes: (data.scope as string) || options.scopes?.[0] || '',
    };
  }

  async exchangeCode(options: {
    code: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    scopes: string[];
  }): Promise<OAuthTokenResult> {
    const response = await fetch(this.tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: options.code,
        client_id: options.clientId,
        client_secret: options.clientSecret,
        redirect_uri: options.redirectUri,
      }),
    });
    const data = (await response.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    if (!response.ok || typeof data.access_token !== 'string') {
      throw new Error('GOOGLE_TOKEN_EXCHANGE_FAILED');
    }
    const expiresIn = Number(data.expires_in) || 3600;
    return {
      accessToken: data.access_token,
      refreshToken: (data.refresh_token as string) ?? null,
      expiresAt: new Date(Date.now() + expiresIn * 1000),
      scopes: (data.scope as string) || options.scopes[0] || '',
    };
  }

  buildAuthorizationUrl(options: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    scopes: string[];
    state: string;
  }): string {
    const params = new URLSearchParams({
      client_id: options.clientId,
      redirect_uri: options.redirectUri,
      response_type: 'code',
      scope: options.scopes.join(' '),
      state: options.state,
      access_type: 'offline',
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  async getUserEmail(accessToken: string): Promise<string | null> {
    const response = await fetch(
      'https://www.googleapis.com/oauth2/v3/userinfo',
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );
    if (!response.ok) return null;
    const data = (await response.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const email = data.email;
    return typeof email === 'string' ? email : null;
  }

  private async postJson<T>(
    url: string,
    token: string,
    body: Record<string, unknown>,
  ): Promise<T> {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const data = (await response.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    if (!response.ok) {
      throw new Error(`GOOGLE_API_ERROR_${response.status}`);
    }
    return data as T;
  }

  async getBusyIntervals(options: {
    accessToken: string;
    refreshToken: string | null;
    expiresAt: Date | null;
    calendarId: string | null;
    from: Date;
    to: Date;
    timeZone: string;
  }): Promise<BusyInterval[]> {
    const data = await this.postJson<{
      calendars?: Record<
        string,
        { busy?: Array<{ start?: string; end?: string }> }
      >;
    }>('https://www.googleapis.com/calendar/v3/freeBusy', options.accessToken, {
      timeMin: options.from.toISOString(),
      timeMax: options.to.toISOString(),
      timeZone: options.timeZone,
      items: [{ id: options.calendarId || 'primary' }],
    });
    const busy = data.calendars?.[options.calendarId || 'primary']?.busy ?? [];
    const intervals: BusyInterval[] = [];
    for (const block of busy) {
      if (!block.start || !block.end) continue;
      intervals.push({
        start: new Date(block.start),
        end: new Date(block.end),
      });
    }
    return intervals;
  }

  async createEvent(options: {
    accessToken: string;
    refreshToken: string | null;
    expiresAt: Date | null;
    calendarId: string | null;
    event: CalendarEventInput;
  }): Promise<CalendarEventResult> {
    const data = await this.postJson<{
      id?: string;
    }>(
      `https://www.googleapis.com/calendar/v3/calendars/${options.calendarId || 'primary'}/events`,
      options.accessToken,
      {
        summary: options.event.title,
        description: options.event.description,
        start: {
          dateTime: new Date(options.event.start).toISOString(),
          timeZone: 'Africa/Nairobi',
        },
        end: {
          dateTime: new Date(options.event.end).toISOString(),
          timeZone: 'Africa/Nairobi',
        },
      },
    );
    if (!data.id) throw new Error('GOOGLE_EVENT_CREATE_FAILED');
    return { eventId: String(data.id) };
  }

  async updateEvent(options: {
    accessToken: string;
    refreshToken: string | null;
    expiresAt: Date | null;
    calendarId: string | null;
    eventId: string;
    event: CalendarEventInput;
  }): Promise<CalendarEventResult> {
    const data = await this.postJson<{ id?: string }>(
      `https://www.googleapis.com/calendar/v3/calendars/${options.calendarId || 'primary'}/events/${options.eventId}`,
      options.accessToken,
      {
        summary: options.event.title,
        description: options.event.description,
        start: {
          dateTime: new Date(options.event.start).toISOString(),
          timeZone: 'Africa/Nairobi',
        },
        end: {
          dateTime: new Date(options.event.end).toISOString(),
          timeZone: 'Africa/Nairobi',
        },
      },
    );
    if (!data.id) throw new Error('GOOGLE_EVENT_UPDATE_FAILED');
    return { eventId: String(data.id) };
  }

  async deleteEvent(options: {
    accessToken: string;
    refreshToken: string | null;
    expiresAt: Date | null;
    calendarId: string | null;
    eventId: string;
  }): Promise<{ ok: boolean }> {
    const response = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${options.calendarId || 'primary'}/events/${options.eventId}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${options.accessToken}` },
      },
    );
    if (!response.ok) throw new Error('GOOGLE_EVENT_DELETE_FAILED');
    return { ok: true };
  }
}
