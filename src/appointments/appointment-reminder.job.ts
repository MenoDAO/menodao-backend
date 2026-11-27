import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { CONSULTATION_HOLD_MS } from './consultation-payment.service';
import { AppointmentsService } from './appointments.service';

@Injectable()
export class AppointmentReminderJob {
  private readonly logger = new Logger(AppointmentReminderJob.name);

  constructor(
    private readonly appointments: AppointmentsService,
    private readonly prisma: PrismaService,
  ) {}

  @Cron('* * * * *')
  async releaseExpiredPaymentHolds() {
    await this.prisma.appointment.updateMany({
      where: {
        status: 'AWAITING_PAYMENT',
        createdAt: { lte: new Date(Date.now() - CONSULTATION_HOLD_MS) },
      },
      data: { status: 'PAYMENT_FAILED' },
    });
  }

  @Cron('*/10 * * * *')
  async reminders() {
    try {
      const sent = await this.appointments.sendDueReminders();
      if (sent > 0) {
        this.logger.log(`Sent ${sent} appointment reminder(s)`);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'unknown';
      this.logger.error(`Appointment reminders failed: ${message}`);
    }
  }

  @Cron('5 * * * *')
  async noShows() {
    try {
      const count = await this.appointments.markDueNoShows();
      if (count > 0) {
        this.logger.log(
          `Processed ${count} overdue appointment(s) for no-show`,
        );
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'unknown';
      this.logger.error(`No-show sweep failed: ${message}`);
    }
  }

  @Cron('0 7 * * *')
  async morningStaffRunDown() {
    try {
      const sent = await this.appointments.sendMorningStaffRunDown();
      if (sent > 0) {
        this.logger.log(`Sent morning staff run-down (${sent} clinic/c(s))`);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'unknown';
      this.logger.error(`Morning staff run-down failed: ${message}`);
    }
  }
}
