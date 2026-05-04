import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { TriggerBulkResult } from './dto/trigger-bulk-response.dto';
import { Cron } from '@nestjs/schedule';
import {
  ClinicStatus,
  PaymentFrequency,
  ReminderLogStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SMSService } from '../notifications/sms.service';
import { SmsTemplateService } from '../notifications/sms-templates';

// Type alias for template keys used in renewal reminders
type ReminderTemplateKey =
  | 'subscription_renewal_7day'
  | 'subscription_renewal_1day';

interface ClinicSummary {
  name: string;
  whatsappNumber: string;
}

@Injectable()
export class RenewalReminderService {
  private readonly logger = new Logger(RenewalReminderService.name);
  private readonly smsTemplateService = new SmsTemplateService();

  constructor(
    private readonly prisma: PrismaService,
    private readonly smsService: SMSService,
  ) {}

  /**
   * Compute the subscription expiry date based on start date and payment frequency.
   * MONTHLY → startDate + 30 days
   * ANNUAL → startDate + 365 days
   */
  computeExpiryDate(startDate: Date, frequency: PaymentFrequency): Date {
    const expiry = new Date(startDate);
    if (frequency === PaymentFrequency.ANNUAL) {
      expiry.setDate(expiry.getDate() + 365);
    } else {
      expiry.setDate(expiry.getDate() + 30);
    }
    return expiry;
  }

  /**
   * Select the appropriate reminder template based on days remaining.
   * <= 1 day → subscription_renewal_1day
   * all other values → subscription_renewal_7day
   */
  selectTemplateForDaysRemaining(daysRemaining: number): ReminderTemplateKey {
    return daysRemaining <= 1
      ? 'subscription_renewal_1day'
      : 'subscription_renewal_7day';
  }

  /**
   * Check if a reminder with the given templateKey was already sent to this member today (EAT = UTC+3).
   */
  private async isAlreadySentToday(
    memberId: string,
    templateKey: string,
  ): Promise<boolean> {
    // EAT is UTC+3 — compute start/end of today in EAT as UTC timestamps
    const nowUtc = new Date();
    const eatOffsetMs = 3 * 60 * 60 * 1000;
    const nowEat = new Date(nowUtc.getTime() + eatOffsetMs);

    // Start of today in EAT (midnight EAT = 21:00 UTC previous day)
    const startOfDayEat = new Date(nowEat);
    startOfDayEat.setHours(0, 0, 0, 0);
    const startOfDayUtc = new Date(startOfDayEat.getTime() - eatOffsetMs);

    // End of today in EAT (midnight next day EAT = 21:00 UTC today)
    const endOfDayEat = new Date(nowEat);
    endOfDayEat.setHours(23, 59, 59, 999);
    const endOfDayUtc = new Date(endOfDayEat.getTime() - eatOffsetMs);

    const existing = await this.prisma.smsReminderLog.findFirst({
      where: {
        memberId,
        templateKey,
        sentAt: {
          gte: startOfDayUtc,
          lte: endOfDayUtc,
        },
      },
    });
    return existing !== null;
  }

  /**
   * Persist an SMS reminder log entry.
   */
  private async persistLog(
    memberId: string,
    phoneNumber: string,
    templateKey: string,
    deliveryStatus: ReminderLogStatus,
    providerMessageId?: string,
  ) {
    return this.prisma.smsReminderLog.create({
      data: {
        memberId,
        phoneNumber,
        templateKey,
        deliveryStatus,
        providerMessageId,
      },
    });
  }

