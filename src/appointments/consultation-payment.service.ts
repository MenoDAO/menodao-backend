import { Injectable, Logger, Optional } from '@nestjs/common';
import { AppointmentActor, AppointmentStatus, Prisma } from '@prisma/client';
import { DateTime } from 'luxon';
import { PrismaService } from '../prisma/prisma.service';
import { CalendarSyncService } from '../calendar/calendar-sync.service';
import { SmsService } from '../sms/sms.service';
import {
  SasaPayC2BCallbackData,
  SasaPayService,
} from '../sasapay/sasapay.service';

import { WhatsappPaymentNoticeService } from '../payments/whatsapp-payment-notice.service';

export const CONSULTATION_FEE_KES = 500;
export const CONSULTATION_HOLD_MS = 10 * 60_000;
export const CONSULTATION_REFERENCE_PREFIX = 'menodao_apt';

@Injectable()
export class ConsultationPaymentService {
  private readonly logger = new Logger(ConsultationPaymentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sasaPay: SasaPayService,
    private readonly sms: SmsService,
    private readonly calendar: CalendarSyncService,
    @Optional() private readonly notices?: WhatsappPaymentNoticeService,
  ) {}

  async options(memberId: string, db: Prisma.TransactionClient = this.prisma) {
    const [subscription, visit] = await Promise.all([
      db.subscription.findUnique({
        where: { memberId },
        select: { isActive: true, endDate: true },
      }),
      db.visit.findFirst({
        where: { memberId, status: 'DISCHARGED' },
        select: { id: true },
      }),
    ]);
    return {
      covered: Boolean(
        subscription?.isActive &&
        (!subscription.endDate || subscription.endDate > new Date()),
      ),
      cashAllowed: Boolean(visit),
    };
  }

  async sendPrompt(appointmentId: string, reference: string, payer: string) {
    try {
      const response = await this.sasaPay.requestPayment(
        payer,
        CONSULTATION_FEE_KES,
        reference,
        'MenoDAO dental consultation',
      );
      if (response.requestRejected) {
        await this.prisma.appointment.updateMany({
          where: {
            id: appointmentId,
            status: AppointmentStatus.AWAITING_PAYMENT,
          },
          data: { status: AppointmentStatus.PAYMENT_FAILED },
        });
        return 'rejected';
      }
      if (!response.status || !response.CheckoutRequestID) return 'unknown';
      await this.prisma.appointment.update({
        where: { id: appointmentId },
        data: { consultationCheckoutId: response.CheckoutRequestID },
      });
      return 'sent';
    } catch {
      this.logger.warn(
        'Unable to confirm dispatch of a consultation payment prompt.',
      );
      return 'unknown';
    }
  }

