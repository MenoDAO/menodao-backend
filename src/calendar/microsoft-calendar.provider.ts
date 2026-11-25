import { Injectable } from '@nestjs/common';
import { ICalendarProvider } from './calendar-provider.interface';
import {
  BusyInterval,
  CalendarEventInput,
  CalendarEventResult,
  OAuthTokenResult,
} from './calendar.types';

/**
 * Microsoft 365 (Graph API) calendar provider. Same design as the Google
 * provider: refresh, free/busy, and event create/update/delete all go through
 * here, so booking slots can be checked against real attendee schedules.
 */
@Injectable()
export class MicrosoftCalendarProvider implements ICalendarProvider {
  readonly provider = 'MICROSOFT' as const;

  readonly configured: boolean = Boolean(
    process.env.MICROSOFT_CALENDAR_CLIENT_ID &&
    process.env.MICROSOFT_CALENDAR_CLIENT_SECRET,
  );

  private get clientId(): string {
    return process.env.MICROSOFT_CALENDAR_CLIENT_ID || '';
  }

  private get clientSecret(): string {
    return process.env.MICROSOFT_CALENDAR_CLIENT_SECRET || '';
  }

  private get tenantId(): string {
    return (
      process.env.MICROSOFT_CALENDAR_TENANT_ID ||
      process.env.MICROSOFT_CALENDAR_TENANT ||
      'common'
    );
  }

  private get scopes(): string[] {
    return ['Calendars.ReadWrite'];
  }

  private get tokenEndpoint(): string {
    return `https://login.microsoftonline.com/${this.tenantId}/oauth2/v2.0/token`;
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
        scope: options.scopes?.[0] ?? this.scopes[0],
      }),
    });
    const data = (await response.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    if (!response.ok || typeof data.access_token !== 'string') {
      throw new Error('MICROSOFT_TOKEN_REFRESH_FAILED');
    }
    const expiresIn = Number(data.expires_in) || 3600;
    return {
      accessToken: data.access_token,
      refreshToken: (data.refresh_token as string) ?? options.refreshToken,
      expiresAt: new Date(Date.now() + expiresIn * 1000),
      scopes: (data.scope as string) || this.scopes[0],
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
        scope: options.scopes.join(' '),
      }),
    });
    const data = (await response.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    if (!response.ok || typeof data.access_token !== 'string') {
      throw new Error('MICROSOFT_TOKEN_EXCHANGE_FAILED');
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
      response_mode: 'query',
    });
    return `https://login.microsoftonline.com/${this.tenantId}/oauth2/v2.0/authorize?${params.toString()}`;
  }

  async getUserEmail(accessToken: string): Promise<string | null> {
    const response = await fetch('https://graph.microsoft.com/v1.0/me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return null;
    const data = (await response.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const mail = data.mail ?? data.userPrincipalName;
    return typeof mail === 'string' ? mail : null;
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
      throw new Error('MICROSOFT_API_ERROR');
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
      value?: Array<{
        busyBlocks?: Array<{ start?: string; end?: string }>;
        freeBlocks?: Array<{ start?: string; end?: string }>;
      }>;
    }>(
      'https://graph.microsoft.com/v1.0/me/calendar/getSchedule',
      options.accessToken,
      {
        schedules: [options.calendarId || 'primary'],
        startTime: {
          dateTime: options.from.toISOString(),
          timeZone: 'UTC',
        },
        endTime: { dateTime: options.to.toISOString(), timeZone: 'UTC' },
      },
    );
    const intervals: BusyInterval[] = [];
    for (const entry of data.value ?? []) {
      for (const block of entry.busyBlocks ?? []) {
        if (!block.start || !block.end) continue;
        intervals.push({
          start: new Date(block.start),
          end: new Date(block.end),
        });
      }
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
    }>('https://graph.microsoft.com/v1.0/me/events', options.accessToken, {
      subject: options.event.title,
      body: { contentType: 'text', content: options.event.description ?? '' },
      start: {
        dateTime: new Date(options.event.start).toISOString(),
        timeZone: 'UTC',
      },
      end: {
        dateTime: new Date(options.event.end).toISOString(),
        timeZone: 'UTC',
      },
    });
    if (!data.id) throw new Error('MICROSOFT_EVENT_CREATE_FAILED');
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
      `https://graph.microsoft.com/v1.0/me/events/${options.eventId}`,
      options.accessToken,
      {
        subject: options.event.title,
        body: { contentType: 'text', content: options.event.description ?? '' },
        start: {
          dateTime: new Date(options.event.start).toISOString(),
          timeZone: 'UTC',
        },
        end: {
          dateTime: new Date(options.event.end).toISOString(),
          timeZone: 'UTC',
        },
      },
    );
    if (!data.id) throw new Error('MICROSOFT_EVENT_UPDATE_FAILED');
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
      `https://graph.microsoft.com/v1.0/me/events/${options.eventId}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${options.accessToken}` },
      },
    );
    if (!response.ok) throw new Error('MICROSOFT_EVENT_DELETE_FAILED');
    return { ok: true };
  }
}
