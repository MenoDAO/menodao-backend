import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { DateTime } from 'luxon';
import { FlaresendApiClient } from '../bot/whatsapp-clients/flaresend-api.client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class WhatsappMonthlyRenewalJob {
  private readonly logger = new Logger(WhatsappMonthlyRenewalJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsapp: FlaresendApiClient,
    private readonly config: ConfigService,
  ) {}

  @Cron('0 30 9 2,3 * *', { timeZone: 'Africa/Nairobi' })
  async sendDueReminders(now = new Date()) {
    if (this.config.get('NODE_ENV') !== 'production') return;
    const local = DateTime.fromJSDate(now, { zone: 'Africa/Nairobi' });
    const start = local.startOf('month').toJSDate();
    const period = local.toFormat('yyyy-MM');
    const eligibility: Prisma.MemberWhereInput = {
      whatsappUnsubscribedAt: null,
      whatsappLinkedAt: { not: null },
      OR: [
        { whatsappRenewalPeriod: null },
        { whatsappRenewalPeriod: { not: period } },
      ],
      subscription: { is: { tier: 'BRONZE', paymentFrequency: 'MONTHLY' } },
      contributions: {
        some: { status: 'COMPLETED', paymentFrequency: 'MONTHLY' },
        none: {
          status: 'COMPLETED',
          OR: [
            { confirmedAt: { gte: start } },
            { confirmedAt: null, createdAt: { gte: start } },
          ],
        },
      },
    };

    let after: string | undefined;
    for (;;) {
      const members = await this.prisma.member.findMany({
        where: {
          AND: [eligibility, ...(after ? [{ id: { gt: after } }] : [])],
        },
        orderBy: { id: 'asc' },
        take: 100,
        select: { id: true, phoneNumber: true, preferredLanguage: true },
      });
      for (const member of members) {
        const claimed = await this.prisma.member.updateMany({
          where: { id: member.id, AND: eligibility },
          data: { whatsappRenewalPeriod: period },
        });
        if (!claimed.count) continue;
        try {
          const message =
            member.preferredLanguage === 'sw'
              ? 'Kikumbusho cha MenoDAO: malipo yako ya Bronze ya KES 350 ya mwezi huu yanahitajika. Kujadiliana kuhusu malipo, jibu *Pay Bronze monthly*. Kusitisha vikumbusho, jibu *Stop*.'
              : 'A MenoDAO reminder: your KES 350 Bronze payment is due this month. Reply *Pay Bronze monthly* to pay by M-Pesa, or *Stop* to stop these messages.';
          await this.whatsapp.sendTextMessage(member.phoneNumber, message);
        } catch {
          // A provider timeout can mean the message sent. Keep the claim so
          // the second scheduled run does not send the same reminder again.
          this.logger.warn(
            'Delivery of a monthly WhatsApp renewal reminder could not be confirmed.',
          );
        }
      }
      if (members.length < 100) return;
      after = members.at(-1)?.id;
    }
  }
}
