import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  AppointmentActor,
  AppointmentChannel,
  AppointmentReminderKind,
  AppointmentStatus,
  CareEventType,
  CarePrivacyClass,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SmsService } from '../sms/sms.service';
import { CalendarSyncService } from '../calendar/calendar-sync.service';
import {
  hasReservationConflict,
  lockAppointmentReservation,
  OCCUPIED_APPOINTMENT_STATUSES,
} from './appointment-reservation';
import { EmailService } from './email.service';
import { CareEventsService } from '../care-intelligence/care-events.service';
import {
  CreateAppointmentDto,
  RescheduleAppointmentDto,
} from './dto/appointment.dto';
import {
  eatDateStart,
  eatDateStr,
  formatEat,
  generateDaySlots,
  inDayBeforeWindow,
  inHourBeforeWindow,
  isAfter10am,
  isBookableTime,
  isNoShowDue,
  overlaps,
  SLOT_MINUTES,
} from './appointment-slots';

const OPEN: AppointmentStatus[] = [
  AppointmentStatus.BOOKED,
  AppointmentStatus.RESCHEDULED,
];

@Injectable()
export class AppointmentsService {
  private readonly logger = new Logger(AppointmentsService.name);

  constructor(
    private prisma: PrismaService,
    private sms: SmsService,
    private email: EmailService,
    @Optional() private careEvents?: CareEventsService,
    @Optional() private calendar?: CalendarSyncService,
  ) {}

  async getClinicForBooking(
    clinicId: string,
    db: Prisma.TransactionClient = this.prisma,
  ) {
    const clinic = await db.clinic.findFirst({
      where: { id: clinicId, status: 'APPROVED' },
      select: {
        id: true,
        name: true,
        subCounty: true,
        physicalLocation: true,
        operatingHours: true,
        operatesOnWeekends: true,
        operatingSchedule: true,
        leadDentistName: true,
        whatsappNumber: true,
        googleMapsLink: true,
        latitude: true,
        longitude: true,
        activeDentalChairs: true,
      },
    });
    if (!clinic) throw new NotFoundException('Clinic not found');
    return clinic;
  }

