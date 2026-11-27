import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CalendarTokenCipherService } from './calendar-token-cipher.service';
import { GoogleCalendarProvider } from './google-calendar.provider';
import { MicrosoftCalendarProvider } from './microsoft-calendar.provider';
import type {
  BusyInterval,
  CalendarConnectionRecord,
  CalendarEventInput,
  OAuthTokenResult,
} from './calendar.types';
import type { ICalendarProvider } from './calendar-provider.interface';

export type CalendarOwnerKind = 'DOCTOR' | 'CLINIC';
export type CalendarProviderKind = 'GOOGLE' | 'MICROSOFT';

/**
 * Calendar sync facade used by the booking engine (busy lookup + event push)
 * and by the admin calendar endpoints (connect/disconnect/status).
 *
 * Two owners are supported: a single doctor (DOCTOR) or the clinic as a whole
 * (CLINIC). Provider selection happens per owner, so a clinic with only one
 * doctor can be connected directly, and a clinic with several doctors can run
 * one calendar per doctor.
 */
@Injectable()
export class CalendarSyncService {
  private readonly logger = new Logger(CalendarSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: CalendarTokenCipherService,
    private readonly google: GoogleCalendarProvider,
    private readonly microsoft: MicrosoftCalendarProvider,
  ) {}

  private getProvider(provider?: string | null): ICalendarProvider {
    const kind = (provider as CalendarProviderKind) ?? 'GOOGLE';
    if (kind === 'MICROSOFT') return this.microsoft;
    return this.google;
  }

  async getConnection(
    ownerType: CalendarOwnerKind,
    ownerId: string,
    provider?: string | null,
  ): Promise<CalendarConnectionRecord | null> {
    const kind = (provider ??
      (await this.defaultProvider(ownerType, ownerId))) as CalendarProviderKind;
    return this.prisma.calendarConnection.findFirst({
      where: { ownerType, ownerId, provider: kind },
    });
  }

  async getOAuthToken(
    connection: CalendarConnectionRecord,
  ): Promise<OAuthTokenResult | null> {
    const provider = this.getProvider(connection.provider);
    const accessToken = this.cipher.decrypt(connection.accessToken);
    const refreshToken = connection.refreshToken
      ? this.cipher.decrypt(connection.refreshToken)
      : null;
    const expiresAt = connection.tokenExpiresAt;
    if (accessToken && expiresAt && expiresAt.getTime() - Date.now() > 60_000) {
      return {
        accessToken,
        refreshToken,
        expiresAt,
        scopes: connection.scopes ?? '',
      };
    }
    const refreshed = await provider.refreshAccessToken({
      refreshToken: refreshToken ?? '',
      clientId:
        connection.provider === 'MICROSOFT'
          ? process.env.MICROSOFT_CALENDAR_CLIENT_ID || ''
          : process.env.GOOGLE_CALENDAR_CLIENT_ID || '',
      clientSecret:
        connection.provider === 'MICROSOFT'
          ? process.env.MICROSOFT_CALENDAR_CLIENT_SECRET || ''
          : process.env.GOOGLE_CALENDAR_CLIENT_SECRET || '',
      scopes: connection.scopes ?? undefined,
    });
    await this.prisma.calendarConnection.update({
      where: { id: connection.id },
      data: {
        accessToken: this.cipher.encrypt(refreshed.accessToken),
        refreshToken: refreshed.refreshToken
          ? this.cipher.encrypt(refreshed.refreshToken)
          : connection.refreshToken,
        tokenExpiresAt: refreshed.expiresAt,
        scopes: refreshed.scopes,
        lastSyncedAt: new Date(),
      },
    });
    return refreshed;
  }

  async getBusyIntervals(
    ownerType: CalendarOwnerKind,
    ownerId: string,
    options: {
      provider?: string | null;
      from: Date;
      to: Date;
      timeZone?: string;
    },
  ): Promise<BusyInterval[]> {
    const provider = this.getProvider(options.provider);
    const kind = ((provider.provider as string) ||
      'GOOGLE') as CalendarProviderKind;
    const connection = await this.prisma.calendarConnection.findFirst({
      where: { ownerType, ownerId, provider: kind },
    });
    if (!connection) return [];
    const token = await this.getOAuthToken(connection);
    if (!token) return [];
    return provider.getBusyIntervals({
      accessToken: token.accessToken,
      refreshToken: token.refreshToken,
      expiresAt: token.expiresAt,
      calendarId: connection.calendarId,
      from: options.from,
      to: options.to,
      timeZone: options.timeZone ?? 'Africa/Nairobi',
    });
  }

