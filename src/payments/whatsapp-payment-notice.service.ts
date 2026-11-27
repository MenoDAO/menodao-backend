import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { FlaresendApiClient } from '../bot/whatsapp-clients/flaresend-api.client';
import { PrismaService } from '../prisma/prisma.service';

type PaymentNoticeKind =
  | 'MEMBERSHIP_FAILED'
  | 'MEMBERSHIP_PAID'
  | 'CONSULTATION_FAILED'
  | 'CONSULTATION_PAID'
  | 'CONSULTATION_REVIEW';

const messages: Record<PaymentNoticeKind, [string, string]> = {
  MEMBERSHIP_FAILED: [
    'Your M-Pesa membership payment did not go through. Check your balance or M-Pesa message, then reply *retry payment* to try again.',
    'Malipo yako ya uanachama kwa M-Pesa hayakufaulu. Angalia salio au ujumbe wako wa M-Pesa, kisha jibu *retry payment* kujaribu tena.',
  ],
  MEMBERSHIP_PAID: [
    'Your M-Pesa membership payment was received. Reply *my plan* to check your membership.',
    'Malipo yako ya uanachama kwa M-Pesa yamepokelewa. Jibu *my plan* kuangalia uanachama wako.',
  ],
  CONSULTATION_FAILED: [
    'Your consultation payment did not go through. Your appointment was not confirmed. Reply *book an appointment* to try again.',
    'Malipo ya uchunguzi hayakufaulu. Miadi yako haijathibitishwa. Jibu *book an appointment* kujaribu tena.',
  ],
  CONSULTATION_PAID: [
    'Your M-Pesa payment was received and your consultation is confirmed.',
    'Malipo yako ya M-Pesa yamepokelewa na miadi yako ya uchunguzi imethibitishwa.',
  ],
  CONSULTATION_REVIEW: [
    'Your payment arrived after the slot was released. Contact the clinic before paying again.',
    'Malipo yako yamefika baada ya muda wa kuhifadhi nafasi kuisha. Wasiliana na kliniki kabla ya kulipa tena.',
  ],
};

@Injectable()
export class WhatsappPaymentNoticeService {
  private readonly logger = new Logger(WhatsappPaymentNoticeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsapp: FlaresendApiClient,
  ) {}

  async enqueue(
    tx: Prisma.TransactionClient,
    memberId: string,
    sourceId: string,
    kind: PaymentNoticeKind,
  ) {
    const id = `${kind}:${sourceId}`;
    await tx.whatsappPaymentNotice.create({
      data: { id, memberId, sourceId, kind },
    });
  }

  @Cron('*/20 * * * * *')
  async sendPending() {
    const now = new Date();
    const items = await this.prisma.whatsappPaymentNotice.findMany({
      where: {
        finishedAt: null,
        nextAttempt: { lte: now },
        attempts: { lt: 5 },
      },
      orderBy: { createdAt: 'asc' },
      take: 50,
    });
    for (const item of items) {
      const claimed = await this.prisma.whatsappPaymentNotice.updateMany({
        where: { id: item.id, finishedAt: null, nextAttempt: { lte: now } },
        data: {
          attempts: { increment: 1 },
          nextAttempt: new Date(Date.now() + 120_000 * (item.attempts + 1)),
        },
      });
      if (!claimed.count) continue;
      try {
        const member = await this.prisma.member.findUnique({
          where: { id: item.memberId },
          select: {
            phoneNumber: true,
            preferredLanguage: true,
            whatsappUnsubscribedAt: true,
          },
        });
        if (
          member &&
          !member.whatsappUnsubscribedAt &&
          !(await this.wasSuperseded(item))
        ) {
          const message = messages[item.kind as PaymentNoticeKind];
          if (message)
            await this.whatsapp.sendTextMessage(
              member.phoneNumber,
              message[member.preferredLanguage === 'sw' ? 1 : 0],
            );
        }
        await this.prisma.whatsappPaymentNotice.update({
          where: { id: item.id },
          data: { finishedAt: new Date() },
        });
      } catch {
        this.logger.warn('WhatsApp payment update could not be delivered.');
      }
    }
  }

  private async wasSuperseded(item: { kind: string; sourceId: string }) {
    if (item.kind === 'MEMBERSHIP_FAILED') {
      const payment = await this.prisma.contribution.findUnique({
        where: { id: item.sourceId },
        select: { status: true },
      });
      return payment?.status !== 'FAILED';
    }
    if (item.kind === 'CONSULTATION_FAILED') {
      const appointment = await this.prisma.appointment.findUnique({
        where: { id: item.sourceId },
        select: { status: true },
      });
      return appointment?.status !== 'PAYMENT_FAILED';
    }
    return false;
  }
}