  async listSlots(clinicId: string, date: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new BadRequestException('date must be YYYY-MM-DD');
    }
    const clinic = await this.getClinicForBooking(clinicId);
    const candidates = generateDaySlots(
      date,
      clinic.operatesOnWeekends,
      clinic.operatingSchedule,
    );
    const dayStart = candidates[0];
    const dayEnd = candidates.length
      ? new Date(
          candidates[candidates.length - 1].getTime() + SLOT_MINUTES * 60_000,
        )
      : null;
    const existing =
      dayStart && dayEnd
        ? await this.prisma.appointment.findMany({
            where: {
              clinicId,
              status: { in: OCCUPIED_APPOINTMENT_STATUSES },
              scheduledAt: { gte: dayStart, lt: dayEnd },
            },
            select: { scheduledAt: true, durationMinutes: true },
          })
        : [];
    const chairs = Math.max(clinic.activeDentalChairs || 1, 1);
    const busy =
      dayStart && dayEnd
        ? ((await this.calendar?.getBookingBusyIntervals(
            clinicId,
            null,
            dayStart,
            dayEnd,
          )) ?? [])
        : [];
    const now = new Date();
    const slots = candidates.map((start) => {
      const taken = existing.filter((row) =>
        overlaps(start, SLOT_MINUTES, row.scheduledAt, row.durationMinutes),
      ).length;
      const tooSoon = isBookableTime(start, now);
      const end = new Date(start.getTime() + SLOT_MINUTES * 60_000);
      const externalConflict = busy.some(
        (interval) => interval.start < end && interval.end > start,
      );
      return {
        scheduledAt: start.toISOString(),
        label: formatEat(start),
        available: !tooSoon && !externalConflict && taken < chairs,
      };
    });
    return {
      clinicId,
      date,
      durationMinutes: SLOT_MINUTES,
      chairs,
      slots,
    };
  }

  async create(memberId: string, dto: CreateAppointmentDto) {
    if (!dto.hasConsent) {
      throw new BadRequestException(
        'Consent is required to book and share intake with the clinic.',
      );
    }
    const scheduledAt = new Date(dto.scheduledAt);
    const timing = isBookableTime(scheduledAt);
    if (timing) throw new BadRequestException(timing);

    const member = await this.prisma.member.findUnique({
      where: { id: memberId },
      include: { subscription: true },
    });
    if (!member) throw new NotFoundException('Member not found');
    if (!member.subscription?.isActive) {
      throw new ForbiddenException(
        'An active membership is required to book a clinic appointment.',
      );
    }

    const clinic = await this.getClinicForBooking(dto.clinicId);
    this.assertOnGrid(scheduledAt, clinic);
    if (
      await this.calendar?.hasBookingConflict(
        clinic.id,
        null,
        scheduledAt,
        SLOT_MINUTES,
      )
    ) {
      throw new BadRequestException('That time is no longer available.');
    }
    const appointment = await this.prisma.$transaction(async (tx) => {
      await lockAppointmentReservation(tx, memberId, clinic.id);
      const currentClinic = await this.getClinicForBooking(clinic.id, tx);
      this.assertOnGrid(scheduledAt, currentClinic);
      if (
        await hasReservationConflict(tx, {
          clinicId: clinic.id,
          scheduledAt,
          durationMinutes: SLOT_MINUTES,
          chairs: currentClinic.activeDentalChairs || 1,
        })
      )
        throw new BadRequestException('That time is no longer available.');
      const existingOpen = await tx.appointment.findFirst({
        where: {
          memberId,
          status: { in: OCCUPIED_APPOINTMENT_STATUSES },
          scheduledAt: { gte: new Date() },
        },
      });
      if (existingOpen) {
        throw new BadRequestException(
          'You already have an upcoming appointment. Cancel or reschedule it first.',
        );
      }

      return tx.appointment.create({
        data: {
          memberId,
          clinicId: clinic.id,
          scheduledAt,
          intakeReason: dto.intakeReason.trim(),
          painLevel: dto.painLevel,
          allergies: dto.allergies?.trim() || null,
          currentMedications: dto.currentMedications?.trim() || null,
          medicalConditions: dto.medicalConditions?.trim() || null,
          memberNotes: dto.memberNotes?.trim() || null,
          hasConsent: true,
          events: {
            create: {
              type: 'BOOKED',
              actor: AppointmentActor.MEMBER,
              actorId: memberId,
              toScheduledAt: scheduledAt,
            },
          },
        },
        include: this.detailInclude(),
      });
    });
    await this.calendar?.createAppointmentEvent(appointment).catch(() => {
      this.logger.warn('External calendar sync failed after booking.');
    });

    void this.careEvents?.track({
      type: CareEventType.APPOINTMENT_BOOKED,
      memberId,
      source: 'web',
      county: member.county,
      subCounty: member.subCounty,
      metadata: { appointmentId: appointment.id, clinicId: clinic.id },
      privacyClass: CarePrivacyClass.ANALYTICS,
    });

    await this.notifyBooking(appointment, 'created');
    return appointment;
  }

  async listMine(memberId: string) {
    return this.prisma.appointment.findMany({
      where: { memberId },
      include: this.detailInclude(),
      orderBy: { scheduledAt: 'desc' },
      take: 50,
    });
  }

  async getMine(memberId: string, id: string) {
    const appointment = await this.prisma.appointment.findFirst({
      where: { id, memberId },
      include: {
        ...this.detailInclude(),
        events: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!appointment) throw new NotFoundException('Appointment not found');
    return appointment;
  }

  async cancelByMember(memberId: string, id: string, reason: string) {
    const appointment = await this.requireOpen(id);
    if (appointment.memberId !== memberId) {
      throw new ForbiddenException('You can only cancel your own appointment');
    }
    const updated = await this.markCancelled(
      appointment,
      AppointmentStatus.CANCELLED_BY_MEMBER,
      AppointmentActor.MEMBER,
      memberId,
      reason,
    );
    await this.tryDeleteCalendarEvent(updated.id);
    await this.notifyCancellation(updated, 'member');
    void this.careEvents?.track({
      type: CareEventType.APPOINTMENT_CANCELLED,
      memberId,
      metadata: { appointmentId: id, by: 'member' },
    });
    return updated;
  }

  async rescheduleByMember(
    memberId: string,
    id: string,
    dto: RescheduleAppointmentDto,
  ) {
    const appointment = await this.requireOpen(id);
    if (appointment.memberId !== memberId) {
      throw new ForbiddenException(
        'You can only reschedule your own appointment',
      );
    }
    return this.reschedule(appointment, dto, AppointmentActor.MEMBER, memberId);
  }

  async listForStaff(
    staffId: string,
    clinicIdFromToken?: string,
    date?: string,
  ) {
    const staff = await this.prisma.staffUser.findUnique({
      where: { id: staffId },
      select: { clinicId: true, role: true },
    });
    const clinicId = clinicIdFromToken || staff?.clinicId;
    if (!clinicId) {
      throw new ForbiddenException(
        'This staff account is not linked to a clinic.',
      );
    }
    const day =
      date && /^\d{4}-\d{2}-\d{2}$/.test(date)
        ? date
        : new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Africa/Nairobi',
          }).format(new Date());
    const start = new Date(`${day}T00:00:00+03:00`);
    const end = new Date(`${day}T23:59:59+03:00`);
    return this.prisma.appointment.findMany({
      where: { clinicId, scheduledAt: { gte: start, lte: end } },
      include: this.detailInclude(),
      orderBy: { scheduledAt: 'asc' },
    });
  }

  async cancelByStaff(staffId: string, id: string, reason: string) {
    const appointment = await this.requireOpen(id);
    await this.assertStaffClinic(staffId, appointment.clinicId);
    const updated = await this.markCancelled(
      appointment,
      AppointmentStatus.CANCELLED_BY_CLINIC,
      AppointmentActor.STAFF,
      staffId,
      reason,
    );
    await this.tryDeleteCalendarEvent(updated.id);
    await this.notifyCancellation(updated, 'clinic');
    void this.careEvents?.track({
      type: CareEventType.APPOINTMENT_CANCELLED,
      memberId: appointment.memberId,
      metadata: { appointmentId: id, by: 'clinic' },
    });
    return updated;
  }

  async rescheduleByStaff(
    staffId: string,
    id: string,
    dto: RescheduleAppointmentDto,
  ) {
    const appointment = await this.requireOpen(id);
    await this.assertStaffClinic(staffId, appointment.clinicId);
    return this.reschedule(appointment, dto, AppointmentActor.STAFF, staffId);
  }

  async markNoShow(staffId: string, id: string, note?: string) {
    const appointment = await this.requireOpen(id);
    await this.assertStaffClinic(staffId, appointment.clinicId);
    if (!isNoShowDue(appointment.scheduledAt) && note == null) {
      throw new BadRequestException(
        'Wait until two hours after the appointment time, or add a clinic note.',
      );
    }
    return this.applyNoShow(appointment, AppointmentActor.STAFF, staffId, note);
  }

  async addClinicNote(staffId: string, id: string, note: string) {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id },
    });
    if (!appointment) throw new NotFoundException('Appointment not found');
    await this.assertStaffClinic(staffId, appointment.clinicId);
    const updated = await this.prisma.appointment.update({
      where: { id },
      data: {
        clinicNotes: [appointment.clinicNotes, note].filter(Boolean).join('\n'),
        events: {
          create: {
            type: 'NOTE',
            actor: AppointmentActor.STAFF,
            actorId: staffId,
            reason: note,
          },
        },
      },
      include: this.detailInclude(),
    });
    const when = formatEat(updated.scheduledAt);
    await this.sms.sendSms(
      updated.member.phoneNumber,
      `MenoDAO: there is an update on your appointment at ${updated.clinic.name} (${when}). Open ${this.appUrl('/dashboard/appointments')} to view it.`,
    );
    return updated;
  }

  async attachVisit(
    appointmentId: string,
    visitId: string,
    staffId: string,
    expected?: { memberId?: string; clinicId?: string },
  ) {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
    });
    if (!appointment) {
      throw new NotFoundException('Appointment not found');
    }
    if (expected?.memberId && appointment.memberId !== expected.memberId) {
      throw new BadRequestException(
        'This appointment does not belong to the member being checked in.',
      );
    }
    if (expected?.clinicId && appointment.clinicId !== expected.clinicId) {
      throw new BadRequestException('This appointment is not at this clinic.');
    }
    if (
      !OPEN.includes(appointment.status) &&
      appointment.status !== AppointmentStatus.ATTENDED
    ) {
      return;
    }
    await this.prisma.appointment.update({
      where: { id: appointmentId },
      data: {
        visitId,
        status: AppointmentStatus.ATTENDED,
        events: {
          create: {
            type: 'ATTENDED',
            actor: AppointmentActor.STAFF,
            actorId: staffId,
          },
        },
      },
    });
  }

  async findOpenForMemberAtClinic(memberId: string, clinicId?: string) {
    return this.prisma.appointment.findFirst({
      where: {
        memberId,
        status: { in: OPEN },
        scheduledAt: {
          gte: new Date(Date.now() - 4 * 60 * 60 * 1000),
          lte: new Date(Date.now() + 12 * 60 * 60 * 1000),
        },
        ...(clinicId ? { clinicId } : {}),
      },
      orderBy: { scheduledAt: 'asc' },
    });
  }

  async sendDueReminders(now = new Date()) {
    const upcoming = await this.prisma.appointment.findMany({
      where: {
        status: { in: OPEN },
        scheduledAt: {
          gte: now,
          lte: new Date(now.getTime() + 28 * 60 * 60 * 1000),
        },
      },
      include: this.detailInclude(),
    });
    let sent = 0;
    for (const appt of upcoming) {
      if (
        !appt.dayBeforeReminderSentAt &&
        inDayBeforeWindow(appt.scheduledAt, now)
      ) {
        await this.sendReminder(appt, AppointmentReminderKind.DAY_BEFORE);
        sent += 1;
      }
      if (
        !appt.hourBeforeReminderSentAt &&
        inHourBeforeWindow(appt.scheduledAt, now) &&
        isAfter10am(appt.scheduledAt)
      ) {
        await this.sendReminder(appt, AppointmentReminderKind.HOUR_BEFORE);
        sent += 1;
      }
    }
    return sent;
  }

  /**
   * Morning staff run-down: a short SMS per clinic listing that day's
   * appointments (time + general info only — no clinical/treatment details).
   * Runs once a day at 07:00 EAT via AppointmentReminderJob.
   */
  async sendMorningStaffRunDown(now = new Date()) {
    const sent = await this.sendMorningStaffRunDownForClinics(now);
    return sent;
  }

  private async sendMorningStaffRunDownForClinics(now: Date): Promise<number> {
    const clinics = await this.prisma.clinic.findMany({
      where: { status: 'APPROVED' },
      select: { id: true, name: true, ownerPhone: true },
    });
    const todayStr = eatDateStr(now);
    const dayStart = eatDateStart(todayStr);
    const dayEnd = eatDateStart(eatDateStr(new Date(Date.now() + 86_400_000)));
    let sent = 0;
    for (const clinic of clinics) {
      if (!clinic.ownerPhone) continue;
      const todays = await this.prisma.appointment.findMany({
        where: {
          clinicId: clinic.id,
          status: { in: OPEN },
          scheduledAt: { gte: dayStart, lt: dayEnd },
        },
        orderBy: { scheduledAt: 'asc' },
        include: { member: { select: { fullName: true } } },
      });
      if (todays.length === 0) continue;
      const lines = todays
        .map(
          (a) =>
            `• ${formatEat(a.scheduledAt)} — ${a.member?.fullName || 'Member'}${a.status === 'RESCHEDULED' ? ' (rescheduled)' : ''}`,
        )
        .join('\n');
      const ok = await this.sms.sendSms(
        clinic.ownerPhone,
        `MenoDAO daily run-down for ${clinic.name} (${todayStr}):\n${lines}\nGeneral information only — open the staff area for full details.`,
      );
      if (ok.success) sent += 1;
    }
    return sent;
  }

  async markDueNoShows(now = new Date()) {
    const stale = await this.prisma.appointment.findMany({
      where: {
        status: { in: OPEN },
        scheduledAt: { lte: new Date(now.getTime() - 2 * 60 * 60 * 1000) },
      },
      include: this.detailInclude(),
    });
    for (const appt of stale) {
      if (isNoShowDue(appt.scheduledAt, now)) {
        await this.applyNoShow(
          appt,
          AppointmentActor.SYSTEM,
          null,
          'Automatically marked after two-hour grace.',
        );
      }
    }
    return stale.length;
  }

  private async reschedule(
    appointment: {
      id: string;
      memberId: string;
      clinicId: string;
      scheduledAt: Date;
      doctorId: string | null;
      durationMinutes: number;
    },
    dto: RescheduleAppointmentDto,
    actor: AppointmentActor,
    actorId: string,
  ) {
    const scheduledAt = new Date(dto.scheduledAt);
    const timing = isBookableTime(scheduledAt);
    if (timing) throw new BadRequestException(timing);
    const clinic = await this.getClinicForBooking(appointment.clinicId);
    this.assertOnGrid(scheduledAt, clinic);
    if (
      await this.calendar?.hasBookingConflict(
        clinic.id,
        appointment.doctorId,
        scheduledAt,
        appointment.durationMinutes,
      )
    )
      throw new BadRequestException('That time is no longer available.');
    const updated = await this.prisma.$transaction(async (tx) => {
      await lockAppointmentReservation(tx, appointment.memberId, clinic.id);
      const currentClinic = await this.getClinicForBooking(clinic.id, tx);
      this.assertOnGrid(scheduledAt, currentClinic);
      await tx.$queryRaw`SELECT id FROM "Appointment" WHERE id = ${appointment.id} FOR UPDATE`;
      const current = await tx.appointment.findUnique({
        where: { id: appointment.id },
      });
      if (!current || !OPEN.includes(current.status))
        throw new BadRequestException('This appointment is no longer open.');
      if (
        current.scheduledAt.getTime() !== appointment.scheduledAt.getTime() ||
        current.doctorId !== appointment.doctorId
      )
        throw new BadRequestException(
          'The appointment changed. Refresh it and try again.',
        );
      if (current.doctorId) {
        const doctor = await tx.clinicDoctor.findFirst({
          where: { id: current.doctorId, clinicId: clinic.id, isActive: true },
          include: { availability: true },
        });
        const start = new Date(scheduledAt.getTime() + 3 * 60 * 60_000);
        const finish = new Date(
          start.getTime() + current.durationMinutes * 60_000,
        );
        const clock = (date: Date) => date.toISOString().slice(11, 16);
        if (
          !doctor ||
          (doctor.availability.length &&
            !doctor.availability.some(
              (window) =>
                window.isActive &&
                window.dayOfWeek === start.getUTCDay() &&
                clock(start) >= window.startTime &&
                clock(finish) <= window.endTime &&
                start.getUTCDate() === finish.getUTCDate(),
            ))
        )
          throw new BadRequestException(
            'The doctor is unavailable at that time.',
          );
      }
      if (
        await hasReservationConflict(tx, {
          clinicId: clinic.id,
          doctorId: current.doctorId,
          scheduledAt,
          durationMinutes: current.durationMinutes,
          chairs: currentClinic.activeDentalChairs || 1,
          ignoreId: current.id,
        })
      )
        throw new BadRequestException('That time is no longer available.');
      return tx.appointment.update({
        where: { id: appointment.id },
        data: {
          scheduledAt,
          status: AppointmentStatus.RESCHEDULED,
          rescheduleReason: dto.reason,
          dayBeforeReminderSentAt: null,
          hourBeforeReminderSentAt: null,
          events: {
            create: {
              type: 'RESCHEDULED',
              actor,
              actorId,
              reason: dto.reason,
              fromScheduledAt: current.scheduledAt,
              toScheduledAt: scheduledAt,
            },
          },
        },
        include: this.detailInclude(),
      });
    });
    await this.calendar
      ?.updateAppointmentEvent(updated.id, {
        ...updated,
        externalCalendarProvider: updated.externalCalendarProvider || 'NONE',
      })
      .catch(() => {
        this.logger.warn('External calendar sync failed after rescheduling.');
      });
    void this.careEvents?.track({
      type: CareEventType.APPOINTMENT_RESCHEDULED,
      memberId: appointment.memberId,
      metadata: { appointmentId: appointment.id },
    });
    await this.notifyBooking(updated, 'rescheduled');
    return updated;
  }

  private async markCancelled(
    appointment: { id: string },
    status: AppointmentStatus,
    actor: AppointmentActor,
    actorId: string,
    reason: string,
  ) {
    return this.prisma.appointment.update({
      where: { id: appointment.id },
      data: {
        status,
        cancelReason: reason,
        events: {
          create: { type: 'CANCELLED', actor, actorId, reason },
        },
      },
      include: this.detailInclude(),
    });
  }

  private async applyNoShow(
    appointment: Awaited<ReturnType<AppointmentsService['requireOpen']>>,
    actor: AppointmentActor,
    actorId: string | null,
    note?: string,
  ) {
    const updated = await this.prisma.appointment.update({
      where: { id: appointment.id },
      data: {
        status: AppointmentStatus.NO_SHOW,
        noShowNotedAt: new Date(),
        clinicNotes: note
          ? [appointment.clinicNotes, note].filter(Boolean).join('\n')
          : appointment.clinicNotes,
        events: {
          create: {
            type: 'NO_SHOW',
            actor,
            actorId,
            reason: note || 'Patient did not attend',
          },
        },
      },
      include: this.detailInclude(),
    });
    void this.careEvents?.track({
      type: CareEventType.APPOINTMENT_NO_SHOW,
      memberId: appointment.memberId,
      metadata: { appointmentId: appointment.id },
    });
    const when = formatEat(updated.scheduledAt);
    const memberName = updated.member.fullName || 'Member';
    await this.sms.sendSms(
      updated.member.phoneNumber,
      `MenoDAO: we missed you at ${updated.clinic.name} (${when}). Reply or open the app to rebook.`,
    );
    if (actor === AppointmentActor.SYSTEM) {
      await this.sms.sendSms(
        updated.clinic.ownerPhone,
        `MenoDAO: ${memberName} did not attend ${when}. Marked no-show after the two-hour grace.`,
      );
      if (updated.clinic.email) {
        await this.email.send(
          updated.clinic.email,
          `MenoDAO no-show: ${memberName}`,
          [
            `${memberName} did not attend the appointment at ${updated.clinic.name} on ${when}.`,
            'Automatically marked no-show after the two-hour grace period.',
            '',
            'Sign in to review the appointment:',
            this.staffAppointmentsUrl(updated.scheduledAt),
          ].join('\n'),
        );
      }
    }
    return updated;
  }

  private async requireOpen(id: string) {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id },
      include: this.detailInclude(),
    });
    if (!appointment) throw new NotFoundException('Appointment not found');
    if (!OPEN.includes(appointment.status)) {
      throw new BadRequestException(
        'This appointment can no longer be changed.',
      );
    }
    return appointment;
  }

  private async assertStaffClinic(staffId: string, clinicId: string) {
    const staff = await this.prisma.staffUser.findUnique({
      where: { id: staffId },
      select: { clinicId: true, role: true },
    });
    if (!staff?.clinicId || staff.clinicId !== clinicId) {
      throw new ForbiddenException(
        'This appointment belongs to another clinic.',
      );
    }
  }

  private assertOnGrid(
    scheduledAt: Date,
    clinic: Awaited<ReturnType<AppointmentsService['getClinicForBooking']>>,
  ) {
    const slots = generateDaySlots(
      eatDateStr(scheduledAt),
      clinic.operatesOnWeekends,
      clinic.operatingSchedule,
    );
    if (!slots.some((slot) => slot.getTime() === scheduledAt.getTime())) {
      throw new BadRequestException(
        'Choose a listed clinic slot. Appointments are 30 minutes in Nairobi time.',
      );
    }
  }

  private detailInclude() {
    return {
      clinic: {
        select: {
          id: true,
          name: true,
          physicalLocation: true,
          subCounty: true,
          leadDentistName: true,
          ownerPhone: true,
          email: true,
          whatsappNumber: true,
        },
      },
      member: {
        select: {
          id: true,
          fullName: true,
          phoneNumber: true,
          preferredLanguage: true,
        },
      },
    };
  }

  /** Absolute link into the app. */
  private appUrl(path: string): string {
    const base = (
      process.env.APP_BASE_URL || 'https://app.menodao.org'
    ).replace(/\/+$/, '');
    return `${base}${path}`;
  }

  /**
   * Staff-facing deep link for an appointment day.
   *
   * Clinic notification emails deliberately carry no treatment details: the
   * recipient has to sign in to the staff area, where the API scopes
   * appointments to the staff member's clinic.
   */
  private staffAppointmentsUrl(scheduledAt: Date): string {
    return this.appUrl(`/staff/appointments?date=${eatDateStr(scheduledAt)}`);
  }

  private async notifyBooking(
    appointment: Awaited<ReturnType<AppointmentsService['requireOpen']>>,
    kind: 'created' | 'rescheduled',
  ) {
    const when = formatEat(appointment.scheduledAt);
    const memberName = appointment.member.fullName || 'Member';
    const verb = kind === 'created' ? 'booked' : 'rescheduled';
    await this.sms.sendSms(
      appointment.member.phoneNumber,
      `MenoDAO: appointment ${verb} at ${appointment.clinic.name} on ${when}. Bring your phone for check-in.`,
    );
    await this.sms.sendSms(
      appointment.clinic.ownerPhone,
      `MenoDAO: ${memberName} ${verb} an appointment on ${when}. Open ${this.staffAppointmentsUrl(appointment.scheduledAt)} to review.`,
    );
    if (appointment.clinic.email) {
      await this.email.send(
        appointment.clinic.email,
        `MenoDAO appointment ${verb}: ${memberName}`,
        [
          `${memberName} ${verb} an appointment.`,
          `When: ${when}`,
          `Clinic: ${appointment.clinic.name}`,
          '',
          'Treatment details are not included in email. Sign in to the staff area to review the pre-visit intake:',
          this.staffAppointmentsUrl(appointment.scheduledAt),
        ].join('\n'),
      );
    }
  }

  private async tryDeleteCalendarEvent(appointmentId: string) {
    await this.calendar?.deleteAppointmentEvent(appointmentId).catch(() => {
      this.logger.warn('External calendar sync failed after cancellation.');
    });
  }

  private async notifyCancellation(
    appointment: Awaited<ReturnType<AppointmentsService['requireOpen']>>,
    by: 'member' | 'clinic',
  ) {
    const when = formatEat(appointment.scheduledAt);
    const memberName = appointment.member.fullName || 'Member';
    if (by === 'clinic') {
      await this.sms.sendSms(
        appointment.member.phoneNumber,
        `MenoDAO: your appointment at ${appointment.clinic.name} on ${when} was cancelled by the clinic. Open ${this.appUrl('/dashboard/appointments')} to rebook.`,
      );
    } else {
      await this.sms.sendSms(
        appointment.member.phoneNumber,
        `MenoDAO: your appointment at ${appointment.clinic.name} on ${when} is cancelled.`,
      );
      await this.sms.sendSms(
        appointment.clinic.ownerPhone,
        `MenoDAO: ${memberName} cancelled ${when}. Open ${this.staffAppointmentsUrl(appointment.scheduledAt)} to review.`,
      );
    }
    if (appointment.clinic.email) {
      await this.email.send(
        appointment.clinic.email,
        `MenoDAO appointment cancelled: ${memberName}`,
        [
          by === 'clinic'
            ? `The clinic cancelled the appointment for ${memberName} at ${appointment.clinic.name} on ${when}.`
            : `${memberName} cancelled the appointment at ${appointment.clinic.name} on ${when}.`,
          '',
          'Sign in to review the appointment:',
          this.staffAppointmentsUrl(appointment.scheduledAt),
        ].join('\n'),
      );
    }
  }

  private async sendReminder(
    appointment: Awaited<ReturnType<AppointmentsService['requireOpen']>>,
    kind: AppointmentReminderKind,
  ) {
    const when = formatEat(appointment.scheduledAt);
    const text =
      kind === AppointmentReminderKind.DAY_BEFORE
        ? `MenoDAO reminder: you have a dental appointment tomorrow at ${appointment.clinic.name} (${when}).`
        : `MenoDAO reminder: your appointment at ${appointment.clinic.name} is in about an hour (${when}).`;
    const sms = await this.sms.sendSms(appointment.member.phoneNumber, text);
    await this.prisma.appointmentReminder
      .create({
        data: {
          appointmentId: appointment.id,
          kind,
          channel: AppointmentChannel.SMS,
          recipient: appointment.member.phoneNumber,
          status: sms.success ? 'SENT' : 'FAILED',
          errorMessage: sms.error || null,
        },
      })
      .catch((err) => {
        this.logger.warn(`Reminder log failed: ${err?.message}`);
      });
    const field =
      kind === AppointmentReminderKind.DAY_BEFORE
        ? 'dayBeforeReminderSentAt'
        : 'hourBeforeReminderSentAt';
    await this.prisma.appointment.update({
      where: { id: appointment.id },
      data: { [field]: new Date() },
    });
  }
}