  async hasBookingConflict(
    clinicId: string,
    doctorId: string | null,
    scheduledAt: Date,
    durationMinutes: number,
  ): Promise<boolean> {
    const end = new Date(scheduledAt.getTime() + durationMinutes * 60_000);
    const intervals = await this.getBookingBusyIntervals(
      clinicId,
      doctorId,
      scheduledAt,
      end,
    );
    return intervals.some(
      (interval) => interval.start < end && interval.end > scheduledAt,
    );
  }

  async getBookingBusyIntervals(
    clinicId: string,
    doctorId: string | null,
    from: Date,
    to: Date,
  ) {
    const owners = await this.prisma.calendarConnection.findMany({
      where: {
        OR: [
          { ownerType: 'CLINIC', ownerId: clinicId },
          ...(doctorId
            ? [{ ownerType: 'DOCTOR' as const, ownerId: doctorId }]
            : []),
        ],
      },
      select: { ownerType: true, ownerId: true, provider: true },
    });
    const intervals = await Promise.all(
      owners.map((owner) =>
        this.getBusyIntervals(
          owner.ownerType === 'DOCTOR' ? 'DOCTOR' : 'CLINIC',
          owner.ownerId,
          {
            provider: owner.provider,
            from,
            to,
          },
        ),
      ),
    );
    return intervals.flat();
  }

  async createAppointmentEvent(appointment: {
    id: string;
    scheduledAt: Date;
    durationMinutes: number;
    doctorId: string | null;
    clinicId: string;
    externalCalendarProvider: string | null;
  }): Promise<{ ok: boolean; eventId?: string }> {
    const ownerType: CalendarOwnerKind = appointment.doctorId
      ? 'DOCTOR'
      : 'CLINIC';
    const ownerId = appointment.doctorId ?? appointment.clinicId;
    const configured = appointment.externalCalendarProvider;
    const connection = await this.prisma.calendarConnection.findFirst({
      where: {
        ownerType,
        ownerId,
        ...(configured && configured !== 'NONE'
          ? { provider: configured }
          : {}),
      },
      orderBy: { connectedAt: 'desc' },
    });
    if (!connection) return { ok: false };
    const provider = this.getProvider(connection.provider);
    const token = await this.getOAuthToken(connection);
    if (!token) return { ok: false };
    const event: CalendarEventInput = {
      ownerType,
      ownerId,
      provider: provider.provider,
      title: 'MenoDAO Appointment',
      start: appointment.scheduledAt,
      end: new Date(
        appointment.scheduledAt.getTime() +
          appointment.durationMinutes * 60_000,
      ),
      description: `MenoDAO dental appointment #${appointment.id.slice(0, 8).toUpperCase()}`,
    };
    const result = await provider.createEvent({
      accessToken: token.accessToken,
      refreshToken: token.refreshToken,
      expiresAt: token.expiresAt,
      calendarId: connection.calendarId,
      event,
    });
    await this.prisma.appointment.update({
      where: { id: appointment.id },
      data: {
        externalCalendarProvider: provider.provider,
        externalEventId: result.eventId,
        calendarSyncedAt: new Date(),
      },
    });
    return { ok: true, eventId: result.eventId };
  }

