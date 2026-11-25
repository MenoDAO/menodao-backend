import { isDirectConsultationRequest } from '../intents/intent-fallback';
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
import { SmsService } from '../../sms/sms.service';
import { CalendarSyncService } from '../../calendar/calendar-sync.service';
import { AppointmentActor, AppointmentStatus, CareEventType } from '@prisma/client';
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
  openDayNames,
  snapToSlot,
} from './booking-time.util';
import type { SlotValidationResult } from './booking-time.util';
import { parseBookingDateTime } from './swahili-datetime.util';
import {
  BookingLang,
  t,
  ASK_SERVICE,
  ASK_DOCTOR,
  ASK_DATE_TIME,
  ASK_NAME,
  ASK_CLINIC,
  CLINIC_NOT_FOUND,
  SERVICE_NOT_OFFERED,
  BOOKING_UNAVAILABLE,
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

type BotDoctor = {
  id: string;
  name: string;
  title?: string | null;
  specialty?: string | null;
  isActive?: boolean;
  clinicId?: string | null;
  consultationMinutes: number;
  bufferMinutes: number;
  availability: Array<{
    dayOfWeek: number;
    startTime: string;
    endTime: string;
    isActive: boolean;
  }>;
};

type BotClinic = {
  id: string;
  name: string;
  services: string[];
  doctors: BotDoctor[];
  operatingSchedule: Array<{
    dayOfWeek: number;
    openTime: string | null;
    closeTime: string | null;
    isClosed: boolean;
  }>;
};

@Injectable()
export class BookingService {
  private readonly logger = new Logger(BookingService.name);
  private readonly cfg: BookingConfig;
  private procedureDurations = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    @Inject(LLM_PROVIDER) private readonly llmProvider: ILlmProvider,
    private readonly smsService: SmsService,
    private readonly calendarSync: CalendarSyncService,
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
        this.configService.get<string>('BOT_BOOKING_TIMEZONE') ?? DEFAULT_TZ,
      openDays: parseOpenDays(
        this.configService.get<string>('BOT_BOOKING_OPEN_DAYS'),
      ),
      openTime:
        this.configService.get<string>('BOT_BOOKING_OPEN_TIME') ??
        DEFAULT_OPEN_TIME,
      closeTime:
        this.configService.get<string>('BOT_BOOKING_CLOSE_TIME') ??
        DEFAULT_CLOSE_TIME,
      slotMinutes: parseInt(
        this.configService.get<string>('BOT_BOOKING_SLOT_MINUTES') ??
          String(DEFAULT_SLOT_MINUTES),
        10,
      ),
      draftTtlMinutes: parseInt(
        this.configService.get<string>('BOT_BOOKING_DRAFT_TTL_MINUTES') ?? '30',
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

  private getServiceDurationMinutes(service?: string | null): number {
    if (!service) return this.cfg.slotMinutes;
    const key = service.toLowerCase();
    const direct = this.procedureDurations.get(key);
    if (direct) return direct;
    for (const [name, mins] of this.procedureDurations.entries()) {
      if (key.includes(name) || name.includes(key)) return mins;
    }
    return this.cfg.slotMinutes;
  }

  /** JS day (0=Sun..6=Sat) -> Luxon ISO weekday (1=Mon..7=Sun). */
  private jsDayToIso(day: number): number {
    return day === 0 ? 7 : day;
  }

  private getClinicDayWindows(
    clinic: BotClinic | null | undefined,
    isoWeekday: number,
    doctorId?: string | null,
  ): Array<{ open: string; close: string }> {
    // Doctor availability takes precedence when any doctor has schedule for the day.
    const doctors = doctorId
      ? (clinic?.doctors ?? []).filter((d) => d.id === doctorId)
      : (clinic?.doctors ?? []);
    if (doctors.length > 0) {
      const jsDay = isoWeekday === 7 ? 0 : isoWeekday;
      const windows: Array<{ open: string; close: string }> = [];
      for (const doc of doctors) {
        for (const a of doc.availability) {
          if (a.isActive && a.dayOfWeek === jsDay) {
            windows.push({ open: a.startTime, close: a.endTime });
          }
        }
      }
      if (windows.length > 0) return windows;
    }
    // Clinic operating schedule
    const jsDay = isoWeekday === 7 ? 0 : isoWeekday;
    const row = clinic?.operatingSchedule?.find((r) => r.dayOfWeek === jsDay);
    if (row) {
      if (row.isClosed || !row.openTime || !row.closeTime) return [];
      return [{ open: row.openTime, close: row.closeTime }];
    }
    // Kenyan medic default: Mon-Sat 08:00-17:00, Sun closed
    if (isoWeekday === 7) return [];
    return [{ open: this.cfg.openTime, close: this.cfg.closeTime }];
  }

  private isClinicOpenOnDay(
    clinic: BotClinic | null | undefined,
    isoWeekday: number,
    doctorId?: string | null,
  ): boolean {
    return this.getClinicDayWindows(clinic, isoWeekday, doctorId).length > 0;
  }

  private validateSlotForClinic(
    dateIso: string,
    timeHHmm: string,
    now: DateTime,
    clinic: BotClinic | null | undefined,
    doctorId?: string | null,
  ): SlotValidationResult {
    const [hour, minute] = timeHHmm.split(':').map(Number);
    const candidate = DateTime.fromISO(dateIso, {
      zone: this.cfg.timezone,
    }).set({
      hour,
      minute,
      second: 0,
      millisecond: 0,
    });
    if (candidate <= now) return 'PAST';

    const weekday = candidate.weekday;
    const windows = this.getClinicDayWindows(clinic, weekday, doctorId);
    if (windows.length === 0) return 'CLOSED_DAY';

    const slotEndMinutes = hour * 60 + minute + this.cfg.slotMinutes;
    const startMinutes = hour * 60 + minute;
    const fitsWindow = windows.some((w) => {
      const [openH, openM] = w.open.split(':').map(Number);
      const [closeH, closeM] = w.close.split(':').map(Number);
      const openMinutes = openH * 60 + openM;
      const closeMinutes = closeH * 60 + closeM;
      return startMinutes >= openMinutes && slotEndMinutes <= closeMinutes;
    });
    if (!fitsWindow) return 'OUTSIDE_HOURS';

    // Boundary check: align to earliest opening window
    const [refH, refM] = windows[0].open.split(':').map(Number);
    const refOpen = refH * 60 + refM;
    const minutesSinceOpen = startMinutes - refOpen;
    if (minutesSinceOpen % this.cfg.slotMinutes !== 0) {
      return 'NOT_ON_SLOT_BOUNDARY';
    }
    return 'OK';
  }

  private getClinicDaySlots(
    clinic: BotClinic | null | undefined,
    isoWeekday: number,
    doctorId?: string | null,
  ): string[] {
    const windows = this.getClinicDayWindows(clinic, isoWeekday, doctorId);
    const out: string[] = [];
    for (const w of windows) {
      const [openH, openM] = w.open.split(':').map(Number);
      const [closeH, closeM] = w.close.split(':').map(Number);
      const openMinutes = openH * 60 + openM;
      const closeMinutes = closeH * 60 + closeM;
      for (
        let m = openMinutes;
        m + this.cfg.slotMinutes <= closeMinutes;
        m += this.cfg.slotMinutes
      ) {
        const hh = String(Math.floor(m / 60)).padStart(2, '0');
        const mm = String(m % 60).padStart(2, '0');
        const slot = `${hh}:${mm}`;
        if (!out.includes(slot)) out.push(slot);
      }
    }
    return out;
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
          doctors: {
            where: { isActive: true },
            select: {
              id: true,
              name: true,
              title: true,
              specialty: true,
              isActive: true,
              consultationMinutes: true,
              bufferMinutes: true,
              availability: {
                where: { isActive: true },
                select: {
                  dayOfWeek: true,
                  startTime: true,
                  endTime: true,
                  isActive: true,
                },
              },
            },
            orderBy: { name: 'asc' },
          },
          operatingSchedule: {
            select: {
              dayOfWeek: true,
              openTime: true,
              closeTime: true,
              isClosed: true,
            },
          },
        },
        orderBy: { name: 'asc' },
      }),
      this.prisma.procedure.findMany({
        where: { isActive: true },
        select: { name: true, durationMinutes: true },
        orderBy: { name: 'asc' },
      }),
    ]);
    const services = procedures.map((p) => p.name);
    this.procedureDurations = new Map(
      procedures.map((p) => [p.name.toLowerCase(), p.durationMinutes ?? 15]),
    );
    return clinics.map((c) => ({
      id: c.id,
      name: c.name,
      services,
      doctors: c.doctors.map((d) => ({
        id: d.id,
        name: d.name,
        title: d.title,
        specialty: d.specialty,
        isActive: d.isActive,
        consultationMinutes: d.consultationMinutes ?? 15,
        bufferMinutes: d.bufferMinutes ?? 5,
        availability: d.availability,
      })),
      operatingSchedule: c.operatingSchedule,
    }));
  }

  async handleDraftTurn(
    userMessage: string,
    senderPhone: string,
    userId: string,
    preferredLanguage?: 'en' | 'sw',
    memberName?: string | null,
  ): Promise<{ reply: string; triageFlag: boolean }> {
    const draft = await this.prisma.$transaction(async (tx) => {
      const bookingDraft = await tx.botBookingDraft.upsert({
        where: { memberId: userId },
        update: {},
        create: {
          memberId: userId,
          language: preferredLanguage ?? 'en',
          clientName: memberName?.trim() || undefined,
        },
      });
      await tx.careEvent.upsert({
        where: { id: bookingDraft.id },
        update: {},
        create: {
          id: bookingDraft.id,
          type: CareEventType.APPOINTMENT_REQUESTED,
          memberId: userId,
          source: 'bot-booking-draft',
          occurredAt: new Date(),
        },
      });
      return bookingDraft;
    });
    const lang = (draft.language ?? preferredLanguage ?? 'en') as BookingLang;

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
      : 'No specific clinics configured. Use "Dr. Papi Dental Clinic" as default.';

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

    const startingConsultation = !draft.service && isDirectConsultationRequest(userMessage);
    let extraction: BookingExtractionResult | null = startingConsultation
      ? Object.assign(new BookingExtractionResult(), {
          action: 'PROVIDE_DETAILS',
          confidence: 1,
        })
      : null;
    for (let attempt = 0; !extraction && attempt < 2; attempt++) {
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
      await this.prisma.$transaction([
        this.prisma.botBookingDraft.delete({ where: { id: draft.id } }),
        this.prisma.careEvent.updateMany({
          where: { id: draft.id, source: 'bot-booking-draft' },
          data: { metadata: { cancelled: true } },
        }),
      ]);
      return { reply: t(BOOKING_CANCELLED, lang), triageFlag: false };
    }

    if (extraction.action === 'UNRELATED') {
      return { reply: '', triageFlag: false };
    }

    const updates: Partial<{
      service: string;
      clinicId: string | null;
      doctorId: string | null;
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

    // Doctor selection: when the clinic has several doctors, accept the reply
    // to ASK_DOCTOR as either its 1-based number or a doctor-name match.
    // Single-doctor clinics are auto-assigned; otherwise the missing-fields
    // flow asks the member which doctor they prefer.
    if (
      resolvedClinic &&
      resolvedClinic.doctors.length > 0 &&
      !draft.doctorId &&
      !updates.doctorId
    ) {
      const selected = this.parseDoctorSelection(
        userMessage,
        resolvedClinic.doctors,
      );
      if (selected) {
        updates.doctorId = selected.id;
      } else if (resolvedClinic.doctors.length === 1) {
        updates.doctorId = resolvedClinic.doctors[0].id;
      }
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
          await this.saveDraft(userId, updates);
          return {
            reply: t(SERVICE_NOT_OFFERED, effectiveLang, {
              service: extraction.service,
              clinic: effectiveClinic.name,
            }),
            triageFlag: false,
          };
        }
      } else {
        updates.service = extraction.service;
      }
    }

    if (!updates.service && !draft.service && (resolvedClinic || startingConsultation)) {
      const consultation = resolvedClinic?.services.find((service) => /\bconsultation\b/i.test(service));
      if (consultation) updates.service = consultation;
      else if (startingConsultation) updates.service = 'General consultation';
    }

    const parsedDateTime = parseBookingDateTime(
      userMessage,
      nairobiNow(this.cfg),
      this.cfg.timezone,
    );

    const extractionDateIsValid =
      !!extraction.preferredDate &&
      /^\d{4}-\d{2}-\d{2}$/.test(extraction.preferredDate);
    const extractionTimeIsValid =
      !!extraction.preferredTime &&
      /^\d{2}:\d{2}$/.test(extraction.preferredTime);

    if (extractionDateIsValid) {
      updates.date = extraction.preferredDate!;
      if (extraction.rawDateMentioned)
        updates.rawDateMentioned = extraction.rawDateMentioned;
    } else if (parsedDateTime.dateIso) {
      updates.date = parsedDateTime.dateIso;
      updates.rawDateMentioned = parsedDateTime.rawDate ?? userMessage;
    }

    if (extractionTimeIsValid) {
      updates.time = extraction.preferredTime!;
      if (draft.status === 'AWAITING_CONFIRMATION')
        updates.status = 'COLLECTING';
    } else if (parsedDateTime.timeHHmm) {
      updates.time = parsedDateTime.timeHHmm;
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
      const clinicForValidation =
        resolvedClinic ??
        clinics.find((c) => c.id === (updates.clinicId ?? draft.clinicId)) ??
        null;
      const validation = this.validateSlotForClinic(
        mergedDate,
        mergedTime,
        now,
        clinicForValidation,
        updates.doctorId ?? draft.doctorId ?? null,
      );
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
      await this.prisma.member.updateMany({
        where: { id: userId, fullName: null },
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

    const meaningfulUpdate =
      !!updates.service ||
      !!updates.clinicId ||
      !!updates.doctorId ||
      !!updates.date ||
      !!updates.time ||
      !!updates.clientName ||
      updates.status === 'COLLECTING';
    if (this.isAvailabilityQuestion(userMessage) && !meaningfulUpdate) {
      return {
        reply: await this.describeAvailability(userMessage, effectiveLang, {
          doctorId: updatedDraft.doctorId,
          service: updatedDraft.service,
        }),
        triageFlag: false,
      };
    }

    const missing = this.collectMissingFields(updatedDraft, clinics);
    if (missing.length > 0) {
      if (missing.includes('clinic') && clinics.length === 0) {
        return {
          reply: t(BOOKING_UNAVAILABLE, effectiveLang),
          triageFlag: false,
        };
      }
      const field = missing[0];
      const reply = this.askForField(
        field,
        effectiveLang,
        updatedDraft,
        clinics,
      );
      const introduction = startingConsultation && field !== 'service'
        ? effectiveLang === 'sw'
          ? 'Ndiyo, naweza kukusaidia kupanga uchunguzi na daktari wa meno. '
          : 'Of course. I can help arrange a consultation with a dentist. '
        : '';
      return { reply: introduction + reply, triageFlag: false };
    }

    await this.prisma.botBookingDraft.update({
      where: { memberId: userId },
      data: { status: 'AWAITING_CONFIRMATION' },
    });

    const resolvedClinicName =
      clinics.find((c) => c.id === updatedDraft.clinicId)?.name ??
      'Dr. Papi Dental Clinic';
    const membershipNote = await this.membershipBookingNote(
      userId,
      updatedDraft.service,
      effectiveLang,
    ).catch(() => '');
    return {
      reply: t(READ_BACK, effectiveLang, {
        service: updatedDraft.service ?? '',
        date: this.formatDate(updatedDraft.date!, effectiveLang),
        time: this.format24hTime(updatedDraft.time!),
        clinic: resolvedClinicName,
        name: updatedDraft.clientName ?? memberName ?? 'there',
        membershipNote,
        doctor:
          updatedDraft.doctorId &&
          clinics
            .find((c) => c.id === updatedDraft.clinicId)
            ?.doctors.some((d) => d.id === updatedDraft.doctorId)
            ? clinics
                .find((c) => c.id === updatedDraft.clinicId)!
                .doctors.find((d) => d.id === updatedDraft.doctorId)!.name
            : '',
      }),
      triageFlag: false,
    };
  }

  private async membershipBookingNote(
    memberId: string,
    service: string | null,
    language: BookingLang,
  ): Promise<string> {
    if (!service || !/\bconsultation\b/i.test(service)) return '';
    const [membership, procedure] = await Promise.all([
      this.prisma.subscription.findUnique({
        where: { memberId },
        select: { isActive: true, endDate: true },
      }),
      this.prisma.procedure.findFirst({
        where: { name: { equals: service, mode: 'insensitive' }, isActive: true },
        select: { allowedTiers: true },
      }),
    ]);
    if (membership?.isActive && (!membership.endDate || membership.endDate > new Date())) return '';
    const tiers = ['BRONZE', 'SILVER', 'GOLD'].filter(
      (tier) => Array.isArray(procedure?.allowedTiers) && procedure.allowedTiers.includes(tier),
    ).map((tier) => `Meno${tier[0]}${tier.slice(1).toLowerCase()}`);
    if (!tiers.length) return '';

    const plans = this.humanizeList(tiers, language);
    return language === 'sw'
      ? `${plans} inaweza kusaidia kulipia uchunguzi wa daktari kulingana na masharti ya kifurushi. Andika “membership options” kuona bei. Unaweza kuthibitisha miadi bila uanachama.\n\n`
      : `${plans} can help cover this consultation so the dentist can assess what’s bothering you, subject to plan terms. Type “membership options” to see prices. You can confirm your visit without cover.\n\n`;
  }

  private async finalizeBooking(
    draft: {
      id: string;
      memberId: string;
      clinicId: string | null;
      doctorId: string | null;
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
    const doctorId = draft.doctorId;
    const durationMinutes = this.getServiceDurationMinutes(draft.service);

    try {
      const appointment = await this.prisma.$transaction(async (tx) => {
        // clinicId is mandatory on Appointment; the draft state machine
        // requires it before confirmation, so this is a defensive guard.
        if (!draft.clinicId) throw new Error('MISSING_CLINIC');

        // Match AppointmentsService capacity semantics: count overlapping
        // appointments against the clinic's active chairs, not "any booking
        // blocks the slot" (clinics can run several chairs in parallel).
        const clinicRow = await tx.clinic.findUnique({
          where: { id: draft.clinicId },
          select: { activeDentalChairs: true },
        });
        if (!clinicRow) throw new Error('MISSING_CLINIC');
        const chairs = Math.max(clinicRow.activeDentalChairs || 1, 1);
        const windowStart = new Date(
          scheduledAt.getTime() - this.cfg.slotMinutes * 60_000,
        );
        const windowEnd = new Date(
          scheduledAt.getTime() + this.cfg.slotMinutes * 60_000,
        );
        const nearby = await tx.appointment.findMany({
          where: {
            clinicId: draft.clinicId,
            scheduledAt: { gte: windowStart, lt: windowEnd },
            status: {
              in: [AppointmentStatus.BOOKED, AppointmentStatus.RESCHEDULED],
            },
          },
          select: { scheduledAt: true, durationMinutes: true },
        });
        const taken = nearby.filter((row) =>
          this.overlaps(
            scheduledAt,
            durationMinutes,
            row.scheduledAt,
            row.durationMinutes,
          ),
        ).length;
        if (doctorId) {
          const doctorConflict = nearby.some(
            (row) =>
              scheduledAt.getTime() <
                new Date(
                  row.scheduledAt.getTime() + row.durationMinutes * 60_000,
                ).getTime() &&
              new Date(row.scheduledAt).getTime() <
                scheduledAt.getTime() + durationMinutes * 60_000,
          );
          if (doctorConflict) throw new Error('SLOT_CONFLICT');
        } else if (taken >= chairs) {
          throw new Error('SLOT_CONFLICT');
        }

        const appt = await tx.appointment.create({
          data: {
            memberId: draft.memberId,
            clinicId: draft.clinicId,
            doctorId: doctorId ?? undefined,
            scheduledAt,
            durationMinutes,
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
        await tx.botBookingDraft.delete({ where: { id: draft.id } });
        await tx.careEvent.updateMany({
          where: { id: draft.id, source: 'bot-booking-draft' },
          data: { metadata: { appointmentId: appt.id } },
        });

        return appt;
      });

      // Best-effort push to the doctor's/clinic's connected external calendar.
      try {
        await this.calendarSync.createAppointmentEvent({
          id: appointment.id,
          scheduledAt,
          durationMinutes,
          doctorId,
          clinicId: draft.clinicId!,
          externalCalendarProvider: appointment.externalCalendarProvider,
        });
      } catch (error) {
        this.logger.warn(
          `External calendar push failed for booking ${appointment.id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }

      // Notify clinic staff (doctor/physician) about the new booking —
      // general info only (member name + slot), no clinical details.
      await this.notifyStaffBooking(
        draft.clinicId,
        draft.memberId,
        draft.service ?? null,
        scheduledAt,
      );

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
          doctorId,
          durationMinutes,
        );
        const altText = this.humanizeList(
          alternatives.map((d) => {
            const time = this.format24hTime(d.toFormat('HH:mm'));
            const date = this.formatDate(d.toISODate()!, lang);
            return lang === 'sw' ? `${time}, ${date}` : `${time} on ${date}`;
          }),
          lang,
        );
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

  /**
   * Notify the clinic staff (doctor/physician) that a new booking was made
   * through the bot. Sends general information only (member name + slot) — no
   * clinical/treatment details leak into staff channels.
   */
  private async notifyStaffBooking(
    clinicId: string | null,
    memberId: string,
    service: string | null,
    scheduledAt: Date,
  ): Promise<void> {
    if (!clinicId) return;
    const clinic = await this.prisma.clinic.findUnique({
      where: { id: clinicId },
      select: { id: true, name: true, ownerPhone: true },
    });
    const member = await this.prisma.member.findUnique({
      where: { id: memberId },
      select: { fullName: true },
    });
    if (!clinic?.ownerPhone) return;
    const memberName = member?.fullName || 'A member';
    const when = new Intl.DateTimeFormat('en-KE', {
      timeZone: 'Africa/Nairobi',
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).format(scheduledAt);
    const message =
      `MenoDAO: New booking for ${memberName}` +
      (service ? `, ${service}` : '') +
      ` at ${clinic.name} on ${when}. Reply or open the staff area to review.`;
    const smsResult = await this.smsService.sendSms(clinic.ownerPhone, message);
    if (!smsResult.success) {
      this.logger.warn(
        `Staff booking notification SMS failed for ${clinic.ownerPhone}: ${smsResult.error}`,
      );
    }
  }

  /**
   * Answer an availability question (e.g. "what open slots are available at
   * Mikindani clinic this week?") without creating or advancing a booking draft.
   */
  async describeAvailability(
    message: string,
    lang: BookingLang = 'en',
    options: { doctorId?: string | null; service?: string | null } = {},
  ): Promise<string> {
    const clinics = await this.loadClinics();
    if (clinics.length === 0) {
      return t(BOOKING_UNAVAILABLE, lang);
    }

    const lower = message.toLowerCase();
    const clinic =
      clinics.find((c) => lower.includes(c.name.toLowerCase())) ??
      this.fuzzyMatchClinic(
        clinics.find((c) =>
          c.name
            .toLowerCase()
            .split(/\s+/)
            .some((tok) => tok.length > 3 && lower.includes(tok)),
        )?.name ?? '',
        clinics,
      ) ??
      (clinics.length === 1 ? clinics[0] : null);

    const now = nairobiNow(this.cfg);
    const rangeDays = this.inferAvailabilityRangeDays(lower);
    const start = now.startOf('day');
    const lines: string[] = [];

    const targetClinics = clinic ? [clinic] : clinics.slice(0, 3);
    for (const c of targetClinics) {
      const header =
        lang === 'sw'
          ? `*${c.name}*: nafasi zinazopatikana:`
          : `*${c.name}*: available slots:`;
      lines.push(header);
      let found = 0;
      const slotDuration = options.service
        ? this.getServiceDurationMinutes(options.service)
        : this.cfg.slotMinutes;
      for (
        let dayOffset = 0;
        dayOffset < rangeDays && found < 12;
        dayOffset++
      ) {
        const day = start.plus({ days: dayOffset });
        const daySlotsList = this.getClinicDaySlots(
          c,
          day.weekday,
          options.doctorId ?? null,
        );
        if (daySlotsList.length === 0) continue;
        const dayIso = day.toISODate()!;
        const free: string[] = [];
        for (const slot of daySlotsList) {
          const candidate = toScheduledAt(dayIso, slot, this.cfg);
          if (DateTime.fromJSDate(candidate) <= now) continue;
          const taken = await this.isSlotTaken(
            c.id,
            candidate,
            options.doctorId ?? null,
            slotDuration,
          );
          if (!taken) free.push(this.format24hTime(slot));
          if (free.length >= 6) break;
        }
        if (free.length > 0) {
          const dayLabel = this.formatDate(dayIso, lang);
          lines.push(`• ${dayLabel}: ${free.join(', ')}`);
          found += free.length;
        }
      }
      if (found === 0) {
        lines.push(
          lang === 'sw'
            ? '• Hakuna nafasi wazi katika kipindi hiki. Jaribu siku nyingine.'
            : '• No open slots in that window. Try another day or ask me to check further ahead.',
        );
      }
      if (!clinic && targetClinics.length > 1) lines.push('');
    }

    if (!clinic && clinics.length > 1) {
      lines.push(
        lang === 'sw'
          ? 'Taja kliniki (kwa mfano Mikindani au Palm Beach) ili nikupe nafasi maalum.'
          : 'Mention a clinic name (for example Mikindani or Palm Beach) and I can narrow it down for you.',
      );
    } else {
      lines.push(
        lang === 'sw'
          ? 'Ukitaka, niambie siku na saa unayopendelea nami nikuandikie miadi.'
          : 'If you want, tell me the day and time you prefer and I can book it for you.',
      );
    }
    return lines.join('\n').trim();
  }

  private inferAvailabilityRangeDays(lower: string): number {
    if (/\btoday\b|\bleo\b/.test(lower)) return 1;
    if (/\btomorrow\b|\bkesho\b/.test(lower)) return 2;
    if (/\bthis week\b|\bwiki hii\b/.test(lower)) return 7;
    if (/\bnext week\b|\bwki ijayo\b|\bwkijayo\b/.test(lower)) return 14;
    if (/\bweek\b|\bwki\b/.test(lower)) return 7;
    return 7;
  }

  private isAvailabilityQuestion(message: string): boolean {
    const lower = message.toLowerCase();
    const asksAvailability =
      /\b(available|availability|open slots?|free slots?|openings?|when are you open|working hours|office hours|what times?|which slots?|any slots?)\b/.test(
        lower,
      ) ||
      /(nafasi gani|nafasi zipo|kuna nafasi|mnafungua|muda gani)/.test(lower);
    const asksToBook =
      /\b(book|schedule|reserve|sign me up|panga|weka miadi|nataka kuja)\b/.test(
        lower,
      );
    return asksAvailability && !asksToBook;
  }

  private async isSlotTaken(
    clinicId: string,
    scheduledAt: Date,
    doctorId: string | null = null,
    durationMinutes: number = this.cfg.slotMinutes,
  ): Promise<boolean> {
    const start = scheduledAt;
    const end = new Date(scheduledAt.getTime() + durationMinutes * 60_000);
    const windowStart = new Date(start.getTime() - durationMinutes * 60_000);
    const windowEnd = new Date(end.getTime() + durationMinutes * 60_000);

    const internalWhere: {
      clinicId: string;
      scheduledAt: { gte: Date; lt: Date };
      status: { in: AppointmentStatus[] };
      doctorId?: string;
    } = {
      clinicId,
      scheduledAt: { gte: windowStart, lt: windowEnd },
      status: {
        in: [AppointmentStatus.BOOKED, AppointmentStatus.RESCHEDULED],
      },
    };
    if (doctorId) internalWhere.doctorId = doctorId;

    const internal = await this.prisma.appointment.findMany({
      where: internalWhere as never,
      select: { scheduledAt: true, durationMinutes: true },
    });
    const internalOverlap = internal.some(
      (row) =>
        start.getTime() <
          new Date(
            row.scheduledAt.getTime() + row.durationMinutes * 60_000,
          ).getTime() && new Date(row.scheduledAt).getTime() < end.getTime(),
    );

    const externalBusy = doctorId
      ? await this.getCalendarBusy('DOCTOR', doctorId, {
          from: windowStart,
          to: windowEnd,
        })
      : await this.getCalendarBusy('CLINIC', clinicId, {
          from: windowStart,
          to: windowEnd,
        });
    const externalOverlap = externalBusy.some(
      (busy) =>
        start.getTime() < busy.end.getTime() &&
        busy.start.getTime() < end.getTime(),
    );

    if (doctorId) {
      // Single-doctor booking: any overlap (internal or external) blocks the slot.
      return internalOverlap || externalOverlap;
    }

    // Clinic-level booking: keep the chair-capacity semantics, and stay safe
    // when an external calendar already occupies a doctor inside the window.
    const clinic = await this.prisma.clinic.findUnique({
      where: { id: clinicId },
      select: { activeDentalChairs: true },
    });
    const chairs = Math.max(clinic?.activeDentalChairs || 1, 1);
    const internalOverlaps = internal.filter(
      (row) =>
        start.getTime() <
          new Date(
            row.scheduledAt.getTime() + row.durationMinutes * 60_000,
          ).getTime() && new Date(row.scheduledAt).getTime() < end.getTime(),
    ).length;
    if (externalOverlap) return true;
    return internalOverlaps >= chairs;
  }

  private async getCalendarBusy(
    ownerType: 'DOCTOR' | 'CLINIC',
    ownerId: string,
    window: { from: Date; to: Date },
  ): Promise<{ start: Date; end: Date }[]> {
    const busy = await this.calendarSync.getBusyIntervals(ownerType, ownerId, {
      from: window.from,
      to: window.to,
      timeZone: this.cfg.timezone,
    });
    return busy;
  }

  async nextFreeSlots(
    clinicId: string | null,
    fromUtc: Date,
    count: number = 3,
    doctorId: string | null = null,
    durationMinutes: number = this.cfg.slotMinutes,
  ): Promise<DateTime[]> {
    const from = DateTime.fromJSDate(fromUtc).setZone(this.cfg.timezone);
    const results: DateTime[] = [];
    let clinic: BotClinic | null = null;
    if (clinicId) {
      const row = await this.prisma.clinic.findUnique({
        where: { id: clinicId },
        select: {
          id: true,
          name: true,
          activeDentalChairs: true,
          doctors: {
            where: { isActive: true },
            select: {
              id: true,
              name: true,
              title: true,
              specialty: true,
              isActive: true,
              consultationMinutes: true,
              bufferMinutes: true,
              availability: {
                where: { isActive: true },
                select: {
                  dayOfWeek: true,
                  startTime: true,
                  endTime: true,
                  isActive: true,
                },
              },
            },
          },
          operatingSchedule: {
            select: {
              dayOfWeek: true,
              openTime: true,
              closeTime: true,
              isClosed: true,
            },
          },
        },
      });
      if (row) {
        clinic = {
          id: row.id,
          name: row.name,
          services: [],
          doctors: row.doctors,
          operatingSchedule: row.operatingSchedule,
        } as BotClinic;
      }
    }
    for (
      let dayOffset = 0;
      dayOffset < 14 && results.length < count;
      dayOffset++
    ) {
      const day = from.plus({ days: dayOffset });
      const dayIso = day.toISODate()!;
      const slots = this.getClinicDaySlots(clinic, day.weekday, doctorId);
      if (slots.length === 0) continue;
      for (const slot of slots) {
        if (results.length >= count) break;
        const candidate = toScheduledAt(dayIso, slot, this.cfg);
        const candidateDt = DateTime.fromJSDate(candidate);
        if (candidateDt <= DateTime.fromJSDate(fromUtc)) continue;
        if (
          clinicId &&
          (await this.isSlotTaken(
            clinicId,
            candidate,
            doctorId,
            durationMinutes,
          ))
        ) {
          continue;
        }
        results.push(DateTime.fromJSDate(candidate).setZone(this.cfg.timezone));
      }
    }
    return results;
  }

  /** Same overlap rule as AppointmentsService.assertSlotFree. */
  private overlaps(
    startA: Date,
    durationA: number,
    startB: Date,
    durationB: number,
  ): boolean {
    const endA = startA.getTime() + durationA * 60_000;
    const endB = startB.getTime() + durationB * 60_000;
    return startA.getTime() < endB && startB.getTime() < endA;
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
      doctorId: string | null;
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

  /**
   * Resolve a doctor reply from ASK_DOCTOR: "2", "Dr. Achieng", "Achieng", …
   * Only active doctors are selectable; fall back to all when none are active.
   */
  private parseDoctorSelection(
    text: string,
    doctors: BotDoctor[],
  ): BotDoctor | null {
    const trimmed = (text ?? '').trim();
    if (!trimmed) return null;
    const active = doctors.filter((doctor) => doctor.isActive !== false);
    const pool = active.length > 0 ? active : doctors;

    const numbered = trimmed.match(/^(\d{1,2})\b/);
    if (numbered) {
      const index = Number(numbered[1]) - 1;
      if (index >= 0 && index < pool.length) return pool[index];
      return null;
    }

    const namePart = trimmed
      .toLowerCase()
      .replace(/^(dr|doctor)\.?\s+/, '')
      .trim();
    if (namePart.length < 3) return null;
    return (
      pool.find((doctor) => doctor.name.toLowerCase().includes(namePart)) ??
      pool.find((doctor) => namePart.includes(doctor.name.toLowerCase())) ??
      null
    );
  }

  private collectMissingFields(
    draft: {
      service: string | null;
      clinicId: string | null;
      doctorId: string | null;
      date: string | null;
      time: string | null;
      clientName: string | null;
    },
    clinics: BotClinic[],
  ): string[] {
    const missing: string[] = [];
    if (!draft.clinicId) missing.push('clinic');
    if (!draft.service) missing.push('service');
    const clinic = draft.clinicId
      ? (clinics.find((c) => c.id === draft.clinicId) ?? null)
      : null;
    const doctorValid = draft.doctorId
      ? (clinic?.doctors ?? []).some(
          (doctor) => doctor.id === draft.doctorId && doctor.isActive !== false,
        )
      : false;
    if ((clinic?.doctors.length ?? 0) > 0 && !doctorValid) {
      missing.push('doctor');
    }
    if (!draft.date || !draft.time) missing.push('datetime');
    if (!draft.clientName) missing.push('name');
    return missing;
  }

  private askForField(
    field: string,
    lang: BookingLang,
    draft: {
      service: string | null;
      clinicId: string | null;
      doctorId: string | null;
      date: string | null;
      time: string | null;
      clientName: string | null;
    },
    clinics: BotClinic[],
  ): string {
    switch (field) {
      case 'doctor':
        if (clinics.length === 0) return t(ASK_DOCTOR, lang);
        if (draft.clinicId) {
          const clinic = clinics.find((c) => c.id === draft.clinicId) ?? null;
          const doctors =
            clinic?.doctors.filter((d) => d.isActive !== false) ??
            (clinic ? clinic.doctors : []);
          if (doctors.length > 0) {
            const doctorList = this.humanizeList(
              doctors.map(
                (d) => `${d.name}${d.specialty ? ` (${d.specialty})` : ''}`,
              ),
              lang,
            );
            return t(ASK_DOCTOR, lang, { doctorList });
          }
        }
        return t(ASK_DOCTOR, lang);
      case 'service':
        return t(ASK_SERVICE, lang);
      case 'clinic':
        if (clinics.length === 0) return t(BOOKING_UNAVAILABLE, lang);
        return t(ASK_CLINIC, lang, {
          clinicList: this.humanizeList(
            clinics.map((c) => c.name),
            lang,
          ),
        });
      case 'datetime':
        return t(ASK_DATE_TIME, lang);
      case 'name':
        return t(ASK_NAME, lang);
      default:
        return t(ASK_SERVICE, lang);
    }
  }

  /** Turn a list into a sentence fragment instead of a numbered menu. */
  private humanizeList(items: string[], lang: BookingLang = 'en'): string {
    const joiner = lang === 'sw' ? 'na' : 'and';
    const values = items.map((item) => item.trim()).filter(Boolean);
    if (values.length === 0) return '';
    if (values.length === 1) return values[0];
    if (values.length === 2) return `${values[0]} ${joiner} ${values[1]}`;
    return `${values.slice(0, -1).join(', ')} ${joiner} ${values[values.length - 1]}`;
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