  /**
   * Send a renewal reminder SMS to a member.
   * Performs idempotency check, fetches member data, renders template, sends SMS, and persists log.
   */
  async sendRenewalReminder(
    memberId: string,
    templateKey: ReminderTemplateKey,
  ): Promise<void> {
    // Idempotency check
    const alreadySent = await this.isAlreadySentToday(memberId, templateKey);
    if (alreadySent) {
      this.logger.log(
        `[RenewalReminder] Skipping ${templateKey} for member ${memberId} — already sent today`,
      );
      return;
    }

    // Fetch member with active subscription
    const member = await this.prisma.member.findUnique({
      where: { id: memberId },
      include: { subscription: true },
    });

    if (!member || !member.subscription || !member.phoneNumber) {
      this.logger.warn(
        `[RenewalReminder] Member ${memberId} not found or missing subscription/phone`,
      );
      return;
    }

    const { subscription } = member;
    const expiryDate = this.computeExpiryDate(
      subscription.subscriptionStartDate,
      subscription.paymentFrequency,
    );
    const expiryDateStr = expiryDate.toLocaleDateString('en-KE', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    const message = this.smsTemplateService.render(
      templateKey,
      member.preferredLanguage,
      {
        name: member.fullName || 'Member',
        expiryDate: expiryDateStr,
        tier: subscription.tier,
      },
    );

    try {
      const result = await this.smsService.sendSMS(member.phoneNumber, message);
      const status = result.success
        ? ReminderLogStatus.SENT
        : ReminderLogStatus.FAILED;
      await this.persistLog(
        memberId,
        member.phoneNumber,
        templateKey,
        status,
        result.messageId,
      );

      if (result.success) {
        this.logger.log(
          `[RenewalReminder] Sent ${templateKey} to member ${memberId} (${member.phoneNumber})`,
        );
      } else {
        this.logger.error(
          `[RenewalReminder] Failed to send ${templateKey} to member ${memberId}: ${result.error}`,
        );
      }
    } catch (error) {
      await this.persistLog(
        memberId,
        member.phoneNumber,
        templateKey,
        ReminderLogStatus.FAILED,
      );
      this.logger.error(
        `[RenewalReminder] Exception sending ${templateKey} to member ${memberId}: ${error.message}`,
      );
    }
  }

  /**
   * Daily cron job that runs at 09:00 EAT (06:00 UTC).
   * Finds all active subscriptions expiring in 7 days or 1 day and sends renewal reminders.
   */
  @Cron('0 6 * * *') // 09:00 EAT = 06:00 UTC
  async handleDailyReminderCron(): Promise<void> {
    this.logger.log('[RenewalReminder] Starting daily reminder cron job');

    const nowUtc = new Date();
    const eatOffsetMs = 3 * 60 * 60 * 1000;

    // Compute EAT midnight-to-midnight windows for 7 days and 1 day from now
    const computeEatWindow = (daysFromNow: number) => {
      const targetEat = new Date(nowUtc.getTime() + eatOffsetMs);
      targetEat.setDate(targetEat.getDate() + daysFromNow);
      targetEat.setHours(0, 0, 0, 0);
      const startUtc = new Date(targetEat.getTime() - eatOffsetMs);
      const endUtc = new Date(startUtc.getTime() + 24 * 60 * 60 * 1000 - 1);
      return { startUtc, endUtc };
    };

    const window7 = computeEatWindow(7);
    const window1 = computeEatWindow(1);

    // Fetch all active subscriptions
    const activeSubscriptions = await this.prisma.subscription.findMany({
      where: { isActive: true },
      select: {
        memberId: true,
        subscriptionStartDate: true,
        paymentFrequency: true,
      },
    });

    let sent7day = 0;
    let sent1day = 0;
    let failed = 0;
    let skipped = 0;

    for (const sub of activeSubscriptions) {
      const expiry = this.computeExpiryDate(
        sub.subscriptionStartDate,
        sub.paymentFrequency,
      );

      const in7dayWindow =
        expiry >= window7.startUtc && expiry <= window7.endUtc;
      const in1dayWindow =
        expiry >= window1.startUtc && expiry <= window1.endUtc;

      if (!in7dayWindow && !in1dayWindow) {
        continue;
      }

      const templateKey: ReminderTemplateKey = in1dayWindow
        ? 'subscription_renewal_1day'
        : 'subscription_renewal_7day';

      const alreadySent = await this.isAlreadySentToday(
        sub.memberId,
        templateKey,
      );
      if (alreadySent) {
        skipped++;
        continue;
      }

      try {
        await this.sendRenewalReminder(sub.memberId, templateKey);
        if (in1dayWindow) sent1day++;
        else sent7day++;
      } catch (error) {
        failed++;
        this.logger.error(
          `[RenewalReminder] Cron failed for member ${sub.memberId}: ${error.message}`,
        );
      }
    }

    this.logger.log(
      `[RenewalReminder] Cron complete — checked: ${activeSubscriptions.length}, 7-day sent: ${sent7day}, 1-day sent: ${sent1day}, failed: ${failed}, skipped: ${skipped}`,
    );
  }

  /**
   * Query approved clinics in the given sub-county (case-insensitive), limited to 5.
   * Returns an empty array if subCounty is null/empty.
   */
  private async getApprovedClinicsForSubCounty(
    subCounty: string | null,
    memberId: string,
  ): Promise<ClinicSummary[]> {
    if (!subCounty) {
      this.logger.warn(
        `[RenewalReminder] Member ${memberId} has no subCounty — cannot find nearby clinics`,
      );
      return [];
    }

    const clinics = await this.prisma.clinic.findMany({
      where: {
        status: ClinicStatus.APPROVED,
        subCounty: {
          equals: subCounty,
          mode: 'insensitive',
        },
      },
      select: {
        name: true,
        whatsappNumber: true,
      },
      take: 5,
    });

    return clinics;
  }

  /**
   * Manually trigger a renewal reminder for a specific member.
   * Fetches the member's active subscription, computes days remaining,
   * selects the appropriate template, and sends the reminder.
   * Throws NotFoundException (HTTP 404) if no active subscription is found.
   */
  async triggerMemberReminder(memberId: string): Promise<{
    phoneNumber: string;
    templateKey: string;
  }> {
    const subscription = await this.prisma.subscription.findFirst({
      where: { memberId, isActive: true },
      include: { member: true },
    });

    if (!subscription) {
      throw new NotFoundException(
        `No active subscription found for member ${memberId}`,
      );
    }

    const expiryDate = this.computeExpiryDate(
      subscription.subscriptionStartDate,
      subscription.paymentFrequency,
    );
    const nowUtc = new Date();
    const msPerDay = 24 * 60 * 60 * 1000;
    const daysRemaining = Math.ceil(
      (expiryDate.getTime() - nowUtc.getTime()) / msPerDay,
    );
    const templateKey = this.selectTemplateForDaysRemaining(daysRemaining);

    await this.sendRenewalReminder(memberId, templateKey);

    return {
      phoneNumber: subscription.member.phoneNumber,
      templateKey,
    };
  }

  /**
   * Manually trigger renewal reminders for all active subscriptions
   * expiring within the given number of days.
   * Returns counts of triggered, skipped (already sent today), and failed sends.
   */
  async triggerBulkReminder(
    daysUntilExpiry: number,
  ): Promise<TriggerBulkResult> {
    const activeSubscriptions = await this.prisma.subscription.findMany({
      where: { isActive: true },
      select: {
        memberId: true,
        subscriptionStartDate: true,
        paymentFrequency: true,
      },
    });

    const nowUtc = new Date();
    const msPerDay = 24 * 60 * 60 * 1000;
    const cutoffDate = new Date(nowUtc.getTime() + daysUntilExpiry * msPerDay);

    let triggered = 0;
    let skipped = 0;
    let failed = 0;

    for (const sub of activeSubscriptions) {
      const expiry = this.computeExpiryDate(
        sub.subscriptionStartDate,
        sub.paymentFrequency,
      );

      if (expiry > cutoffDate) {
        continue;
      }

      const daysRemaining = Math.ceil(
        (expiry.getTime() - nowUtc.getTime()) / msPerDay,
      );
      const templateKey = this.selectTemplateForDaysRemaining(daysRemaining);

      const alreadySent = await this.isAlreadySentToday(
        sub.memberId,
        templateKey,
      );
      if (alreadySent) {
        skipped++;
        continue;
      }

      try {
        await this.sendRenewalReminder(sub.memberId, templateKey);
        triggered++;
      } catch (error) {
        failed++;
        this.logger.error(
          `[RenewalReminder] triggerBulkReminder failed for member ${sub.memberId}: ${error.message}`,
        );
      }
    }

    this.logger.log(
      `[RenewalReminder] triggerBulkReminder complete — triggered: ${triggered}, skipped: ${skipped}, failed: ${failed}`,
    );
    return { triggered, skipped, failed };
  }

  /**
   * Send a post-renewal SMS to a member confirming their subscription is active
   * and listing up to 5 approved clinics in their sub-county.
   * Called by SubscriptionsService.activateSubscription() after subscription activation.
   */
  async sendPostRenewalNotification(memberId: string): Promise<void> {
    const member = await this.prisma.member.findUnique({
      where: { id: memberId },
      include: { subscription: true },
    });

    if (!member || !member.subscription || !member.phoneNumber) {
      this.logger.warn(
        `[RenewalReminder] sendPostRenewalNotification: member ${memberId} not found or missing data`,
      );
      return;
    }

    const clinics = await this.getApprovedClinicsForSubCounty(
      member.subCounty,
      memberId,
    );

    const clinicList =
      clinics.length > 0
        ? clinics.map((c) => `${c.name} – ${c.whatsappNumber}`).join(', ')
        : 'No clinics found in your area yet';

    const message = this.smsTemplateService.render(
      'subscription_active_with_clinics',
      member.preferredLanguage,
      {
        name: member.fullName || 'Member',
        tier: member.subscription.tier,
        clinicList,
      },
    );

    try {
      const result = await this.smsService.sendSMS(member.phoneNumber, message);
      const status = result.success
        ? ReminderLogStatus.SENT
        : ReminderLogStatus.FAILED;
      await this.persistLog(
        memberId,
        member.phoneNumber,
        'subscription_active_with_clinics',
        status,
        result.messageId,
      );

      if (result.success) {
        this.logger.log(
          `[RenewalReminder] Post-renewal notification sent to member ${memberId}`,
        );
      } else {
        this.logger.error(
          `[RenewalReminder] Post-renewal notification failed for member ${memberId}: ${result.error}`,
        );
      }
    } catch (error) {
      await this.persistLog(
        memberId,
        member.phoneNumber,
        'subscription_active_with_clinics',
        ReminderLogStatus.FAILED,
      );
      this.logger.error(
        `[RenewalReminder] Exception in post-renewal notification for member ${memberId}: ${error.message}`,
      );
    }
  }
}