  async updateAppointmentEvent(
    appointmentId: string,
    data: {
      scheduledAt: Date;
      durationMinutes: number;
      doctorId: string | null;
      clinicId: string;
      externalCalendarProvider: string;
    },
  ): Promise<{ ok: boolean; eventId?: string }> {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
    });
    if (!appointment) return { ok: false };
    const provider = this.getProvider(data.externalCalendarProvider);
    const ownerType: CalendarOwnerKind = appointment.doctorId
      ? 'DOCTOR'
      : 'CLINIC';
    const ownerId = appointment.doctorId ?? appointment.clinicId;
    const connection = await this.prisma.calendarConnection.findFirst({
      where: { ownerType, ownerId, provider: provider.provider },
    });
    if (!connection) return { ok: false };
    const token = await this.getOAuthToken(connection);
    if (!token) return { ok: false };
    const event: CalendarEventInput = {
      ownerType,
      ownerId,
      provider: provider.provider,
      title: 'MenoDAO Appointment',
      start: data.scheduledAt,
      end: new Date(data.scheduledAt.getTime() + data.durationMinutes * 60_000),
      description: 'MenoDAO dental appointment',
    };
    const result = await provider.updateEvent({
      accessToken: token.accessToken,
      refreshToken: token.refreshToken,
      expiresAt: token.expiresAt,
      calendarId: connection.calendarId,
      eventId: appointment.externalEventId ?? '',
      event,
    });
    await this.prisma.appointment.update({
      where: { id: appointmentId },
      data: { calendarSyncedAt: new Date() },
    });
    return { ok: true, eventId: result.eventId };
  }

  async deleteAppointmentEvent(
    appointmentId: string,
  ): Promise<{ ok: boolean }> {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
    });
    if (!appointment) return { ok: false };
    const provider = this.getProvider(appointment.externalCalendarProvider);
    if (!provider) return { ok: true };
    const ownerType: CalendarOwnerKind = appointment.doctorId
      ? 'DOCTOR'
      : 'CLINIC';
    const ownerId = appointment.doctorId ?? appointment.clinicId;
    const connection = await this.prisma.calendarConnection.findFirst({
      where: { ownerType, ownerId, provider: provider.provider },
    });
    if (!connection) return { ok: true };
    const token = await this.getOAuthToken(connection);
    if (!token) return { ok: true };
    const eventId = appointment.externalEventId;
    if (!eventId) return { ok: true };
    const deleted = await provider.deleteEvent({
      accessToken: token.accessToken,
      refreshToken: token.refreshToken,
      expiresAt: token.expiresAt,
      calendarId: connection.calendarId,
      eventId,
    });
    await this.prisma.appointment.update({
      where: { id: appointmentId },
      data: {
        externalCalendarProvider: null,
        externalEventId: null,
        calendarSyncedAt: new Date(),
      },
    });
    return deleted;
  }

  async disconnect(
    ownerType: CalendarOwnerKind,
    ownerId: string,
    provider: string,
  ): Promise<void> {
    await this.prisma.calendarConnection.deleteMany({
      where: { ownerType, ownerId, provider },
    });
  }

  async createConnection(
    ownerType: CalendarOwnerKind,
    ownerId: string,
    provider: string,
    token: OAuthTokenResult,
    accountEmail: string | null,
  ) {
    const kind = provider as CalendarProviderKind;
    const encryptedAccess = this.cipher.encrypt(token.accessToken);
    const encryptedRefresh = token.refreshToken
      ? this.cipher.encrypt(token.refreshToken)
      : null;
    const connection = await this.prisma.calendarConnection.upsert({
      where: {
        ownerType_ownerId_provider: { ownerType, ownerId, provider: kind },
      },
      create: {
        ownerType,
        ownerId,
        provider: kind,
        calendarId: null,
        accountEmail,
        accessToken: encryptedAccess,
        refreshToken: encryptedRefresh,
        tokenExpiresAt: token.expiresAt,
        scopes: token.scopes,
        connectedAt: new Date(),
        lastSyncedAt: new Date(),
      },
      update: {
        accessToken: encryptedAccess,
        refreshToken: encryptedRefresh,
        tokenExpiresAt: token.expiresAt,
        scopes: token.scopes,
        accountEmail: accountEmail ?? null,
        connectedAt: new Date(),
        lastSyncedAt: new Date(),
      },
    });
    return connection;
  }

  private async defaultProvider(
    ownerType: CalendarOwnerKind,
    ownerId: string,
  ): Promise<CalendarProviderKind> {
    for (const kind of ['GOOGLE', 'MICROSOFT'] as CalendarProviderKind[]) {
      const connection = await this.prisma.calendarConnection.findFirst({
        where: { ownerType, ownerId, provider: kind },
      });
      if (connection) return kind;
      const configured =
        kind === 'MICROSOFT'
          ? this.microsoft.configured
          : this.google.configured;
      if (configured) return kind;
    }
    // No connection and no provider configured: fall back to Google so the
    // busy lookup simply returns an empty set until an operator connects.
    return 'GOOGLE';
  }
}