  async settle(
    reference: string,
    token: string,
    payload: SasaPayC2BCallbackData,
  ) {
    if (!payload || !this.sasaPay.verifyStkCallback(reference, token))
      return { success: false };
    const checkout = payload.CheckoutRequestID;
    if (typeof checkout !== 'string' || !checkout.trim())
      return { success: false };
    const appointment = await this.prisma.appointment.findUnique({
      where: { consultationReference: reference },
      include: { member: true, clinic: true },
    });
    if (!appointment || appointment.consultationMethod !== 'MPESA')
      return { success: false };
    if (!appointment.consultationCheckoutId)
      return { success: false, retryable: true };
    if (
      checkout.trim() !== appointment.consultationCheckoutId ||
      (payload.BillRefNumber && payload.BillRefNumber !== reference)
    )
      return { success: false };

    const code = payload.ResultCode == null ? null : String(payload.ResultCode);
    if (
      (code === '0' && payload.Paid === false) ||
      (code && code !== '0' && payload.Paid === true)
    )
      return { success: false };
    if (code !== '0' && payload.Paid !== true) {
      if (code == null && payload.Paid !== false) return { success: false };
      await this.prisma.$transaction(async (tx) => {
        const changed = await tx.appointment.updateMany({
          where: {
            id: appointment.id,
            status: AppointmentStatus.AWAITING_PAYMENT,
          },
          data: { status: AppointmentStatus.PAYMENT_FAILED },
        });
        if (changed.count)
          await this.notices?.enqueue(
            tx,
            appointment.memberId,
            appointment.id,
            'CONSULTATION_FAILED',
          );
      });
      return { success: true };
    }
    const rawAmount = payload.TransAmount ?? payload.Amount;
    const rawReceipt =
      payload.MpesaReceiptNumber || payload.TransactionCode || payload.TransID;
    if (
      (typeof rawAmount !== 'number' && typeof rawAmount !== 'string') ||
      Number(rawAmount) !== CONSULTATION_FEE_KES ||
      typeof rawReceipt !== 'string' ||
      !/^[a-z0-9]+$/i.test(rawReceipt.trim())
    )
      return { success: false };
    const receipt = rawReceipt.trim().toUpperCase();

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${receipt}, 0))`;
      await tx.$queryRaw`SELECT id FROM "Appointment" WHERE id = ${appointment.id} FOR UPDATE`;
      const current = await tx.appointment.findUniqueOrThrow({
        where: { id: appointment.id },
      });
      if (current.consultationReceipt)
        return current.consultationReceipt === receipt
          ? 'duplicate'
          : 'invalid';
      const [appointmentReceipt, contributionReceipt] = await Promise.all([
        tx.appointment.findFirst({
          where: { consultationReceipt: receipt },
          select: { id: true },
        }),
        tx.contribution.findFirst({
          where: {
            status: 'COMPLETED',
            mpesaReceiptNumber: { equals: receipt, mode: 'insensitive' },
          },
          select: { id: true },
        }),
      ]);
      if (appointmentReceipt || contributionReceipt) return 'invalid';
      if (
        current.status !== AppointmentStatus.AWAITING_PAYMENT &&
        current.status !== AppointmentStatus.PAYMENT_FAILED
      )
        return 'invalid';
      // Record late payments for staff reconciliation without booking a past visit.
      if (
        current.status === AppointmentStatus.PAYMENT_FAILED ||
        current.scheduledAt <= new Date() ||
        current.createdAt.getTime() + CONSULTATION_HOLD_MS <= Date.now()
      ) {
        await tx.appointment.update({
          where: { id: current.id },
          data: {
            consultationReceipt: receipt,
            status: AppointmentStatus.PAYMENT_REVIEW,
          },
        });
        await this.notices?.enqueue(
          tx,
          current.memberId,
          current.id,
          'CONSULTATION_REVIEW',
        );
        return 'review';
      }
      await tx.appointment.update({
        where: { id: current.id },
        data: {
          consultationReceipt: receipt,
          status: AppointmentStatus.BOOKED,
          events: {
            create: {
              type: 'BOOKED',
              actor: AppointmentActor.SYSTEM,
              toScheduledAt: current.scheduledAt,
            },
          },
        },
      });
      await this.notices?.enqueue(
        tx,
        current.memberId,
        current.id,
        'CONSULTATION_PAID',
      );
      return 'confirmed';
    });
    if (result === 'review') {
      this.logger.warn(
        `Late consultation payment requires staff review for appointment ${appointment.id}.`,
      );
      const reference = appointment.id.slice(0, 8).toUpperCase();
      const memberMessage =
        appointment.member.preferredLanguage === 'sw'
          ? `Malipo yako yamepokelewa baada ya muda wa kuhifadhi miadi kuisha. Tafadhali wasiliana na kliniki ukitumia rejea ${reference} kabla ya kulipa tena.`
          : `Your payment arrived after the appointment hold expired. Please contact the clinic with reference ${reference} before making another payment.`;
      await Promise.allSettled([
        this.sms.sendSms(appointment.member.phoneNumber, memberMessage),
        this.sms.sendSms(
          appointment.clinic.ownerPhone,
          `MenoDAO: a late appointment payment needs review. Open the staff schedule and look for ${reference}.`,
        ),
      ]);
    }
    if (result === 'confirmed') {
      const when = DateTime.fromJSDate(appointment.scheduledAt, {
        zone: 'Africa/Nairobi',
      })
        .setLocale(
          appointment.member.preferredLanguage === 'sw' ? 'sw' : 'en-KE',
        )
        .toFormat('ccc, d LLL, HH:mm');
      const ref = appointment.id.slice(0, 8).toUpperCase();
      const message =
        appointment.member.preferredLanguage === 'sw'
          ? `Malipo yamepokelewa. Miadi yako katika ${appointment.clinic.name}, ${when}, imethibitishwa. Rejea ${ref}.`
          : `Payment received. Your consultation at ${appointment.clinic.name} on ${when} is confirmed. Reference ${ref}.`;
      await Promise.allSettled([
        this.sms.sendSms(appointment.member.phoneNumber, message),
        this.calendar.createAppointmentEvent(appointment),
      ]);
    }
    return { success: result !== 'invalid' };
  }
}
