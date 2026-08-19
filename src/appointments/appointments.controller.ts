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
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtCaptchaGuard } from '../captcha/guards/jwt-captcha.guard';
import { AppointmentsService } from './appointments.service';
import {
  CancelAppointmentDto,
  CreateAppointmentDto,
  RescheduleAppointmentDto,
} from './dto/appointment.dto';

@ApiTags('Appointments')
@Controller('appointments')
@UseGuards(JwtAuthGuard, JwtCaptchaGuard)
@ApiBearerAuth()
export class AppointmentsController {
  constructor(private readonly appointments: AppointmentsService) {}

  @Get('slots')
  @ApiOperation({ summary: 'Available appointment slots for a clinic/day' })
  @ApiQuery({ name: 'clinicId', required: true })
  @ApiQuery({ name: 'date', required: true, description: 'YYYY-MM-DD (EAT)' })
  listSlots(
    @Query('clinicId') clinicId: string,
    @Query('date') date: string,
  ) {
    return this.appointments.listSlots(clinicId, date);
  }

  @Get()
  @ApiOperation({ summary: 'List the current member appointments' })
  listMine(@Request() req: { user: { id: string } }) {
    return this.appointments.listMine(req.user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Appointment detail for the current member' })
  getMine(
    @Param('id') id: string,
    @Request() req: { user: { id: string } },
  ) {
    return this.appointments.getMine(req.user.id, id);
  }

  @Post()
  @ApiOperation({ summary: 'Book a clinic appointment with pre-visit intake' })
  create(
    @Body() dto: CreateAppointmentDto,
    @Request() req: { user: { id: string } },
  ) {
    return this.appointments.create(req.user.id, dto);
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: 'Member cancels an appointment' })
  cancel(
    @Param('id') id: string,
    @Body() dto: CancelAppointmentDto,
    @Request() req: { user: { id: string } },
  ) {
    return this.appointments.cancelByMember(req.user.id, id, dto.reason);
  }

  @Post(':id/reschedule')
  @ApiOperation({ summary: 'Member reschedules an appointment' })
  reschedule(
    @Param('id') id: string,
    @Body() dto: RescheduleAppointmentDto,
    @Request() req: { user: { id: string } },
  ) {
    return this.appointments.rescheduleByMember(req.user.id, id, dto);
  }
}
