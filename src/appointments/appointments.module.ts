import { Module } from '@nestjs/common';
import { SmsModule } from '../sms/sms.module';
import { AppointmentsController } from './appointments.controller';
import { StaffAppointmentsController } from './staff-appointments.controller';
import { AppointmentsService } from './appointments.service';
import { AppointmentReminderJob } from './appointment-reminder.job';
import { EmailService } from './email.service';

@Module({
  imports: [SmsModule],
  controllers: [AppointmentsController, StaffAppointmentsController],
  providers: [AppointmentsService, EmailService, AppointmentReminderJob],
  exports: [AppointmentsService],
})
export class AppointmentsModule {}
