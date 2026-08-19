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
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SmsService } from '../sms/sms.service';
import { EmailService } from './email.service';
import { CareEventsService } from '../care-intelligence/care-events.service';
import {
  CreateAppointmentDto,
  RescheduleAppointmentDto,
} from './dto/appointment.dto';
import {
  formatEat,
  generateDaySlots,
  inDayBeforeWindow,
  inHourBeforeWindow,
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
  ) {}

  async getClinicForBooking(clinicId: string) {
    const clinic = await this.prisma.clinic.findFirst({
      where: { id: clinicId, status: 'APPROVED' },
      select: {
        id: true,
        name: true,
        subCounty: true,
        physicalLocation: true,
        operatingHours: true,
        operatesOnWeekends: true,
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
    const candidates = generateDaySlots(date, clinic.operatesOnWeekends);
    const dayStart = candidates[0];
    const dayEnd = candidates.length
      ? new Date(candidates[candidates.length - 1].getTime() + SLOT_MINUTES * 60_000)
      : null;
    const existing = dayStart && dayEnd
      ? await this.prisma.appointment.findMany({
          where: {
            clinicId,
            status: { in: OPEN },
            scheduledAt: { gte: dayStart, lt: dayEnd },
          },
          select: { scheduledAt: true, durationMinutes: true },
        })
      : [];
    const chairs = Math.max(clinic.activeDentalChairs || 1, 1);
    const now = new Date();
    const slots = candidates.map((start) => {
      const taken = existing.filter((row) =>
        overlaps(start, SLOT_MINUTES, row.scheduledAt, row.durationMinutes),
      ).length;
      const tooSoon = isBookableTime(start, now);
      return {
        scheduledAt: start.toISOString(),
        label: formatEat(start),
        available: !tooSoon && taken < chairs,
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
    await this.assertSlotFree(clinic.id, scheduledAt, clinic.activeDentalChairs || 1);

    const existingOpen = await this.prisma.appointment.findFirst({
      where: {
        memberId,
        status: { in: OPEN },
        scheduledAt: { gte: new Date() },
      },
    });
    if (existingOpen) {
      throw new BadRequestException(
        'You already have an upcoming appointment. Cancel or reschedule it first.',
      );
    }

    const appointment = await this.prisma.appointment.create({
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
      include: { ...this.detailInclude(), events: { orderBy: { createdAt: 'asc' } } },
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
      throw new ForbiddenException('You can only reschedule your own appointment');
    }
    return this.reschedule(
      appointment,
      dto,
      AppointmentActor.MEMBER,
      memberId,
    );
  }

  async listForStaff(staffId: string, clinicIdFromToken?: string, date?: string) {
    const staff = await this.prisma.staffUser.findUnique({
      where: { id: staffId },
      select: { clinicId: true, role: true },
    });
    const clinicId = clinicIdFromToken || staff?.clinicId;
    if (!clinicId) {
      throw new ForbiddenException('This staff account is not linked to a clinic.');
    }
    const day = date && /^\d{4}-\d{2}-\d{2}$/.test(date)
      ? date
      : new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi' }).format(
          new Date(),
        );
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
      `MenoDAO: update on your appointment at ${updated.clinic.name} (${when}): ${note}`,
    );
    return updated;
  }

  async attachVisit(appointmentId: string, visitId: string, staffId: string) {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
    });
    if (!appointment) return;
    if (!OPEN.includes(appointment.status) && appointment.status !== AppointmentStatus.ATTENDED) {
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
      if (!appt.dayBeforeReminderSentAt && inDayBeforeWindow(appt.scheduledAt, now)) {
        await this.sendReminder(appt, AppointmentReminderKind.DAY_BEFORE);
        sent += 1;
      }
      if (!appt.hourBeforeReminderSentAt && inHourBeforeWindow(appt.scheduledAt, now)) {
        await this.sendReminder(appt, AppointmentReminderKind.HOUR_BEFORE);
        sent += 1;
      }
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
        await this.applyNoShow(appt, AppointmentActor.SYSTEM, null, 'Automatically marked after two-hour grace.');
      }
    }
    return stale.length;
  }

  private async reschedule(
    appointment: { id: string; memberId: string; clinicId: string; scheduledAt: Date },
    dto: RescheduleAppointmentDto,
    actor: AppointmentActor,
    actorId: string,
  ) {
    const scheduledAt = new Date(dto.scheduledAt);
    const timing = isBookableTime(scheduledAt);
    if (timing) throw new BadRequestException(timing);
    const clinic = await this.getClinicForBooking(appointment.clinicId);
    await this.assertSlotFree(
      clinic.id,
      scheduledAt,
      clinic.activeDentalChairs || 1,
      appointment.id,
    );
    const updated = await this.prisma.appointment.update({
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
            fromScheduledAt: appointment.scheduledAt,
            toScheduledAt: scheduledAt,
          },
        },
      },
      include: this.detailInclude(),
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
          `${memberName} did not attend the appointment at ${updated.clinic.name} on ${when}. Automatically marked no-show after the two-hour grace.`,
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
      throw new BadRequestException('This appointment can no longer be changed.');
    }
    return appointment;
  }

  private async assertStaffClinic(staffId: string, clinicId: string) {
    const staff = await this.prisma.staffUser.findUnique({
      where: { id: staffId },
      select: { clinicId: true, role: true },
    });
    if (!staff?.clinicId || staff.clinicId !== clinicId) {
      throw new ForbiddenException('This appointment belongs to another clinic.');
    }
  }

  private async assertSlotFree(
    clinicId: string,
    scheduledAt: Date,
    chairs: number,
    ignoreId?: string,
  ) {
    const windowStart = new Date(scheduledAt.getTime() - SLOT_MINUTES * 60_000);
    const windowEnd = new Date(scheduledAt.getTime() + SLOT_MINUTES * 60_000);
    const existing = await this.prisma.appointment.findMany({
      where: {
        clinicId,
        status: { in: OPEN },
        scheduledAt: { gte: windowStart, lt: windowEnd },
        ...(ignoreId ? { id: { not: ignoreId } } : {}),
      },
      select: { scheduledAt: true, durationMinutes: true },
    });
    const taken = existing.filter((row) =>
      overlaps(scheduledAt, SLOT_MINUTES, row.scheduledAt, row.durationMinutes),
    ).length;
    if (taken >= chairs) {
      throw new BadRequestException('That time is no longer available.');
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

  private async notifyBooking(
    appointment: Awaited<ReturnType<AppointmentsService['requireOpen']>>,
    kind: 'created' | 'rescheduled',
  ) {
    const when = formatEat(appointment.scheduledAt);
    const memberName = appointment.member.fullName || 'Member';
    const verb = kind === 'created' ? 'booked' : 'rescheduled';
    const reasonLine =
      kind === 'rescheduled' && appointment.rescheduleReason
        ? ` Reason: ${appointment.rescheduleReason}`
        : '';
    await this.sms.sendSms(
      appointment.member.phoneNumber,
      `MenoDAO: appointment ${verb} at ${appointment.clinic.name} on ${when}. Bring your phone for check-in.${reasonLine}`,
    );
    await this.sms.sendSms(
      appointment.clinic.ownerPhone,
      `MenoDAO: ${memberName} ${verb} an appointment on ${when}. Reason: ${appointment.intakeReason}`,
    );
    if (appointment.clinic.email) {
      await this.email.send(
        appointment.clinic.email,
        `MenoDAO appointment ${verb}: ${memberName}`,
        [
          `${memberName} ${verb} an appointment.`,
          `When: ${when}`,
          `Clinic: ${appointment.clinic.name}`,
          `Reason: ${appointment.intakeReason}`,
          appointment.painLevel != null ? `Pain: ${appointment.painLevel}/10` : '',
          appointment.allergies ? `Allergies: ${appointment.allergies}` : '',
          appointment.currentMedications
            ? `Medications: ${appointment.currentMedications}`
            : '',
          appointment.medicalConditions
            ? `Conditions: ${appointment.medicalConditions}`
            : '',
          `Phone: ${appointment.member.phoneNumber}`,
        ]
          .filter(Boolean)
          .join('\n'),
      );
    }
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
        `MenoDAO: your appointment at ${appointment.clinic.name} on ${when} was cancelled by the clinic. ${appointment.cancelReason || ''} Open the app to rebook.`,
      );
    } else {
      await this.sms.sendSms(
        appointment.member.phoneNumber,
        `MenoDAO: your appointment at ${appointment.clinic.name} on ${when} is cancelled.`,
      );
      await this.sms.sendSms(
        appointment.clinic.ownerPhone,
        `MenoDAO: ${memberName} cancelled ${when}. Reason: ${appointment.cancelReason || 'not given'}`,
      );
    }
    if (appointment.clinic.email) {
      await this.email.send(
        appointment.clinic.email,
        `MenoDAO appointment cancelled: ${memberName}`,
        `${memberName} / clinic cancellation for ${when}. Reason: ${appointment.cancelReason || 'not given'}`,
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
    await this.prisma.appointmentReminder.create({
      data: {
        appointmentId: appointment.id,
        kind,
        channel: AppointmentChannel.SMS,
        recipient: appointment.member.phoneNumber,
        status: sms.success ? 'SENT' : 'FAILED',
        errorMessage: sms.error || null,
      },
    }).catch((err) => {
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
