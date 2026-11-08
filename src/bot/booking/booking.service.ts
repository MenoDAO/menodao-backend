/**
 * booking.service.ts (bot monolith port)
 *
 * Multi-turn deterministic booking. State machine:
 *   COLLECTING → AWAITING_CONFIRMATION → Appointment created + draft deleted.
 *
 * Adapted from menobot BookingService:
 * - BookingDraft → BotBookingDraft (memberId FK), MessageLog → BotMessageLog
 * - Clinic stub → backend Clinic (APPROVED) + active Procedures as services
 * - Appointment stub → backend Appointment (memberId/clinicId/scheduledAt,
 *   intakeReason=service, hasConsent=true) + AppointmentEvent.
 * - Membership check intentionally not enforced here (bot can book for
 *   unverified stub members; staff verify later) — the REST path in
 *   AppointmentsService keeps the strict active-subscription guard.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { AppointmentActor, AppointmentStatus } from '@prisma/client';
import { DateTime } from 'luxon';
import type { ILlmProvider } from '../ai/interfaces/llm-provider.interface';
import { LLM_PROVIDER } from '../ai/interfaces/llm-provider.interface';
import {
  BOOKING_EXTRACTION_SYSTEM_PROMPT,
  buildBookingExtractionPrompt,
} from '../prompts';
import {
  BookingConfig,
  DEFAULT_TZ,
  DEFAULT_OPEN_DAYS,
  DEFAULT_OPEN_TIME,
  DEFAULT_CLOSE_TIME,
  DEFAULT_SLOT_MINUTES,
  anchors,
  nairobiNow,
  toScheduledAt,
  validateSlot,
  daySlots,
  openDayNames,
  snapToSlot,
} from './booking-time.util';
import {
  BookingLang,
  t,
  ASK_SERVICE,
  ASK_DATE_TIME,
  ASK_NAME,
  ASK_CLINIC,
  CLINIC_NOT_FOUND,
  SERVICE_NOT_OFFERED,
  SLOT_PAST,
  SLOT_CLOSED_DAY,
  SLOT_OUTSIDE_HOURS,
  SLOT_NOT_ON_BOUNDARY,
  SLOT_TAKEN,
  READ_BACK,
  BOOKING_AWAITING_CONFIRMATION,
  BOOKING_CONFIRMED,
  EMERGENCY_GUIDANCE,
  BOOKING_CANCELLED,
  PARSE_FAILURE,
} from './booking.messages';
import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  validateSync,
} from 'class-validator';

type BookingAction =
  | 'PROVIDE_DETAILS'
  | 'CONFIRM'
  | 'DECLINE'
  | 'CANCEL_BOOKING'
  | 'UNRELATED';

class BookingExtractionResult {
  @IsIn([
    'PROVIDE_DETAILS',
    'CONFIRM',
    'DECLINE',
    'CANCEL_BOOKING',
    'UNRELATED',
  ])
  action!: BookingAction;

  @IsOptional()
  @IsString()
  clientName?: string | null;

  @IsOptional()
  @IsString()
  service?: string | null;

  @IsOptional()
  @IsString()
  clinicName?: string | null;

  @IsOptional()
  @IsString()
  preferredDate?: string | null;

  @IsOptional()
  @IsString()
  preferredTime?: string | null;

  @IsOptional()
  @IsString()
  rawDateMentioned?: string | null;

  @IsIn(['en', 'sw'])
  language!: string;

  triageFlag!: boolean;

  @IsNumber()
  confidence!: number;
}

export interface BookingResult {
  success: boolean;
  appointmentId?: string;
  clientName?: string;
  scheduledAt?: Date;
  scheduledAtFormatted?: string;
  service?: string;
  clinicName?: string;
  confirmationMessage: string;
  error?: string;
}

type BotClinic = {
  id: string;
  name: string;
  services: string[];
};

@Injectable()
export class BookingService {
  private readonly logger = new Logger(BookingService.name);
  private readonly cfg: BookingConfig;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    @Inject(LLM_PROVIDER) private readonly llmProvider: ILlmProvider,
  ) {
    this.cfg = this.loadConfig();
  }

  private loadConfig(): BookingConfig {
    const parseOpenDays = (raw: string | undefined): number[] => {
      if (!raw) return DEFAULT_OPEN_DAYS;
      return raw
        .split(',')
        .map((s) => parseInt(s.trim(), 10))
        .filter(Boolean);
    };
    return {
      timezone:
        this.configService.get<string>('BOOKING_TIMEZONE') ?? DEFAULT_TZ,
      openDays: parseOpenDays(
        this.configService.get<string>('BOOKING_OPEN_DAYS'),
      ),
      openTime:
        this.configService.get<string>('BOOKING_OPEN_TIME') ??
        DEFAULT_OPEN_TIME,
      closeTime:
        this.configService.get<string>('BOOKING_CLOSE_TIME') ??
        DEFAULT_CLOSE_TIME,
      slotMinutes: parseInt(
        this.configService.get<string>('BOOKING_SLOT_MINUTES') ??
          String(DEFAULT_SLOT_MINUTES),
        10,
      ),
      draftTtlMinutes: parseInt(
        this.configService.get<string>('BOOKING_DRAFT_TTL_MINUTES') ?? '30',
        10,
      ),
    };
  }

  isDraftFresh(draft: { updatedAt: Date }): boolean {
    const updatedAt = DateTime.fromJSDate(draft.updatedAt).setZone(
      this.cfg.timezone,
    );
    return (
      nairobiNow(this.cfg).diff(updatedAt, 'minutes').minutes <
      this.cfg.draftTtlMinutes
    );
  }

  private async loadClinics(): Promise<BotClinic[]> {
    const [clinics, procedures] = await Promise.all([
      this.prisma.clinic.findMany({
        where: { status: 'APPROVED' },
        select: {
          id: true,
          name: true,
          physicalLocation: true,
          subCounty: true,
          operatingHours: true,
          whatsappNumber: true,
        },
        orderBy: { name: 'asc' },
      }),
      this.prisma.procedure.findMany({
        where: { isActive: true },
        select: { name: true },
        orderBy: { name: 'asc' },
      }),
    ]);
    const services = procedures.map((p) => p.name);
    return clinics.map((c) => ({ id: c.id, name: c.name, services }));
  }

  async handleDraftTurn(
    userMessage: string,
    senderPhone: string,
    userId: string,
  ): Promise<{ reply: string; triageFlag: boolean }> {
    const draft = await this.prisma.botBookingDraft.upsert({
      where: { memberId: userId },
      update: {},
      create: { memberId: userId, language: 'en' },
    });
    const lang = (draft.language ?? 'en') as BookingLang;

    if (
      draft.status === 'AWAITING_CONFIRMATION' &&
      /\b(?:is|are|was|were|has|have|did)\b.{0,50}\b(?:appointment|booking|slot)\b.{0,40}\b(?:confirm(?:ed)?|booked|saved)\b|\\b(?:confirm(?:ed)?|booked|saved)\\b.{0,40}\\b(?:appointment|booking|slot)\\b/i.test(
        userMessage,
      )
    ) {
      return {
        reply: t(BOOKING_AWAITING_CONFIRMATION, lang),
        triageFlag: false,
      };
    }

    const [clinics, recentLogs] = await Promise.all([
      this.loadClinics(),
      this.prisma.botMessageLog.findMany({
        where: { memberId: userId },
        orderBy: { createdAt: 'desc' },
        take: 4,
      }),
    ]);

    const clinicContext = clinics.length
      ? clinics
          .map(
            (c) =>
              `- ID: ${c.id} | Name: ${c.name} | Services: ${c.services.join(', ')}`,
          )
          .join('\n')
      : 'No specific clinics configured — use "Dr. Papi Dental Clinic" as default.';

    const history = recentLogs
      .reverse()
      .map(
        (l) =>
          `${l.role === 'assistant' ? 'Assistant' : 'Patient'}: ${l.content}`,
      )
      .join('\n');

    const dateAnchors = anchors(this.cfg);
    const draftSnapshot = JSON.stringify(
      {
        service: draft.service,
        clinicId: draft.clinicId,
        date: draft.date,
        time: draft.time,
        clientName: draft.clientName,
        status: draft.status,
      },
      null,
      2,
    );
    const systemPrompt = [
      BOOKING_EXTRACTION_SYSTEM_PROMPT,
      '\n',
      buildBookingExtractionPrompt({
        ...dateAnchors,
        clinicContext,
        currentDraft: draftSnapshot,
        recentHistory: history,
      }),
    ].join('');

    let extraction: BookingExtractionResult | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const raw = await this.llmProvider.generateCompletion({
          systemPrompt,
          userPrompt: userMessage,
          responseFormat: 'json',
          operation: 'booking_extraction',
        });
        const parsed: unknown = JSON.parse(this.stripFences(raw));
        const obj = Object.assign(
          new BookingExtractionResult(),
          parsed as Record<string, unknown>,
        );
        const errors = validateSync(obj);
        if (errors.length === 0) {
          extraction = obj;
          break;
        }
        this.logger.warn(
          `Booking extraction validation failed (attempt ${attempt + 1}): ${JSON.stringify(errors)}`,
        );
      } catch (err) {
        this.logger.warn(
          `Booking extraction parse failed (attempt ${attempt + 1}): ${err}`,
        );
      }
    }

    if (!extraction)
      return { reply: t(PARSE_FAILURE, lang), triageFlag: false };
    const triageFlag = !!extraction.triageFlag;

    if (triageFlag) {
      const clinic = clinics[0] ?? null;
      return {
        reply: t(EMERGENCY_GUIDANCE, lang, {
          clinicName: clinic?.name ?? 'Dr. Papi Dental Clinic',
          clinicPhone: 'the nearest clinic',
        }),
        triageFlag: true,
      };
    }

    if (
      extraction.action === 'CANCEL_BOOKING' ||
      (extraction.action === 'DECLINE' && draft.status === 'COLLECTING')
    ) {
      await this.prisma.botBookingDraft.delete({ where: { memberId: userId } });
      return { reply: t(BOOKING_CANCELLED, lang), triageFlag: false };
    }

    if (extraction.action === 'UNRELATED') {
      return { reply: '', triageFlag: false };
    }

    const updates: Partial<{
      service: string;
      clinicId: string | null;
      date: string;
      time: string;
      clientName: string;
      rawDateMentioned: string;
      language: string;
      status: string;
    }> = {};

    if (extraction.language === 'sw' || extraction.language === 'en') {
      updates.language = extraction.language;
    }
    const effectiveLang = (updates.language ??
      draft.language ??
      'en') as BookingLang;

    let resolvedClinic: BotClinic | null = null;
    if (extraction.clinicName) {
      const match = this.fuzzyMatchClinic(extraction.clinicName, clinics);
      if (match) {
        updates.clinicId = match.id;
        resolvedClinic = match;
      } else {
        const clinicList = clinics
          .map((c, i) => `${i + 1}. ${c.name}`)
          .join('\n');
        await this.saveDraft(userId, updates);
        return {
          reply: t(CLINIC_NOT_FOUND, effectiveLang, {
            name: extraction.clinicName,
            clinicList,
          }),
          triageFlag: false,
        };
      }
    } else if (!draft.clinicId && clinics.length === 1) {
      updates.clinicId = clinics[0].id;
      resolvedClinic = clinics[0];
    } else if (draft.clinicId) {
      resolvedClinic = clinics.find((c) => c.id === draft.clinicId) ?? null;
    }

    if (extraction.service) {
      const effectiveClinic =
        resolvedClinic ??
        (draft.clinicId
          ? (clinics.find((c) => c.id === draft.clinicId) ?? null)
          : null);
      if (effectiveClinic && effectiveClinic.services.length > 0) {
        const match = effectiveClinic.services.find(
          (s) =>
            s.toLowerCase().includes(extraction.service!.toLowerCase()) ||
            extraction.service!.toLowerCase().includes(s.toLowerCase()),
        );
        if (match) {
          updates.service = match;
        } else {
          const serviceList = effectiveClinic.services
            .map((s, i) => `${i + 1}. ${s}`)
            .join('\n');
          await this.saveDraft(userId, updates);
          return {
            reply: t(SERVICE_NOT_OFFERED, effectiveLang, {
              service: extraction.service,
              clinic: effectiveClinic.name,
              serviceList,
            }),
            triageFlag: false,
          };
        }
      } else {
        updates.service = extraction.service;
      }
    }

    if (extraction.preferredDate) {
      updates.date = extraction.preferredDate;
      if (extraction.rawDateMentioned)
        updates.rawDateMentioned = extraction.rawDateMentioned;
    }
    if (extraction.preferredTime) {
      updates.time = extraction.preferredTime;
      if (draft.status === 'AWAITING_CONFIRMATION')
        updates.status = 'COLLECTING';
    }
    if (extraction.preferredDate && draft.status === 'AWAITING_CONFIRMATION') {
      updates.status = 'COLLECTING';
    }

    const mergedDate = updates.date ?? draft.date;
    const mergedTime = updates.time ?? draft.time;

    if (mergedDate && mergedTime) {
      const now = nairobiNow(this.cfg);
      const validation = validateSlot(mergedDate, mergedTime, now, this.cfg);
      if (validation !== 'OK') {
        await this.saveDraft(userId, updates);
        const reply = this.buildSlotError(
          validation,
          mergedDate,
          mergedTime,
          effectiveLang,
        );
        return { reply, triageFlag: false };
      }
    }

    if (extraction.clientName) {
      updates.clientName = extraction.clientName;
      await this.prisma.member.update({
        where: { id: userId },
        data: { fullName: extraction.clientName },
      });
    }

    await this.saveDraft(userId, updates);

    const updatedDraft = await this.prisma.botBookingDraft.findUnique({
      where: { memberId: userId },
    });
    if (!updatedDraft)
      return { reply: t(PARSE_FAILURE, effectiveLang), triageFlag: false };

    if (
      extraction.action === 'CONFIRM' &&
      updatedDraft.status === 'AWAITING_CONFIRMATION'
    ) {
      return this.finalizeBooking(
        updatedDraft,
        senderPhone,
        effectiveLang,
        clinics,
      );
    }

    const missing = this.collectMissingFields(updatedDraft);
    if (missing.length > 0) {
      const questions = missing
        .slice(0, 2)
        .map((f) => this.askForField(f, effectiveLang))
        .join('\n');
      return { reply: questions, triageFlag: false };
    }

    await this.prisma.botBookingDraft.update({
      where: { memberId: userId },
      data: { status: 'AWAITING_CONFIRMATION' },
    });

    const resolvedClinicName =
      clinics.find((c) => c.id === updatedDraft.clinicId)?.name ??
      'Dr. Papi Dental Clinic';
    return {
      reply: t(READ_BACK, effectiveLang, {
        service: updatedDraft.service!,
        date: this.formatDate(updatedDraft.date!, effectiveLang),
        time: this.format24hTime(updatedDraft.time!),
        clinic: resolvedClinicName,
        name: updatedDraft.clientName!,
      }),
      triageFlag: false,
    };
  }

  private async finalizeBooking(
    draft: {
      memberId: string;
      clinicId: string | null;
      service: string | null;
      date: string | null;
      time: string | null;
      clientName: string | null;
      rawDateMentioned: string | null;
    },
    senderPhone: string,
    lang: BookingLang,
    clinics: BotClinic[],
  ): Promise<{ reply: string; triageFlag: boolean }> {
    const scheduledAt = toScheduledAt(draft.date!, draft.time!, this.cfg);
    const clinic = clinics.find((c) => c.id === draft.clinicId) ?? null;

    try {
      const appointment = await this.prisma.$transaction(async (tx) => {
        if (draft.clinicId) {
          const conflict = await tx.appointment.findFirst({
            where: {
              clinicId: draft.clinicId,
              scheduledAt,
              status: {
                in: [AppointmentStatus.BOOKED, AppointmentStatus.RESCHEDULED],
              },
            },
          });
          if (conflict) throw new Error('SLOT_CONFLICT');
        }
        const appt = await tx.appointment.create({
          data: {
            memberId: draft.memberId,
            clinicId: draft.clinicId ?? '',
            scheduledAt,
            intakeReason: draft.service ?? 'General consultation',
            hasConsent: true,
            memberNotes: draft.rawDateMentioned
              ? `Bot booking (phone ${senderPhone}) | Raw date: "${draft.rawDateMentioned}"`
              : `Bot booking (phone ${senderPhone})`,
            events: {
              create: {
                type: 'BOOKED',
                actor: AppointmentActor.SYSTEM,
                actorId: draft.memberId,
                toScheduledAt: scheduledAt,
              },
            },
          },
        });
        await tx.botBookingDraft.delete({
          where: { memberId: draft.memberId },
        });
        return appt;
      });

      return {
        reply: t(BOOKING_CONFIRMED, lang, {
          name: draft.clientName ?? 'there',
          service: draft.service ?? '',
          date: this.formatDate(draft.date!, lang),
          time: this.format24hTime(draft.time!),
          clinic: clinic?.name ?? appointment.clinicId,
          ref: appointment.id.slice(0, 8).toUpperCase(),
        }),
        triageFlag: false,
      };
    } catch (err: unknown) {
      const isConflict =
        (err instanceof Error && err.message === 'SLOT_CONFLICT') ||
        (typeof err === 'object' &&
          err !== null &&
          'code' in err &&
          (err as { code: string }).code === 'P2002');
      if (isConflict) {
        await this.prisma.botBookingDraft.update({
          where: { memberId: draft.memberId },
          data: { status: 'COLLECTING', time: null },
        });
        const alternatives = await this.nextFreeSlots(
          draft.clinicId,
          scheduledAt,
          3,
        );
        const altText = alternatives
          .map(
            (d) =>
              `• ${this.format24hTime(d.toFormat('HH:mm'))} on ${this.formatDate(d.toISODate()!, lang)}`,
          )
          .join('\n');
        return {
          reply: t(SLOT_TAKEN, lang, { alternatives: altText }),
          triageFlag: false,
        };
      }
      this.logger.error(
        `Booking finalization error: ${err instanceof Error ? err.message : String(err)}`,
      );
      return { reply: t(PARSE_FAILURE, lang), triageFlag: false };
    }
  }

  async nextFreeSlots(
    clinicId: string | null,
    fromUtc: Date,
    count: number = 3,
  ): Promise<DateTime[]> {
    const from = DateTime.fromJSDate(fromUtc).setZone(this.cfg.timezone);
    const slots = daySlots(this.cfg);
    const results: DateTime[] = [];
    for (
      let dayOffset = 0;
      dayOffset < 14 && results.length < count;
      dayOffset++
    ) {
      const day = from.plus({ days: dayOffset });
      const dayIso = day.toISODate()!;
      if (!this.cfg.openDays.includes(day.weekday)) continue;
      for (const slot of slots) {
        if (results.length >= count) break;
        const candidate = toScheduledAt(dayIso, slot, this.cfg);
        const candidateDt = DateTime.fromJSDate(candidate);
        if (candidateDt <= DateTime.fromJSDate(fromUtc)) continue;
        if (clinicId) {
          const conflict = await this.prisma.appointment.findFirst({
            where: {
              clinicId,
              scheduledAt: candidate,
              status: {
                in: [AppointmentStatus.BOOKED, AppointmentStatus.RESCHEDULED],
              },
            },
          });
          if (conflict) continue;
        }
        results.push(DateTime.fromJSDate(candidate).setZone(this.cfg.timezone));
      }
    }
    return results;
  }

  async bookFromTranscript(
    transcript: string,
    senderPhone: string = '+254712345678',
  ): Promise<BookingResult> {
    // Resolve/create Member stub by phone (bot identity bridge).
    const digits = senderPhone.replace(/[^\d]/g, '');
    const e164 = digits.startsWith('0')
      ? '+254' + digits.slice(1)
      : '+' + digits;
    let member = await this.prisma.member.findUnique({
      where: { phoneNumber: e164 },
    });
    if (!member) {
      member = await this.prisma.member.create({
        data: {
          phoneNumber: e164,
          fullName: `User ${e164.slice(-4)}`,
          isVerified: false,
        },
      });
    }
    const { reply, triageFlag } = await this.handleDraftTurn(
      transcript,
      senderPhone,
      member.id,
    );
    return { success: !triageFlag, confirmationMessage: reply };
  }

  private async saveDraft(
    userId: string,
    data: Partial<{
      service: string;
      clinicId: string | null;
      date: string;
      time: string;
      clientName: string;
      rawDateMentioned: string;
      language: string;
      status: string;
    }>,
  ): Promise<void> {
    if (Object.keys(data).length === 0) return;
    await this.prisma.botBookingDraft.update({
      where: { memberId: userId },
      data,
    });
  }

  private collectMissingFields(draft: {
    service: string | null;
    clinicId: string | null;
    date: string | null;
    time: string | null;
    clientName: string | null;
  }): string[] {
    const missing: string[] = [];
    if (!draft.service) missing.push('service');
    if (!draft.clinicId) missing.push('clinic');
    if (!draft.date || !draft.time) missing.push('datetime');
    if (!draft.clientName) missing.push('name');
    return missing;
  }

  private askForField(field: string, lang: BookingLang): string {
    switch (field) {
      case 'service':
        return t(ASK_SERVICE, lang);
      case 'clinic':
        return t(ASK_CLINIC, lang, { clinicList: '' }).split('\n')[0];
      case 'datetime':
        return t(ASK_DATE_TIME, lang);
      case 'name':
        return t(ASK_NAME, lang);
      default:
        return '';
    }
  }

  private buildSlotError(
    validation: string,
    dateIso: string,
    timeHHmm: string,
    lang: BookingLang,
  ): string {
    switch (validation) {
      case 'PAST':
        return t(SLOT_PAST, lang);
      case 'CLOSED_DAY': {
        const dt = DateTime.fromISO(dateIso, { zone: this.cfg.timezone });
        return t(SLOT_CLOSED_DAY, lang, {
          dayName: dt.weekdayLong ?? dateIso,
          openDays: openDayNames(this.cfg),
        });
      }
      case 'OUTSIDE_HOURS':
        return t(SLOT_OUTSIDE_HOURS, lang, {
          openTime: this.cfg.openTime,
          closeTime: this.cfg.closeTime,
        });
      case 'NOT_ON_SLOT_BOUNDARY': {
        const nearest = snapToSlot(timeHHmm, this.cfg);
        return t(SLOT_NOT_ON_BOUNDARY, lang, {
          slotMinutes: String(this.cfg.slotMinutes),
          nearestSlot: nearest,
        });
      }
      default:
        return t(SLOT_PAST, lang);
    }
  }

  private fuzzyMatchClinic(
    name: string,
    clinics: BotClinic[],
  ): BotClinic | null {
    const lower = name.toLowerCase();
    const exact = clinics.find((c) => c.name.toLowerCase() === lower);
    if (exact) return exact;
    const contains = clinics.filter(
      (c) =>
        c.name.toLowerCase().includes(lower) ||
        lower.includes(c.name.toLowerCase()),
    );
    if (contains.length === 1) return contains[0];
    return null;
  }

  private formatDate(dateIso: string, lang: BookingLang): string {
    const dt = DateTime.fromISO(dateIso, { zone: this.cfg.timezone });
    if (lang === 'sw') return dt.setLocale('sw').toFormat('cccc, d LLLL yyyy');
    return dt.toFormat('cccc, d MMMM yyyy');
  }

  private format24hTime(timeHHmm: string): string {
    const [h, m] = timeHHmm.split(':').map(Number);
    const dt = DateTime.now().set({ hour: h, minute: m });
    return dt.toFormat('h:mm a');
  }

  private stripFences(raw: string): string {
    let clean = raw.trim();
    if (clean.startsWith('```json')) {
      clean = clean.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    } else if (clean.startsWith('```')) {
      clean = clean.replace(/^```\s*/, '').replace(/\s*```$/, '');
    }
    return clean;
  }
}
