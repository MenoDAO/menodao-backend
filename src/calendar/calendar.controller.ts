import {
  Controller,
  Get,
  Delete,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { AdminAuthGuard } from '../admin/guards/admin-auth.guard';
import { AdminService } from '../admin/admin.service';
import { PrismaService } from '../prisma/prisma.service';
import { CalendarSyncService } from './calendar-sync.service';
import { CalendarConfigService } from './calendar-config.service';
import { GoogleCalendarProvider } from './google-calendar.provider';
import { MicrosoftCalendarProvider } from './microsoft-calendar.provider';
import type { CalendarOwnerKind, CalendarProviderKind } from './calendar-sync.service';

const FRONTEND_BASE_URL =
  process.env.WEB_APP_URL ?? process.env.APP_URL ?? 'https://app.menodao.org';

/**
 * Admin calendar plumbing (Google Calendar / Microsoft 365).
 *
 * - `GET /admin/calendar/providers` — which providers are configured.
 * - `GET /admin/calendar/connect?ownerType=DOCTOR&ownerId=<id>&provider=GOOGLE` —
 *   returns the OAuth authorization URL (admin session required).
 * - `GET /admin/calendar/callback?code&state` — provider redirect target; the
 *   state is HMAC-signed and binds the code to a doctor/clinic + provider.
 * - `DELETE /admin/calendar/:ownerType/:ownerId?provider=GOOGLE` — disconnect.
 *
 * Once `GOOGLE_CALENDAR_CLIENT_ID/SECRET` (or `MICROSOFT_*`) + redirect URI are
 * set in the environment, the OAuth flow works without any further code change.
 */
@Controller('admin/calendar')
@ApiBearerAuth()
export class AdminCalendarController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly calendarSync: CalendarSyncService,
    private readonly calendarConfig: CalendarConfigService,
    private readonly adminService: AdminService,
  ) {}

  @Get('providers')
  @UseGuards(AdminAuthGuard)
  @ApiOperation({ summary: 'Which external calendars are configured' })
  async listProviders() {
    const providers: Record<string, boolean> = {};
    for (const kind of ['GOOGLE', 'MICROSOFT'] as CalendarProviderKind[]) {
      const provider = kind === 'MICROSOFT' ? new MicrosoftCalendarProvider() : new GoogleCalendarProvider();
      providers[kind] = provider.configured;
    }
    return { google: { configured: providers.GOOGLE, clientId: process.env.GOOGLE_CALENDAR_CLIENT_ID || null }, microsoft: { configured: providers.MICROSOFT, clientId: process.env.MICROSOFT_CALENDAR_CLIENT_ID || null } };
  }

  @Get('connect')
  @UseGuards(AdminAuthGuard)
  @ApiOperation({ summary: 'Start Google/Microsoft calendar OAuth' })
  async connect(
    @Query('ownerType') ownerType: string,
    @Query('ownerId') ownerId: string,
    @Query('provider') provider: string,
    @Req() req: { admin?: { id: string; role: string } },
  ) {
    const ownerKind: CalendarOwnerKind =
      ownerType === 'CLINIC' ? 'CLINIC' : 'DOCTOR';
    const kind = (provider === 'MICROSOFT' ? 'MICROSOFT' : 'GOOGLE') as CalendarProviderKind;
    const admin = await this.adminService.getAdminForCalendarState(req.admin?.id ?? '');
    if (!admin) throw new NotFoundException('Admin not found');
    const config = this.calendarConfig.getProviderConfig(kind);
    if (!config) {
      throw new BadRequestException(
        `${kind} calendar is not configured. Set the *_CALENDAR_CLIENT_ID/_CALENDAR_CLIENT_SECRET and redirect URI environment variables.`,
      );
    }
    const state = this.calendarConfig.signCalendarState({
      ownerType,
      ownerId,
      provider: kind,
      adminId: req.admin?.id,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 600,
    });
    const url = new (kind === 'MICROSOFT' ? MicrosoftCalendarProvider : GoogleCalendarProvider)().buildAuthorizationUrl(
      {
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        redirectUri: config.redirectUri,
        scopes: config.scopes,
        state,
      },
    );
    return { url, provider: kind, ownerType: ownerKind, ownerId };
  }

  @Get('callback')
  async callback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
  ) {
    const parsed = this.calendarConfig.verifyCalendarState(state);
    if (!parsed) throw new BadRequestException('Invalid calendar state');
    const ownerType = parsed.ownerType as CalendarOwnerKind;
    const ownerId = String(parsed.ownerId);
    const kind = String(parsed.provider) as CalendarProviderKind;
    const adminId = String(parsed.adminId ?? '');
    const admin = await this.adminService.getAdminForCalendarState(adminId);
    if (!admin) throw new BadRequestException('Invalid calendar admin state');

    const config = this.calendarConfig.getProviderConfig(kind);
    if (!config) throw new BadRequestException('Calendar provider is not configured');
    const providerInstance = kind === 'MICROSOFT' ? new MicrosoftCalendarProvider() : new GoogleCalendarProvider();

    const token = await providerInstance.exchangeCode({
      code,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      redirectUri: config.redirectUri,
      scopes: config.scopes,
    });
    const accountEmail = await providerInstance.getUserEmail(token.accessToken);
    await this.calendarSync.createConnection(ownerType, ownerId, kind, token, accountEmail);
    return res.redirect(
      `${FRONTEND_BASE_URL}/admin/clinics?calendar=connected&ownerType=${ownerType}&ownerId=${ownerId}`,
    );
  }

  @Delete(':ownerType/:ownerId')
  @UseGuards(AdminAuthGuard)
  async disconnect(
    @Param('ownerType') ownerType: string,
    @Param('ownerId') ownerId: string,
    @Query('provider') provider: string,
    @Req() req: { admin?: { id: string } },
  ) {
    const ownerKind: CalendarOwnerKind = ownerType === 'CLINIC' ? 'CLINIC' : 'DOCTOR';
    const kind = (provider === 'MICROSOFT' ? 'MICROSOFT' : 'GOOGLE') as CalendarProviderKind;
    const admin = await this.adminService.getAdminForCalendarState(req.admin?.id ?? '');
    if (!admin) throw new NotFoundException('Admin not found');
    await this.calendarSync.disconnect(ownerKind, ownerId, kind);
    return { ok: true };
  }
}
