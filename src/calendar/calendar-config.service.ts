import { Injectable } from '@nestjs/common';
import { createHmac } from 'crypto';
import type { CalendarProvider } from './calendar.types';

export interface CalendarProviderConfig {
  provider: CalendarProvider;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string[];
  enabled: boolean;
}

export const CALENDAR_PROVIDERS = ['GOOGLE', 'MICROSOFT'] as const;

export const CALENDAR_SCOPES: Record<CalendarProvider, string[]> = {
  GOOGLE: ['https://www.googleapis.com/auth/calendar.events'],
  MICROSOFT: ['Calendars.ReadWrite'],
};

const DEFAULT_REDIRECT_URI =
  process.env.CALENDAR_REDIRECT_URI ??
  `${process.env.API_BASE_URL ?? 'http://localhost:3000'}/admin/calendar/callback`;

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

@Injectable()
export class CalendarConfigService {
  getProviderConfig(provider: string): CalendarProviderConfig | null {
    const resolved = (CALENDAR_PROVIDERS.includes(
      provider as (typeof CALENDAR_PROVIDERS)[number],
    )
      ? provider
      : 'GOOGLE') as CalendarProvider;

    const rawClientId =
      process.env[`${resolved}_CALENDAR_CLIENT_ID`] ??
      process.env[`GOOGLE_CALENDAR_CLIENT_ID`] ??
      process.env[`MICROSOFT_CALENDAR_CLIENT_ID`] ??
      '';
    const rawClientSecret =
      process.env[`${resolved}_CALENDAR_CLIENT_SECRET`] ??
      process.env[`GOOGLE_CALENDAR_CLIENT_SECRET`] ??
      process.env[`MICROSOFT_CALENDAR_CLIENT_SECRET`] ??
      '';
    const redirectUri =
      process.env[`${resolved}_CALENDAR_REDIRECT_URI`] ??
      process.env[`CALENDAR_REDIRECT_URI`] ??
      DEFAULT_REDIRECT_URI;
    const configured = Boolean(rawClientId && rawClientSecret && redirectUri);

    if (!configured) return null;
    return {
      provider: resolved,
      clientId: rawClientId,
      clientSecret: rawClientSecret,
      redirectUri,
      scopes: CALENDAR_SCOPES[resolved],
      enabled: true,
    };
  }

  isProviderConfigured(provider: string): boolean {
    return this.getProviderConfig(provider) !== null;
  }

  getCalendarStateSecret(): string {
    return (
      process.env.CALENDAR_STATE_SECRET ?? process.env.JWT_SECRET ?? 'menodao-calendar-state-secret'
    );
  }

  signCalendarState(payload: Record<string, unknown>): string {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = createHmac('sha256', this.getCalendarStateSecret())
      .update(body)
      .digest('hex');
    return `${body}.${sig}`;
  }

  verifyCalendarState(state: string): Record<string, unknown> | null {
    const [body, sig] = state.split('.');
    if (!body || !sig) return null;
    const expected = createHmac('sha256', this.getCalendarStateSecret())
      .update(body)
      .digest('hex');
    if (!safeEqual(sig, expected)) return null;
    try {
      const parsed = JSON.parse(
        Buffer.from(body, 'base64url').toString('utf8'),
      ) as Record<string, unknown>;
      const exp =
        typeof parsed.exp === 'number' ? parsed.exp : NaN;
      // Small clock-skew tolerance, but reject states that actually expired.
      if (Number.isNaN(exp) || exp < Math.floor(Date.now() / 1000) - 60) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }
}
