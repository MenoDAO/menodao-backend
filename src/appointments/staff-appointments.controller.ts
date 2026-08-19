import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { StaffAuthGuard } from '../staff/guards/staff-auth.guard';
import { StaffJwtCaptchaGuard } from '../captcha/guards/staff-jwt-captcha.guard';
import { AppointmentsService } from './appointments.service';
import {
  AppointmentNoteDto,
  CancelAppointmentDto,
  RescheduleAppointmentDto,
} from './dto/appointment.dto';

interface StaffRequest {
  staff: { id: string; clinicId?: string };
}

@ApiTags('Staff Appointments')
@Controller('staff/appointments')
@UseGuards(StaffAuthGuard, StaffJwtCaptchaGuard)
@ApiBearerAuth()
export class StaffAppointmentsController {
  constructor(private readonly appointments: AppointmentsService) {}

  @Get()
  @ApiOperation({ summary: 'Clinic appointments for a day (default today EAT)' })
  @ApiQuery({ name: 'date', required: false })
  list(@Request() req: StaffRequest, @Query('date') date?: string) {
    return this.appointments.listForStaff(req.staff.id, req.staff.clinicId, date);
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: 'Clinic cancels an appointment and notifies the member' })
  cancel(
    @Param('id') id: string,
    @Body() dto: CancelAppointmentDto,
    @Request() req: StaffRequest,
  ) {
    return this.appointments.cancelByStaff(req.staff.id, id, dto.reason);
  }

  @Post(':id/reschedule')
  @ApiOperation({ summary: 'Clinic reschedules an appointment' })
  reschedule(
    @Param('id') id: string,
    @Body() dto: RescheduleAppointmentDto,
    @Request() req: StaffRequest,
  ) {
    return this.appointments.rescheduleByStaff(req.staff.id, id, dto);
  }

  @Post(':id/no-show')
  @ApiOperation({ summary: 'Mark a booked appointment as no-show' })
  noShow(
    @Param('id') id: string,
    @Body() dto: AppointmentNoteDto,
    @Request() req: StaffRequest,
  ) {
    return this.appointments.markNoShow(req.staff.id, id, dto.note);
  }

  @Post(':id/note')
  @ApiOperation({ summary: 'Add a clinic-side discrepancy note' })
  note(
    @Param('id') id: string,
    @Body() dto: AppointmentNoteDto,
    @Request() req: StaffRequest,
  ) {
    return this.appointments.addClinicNote(req.staff.id, id, dto.note);
  }
}
