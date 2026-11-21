import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminAuthGuard } from './guards/admin-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class DoctorAvailabilityItemDto {
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek!: number;

  @IsString()
  startTime!: string;

  @IsString()
  endTime!: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

class UpsertDoctorAvailabilityDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DoctorAvailabilityItemDto)
  items!: DoctorAvailabilityItemDto[];
}

class ClinicHoursItemDto {
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek!: number;

  @IsOptional()
  @IsString()
  openTime?: string;

  @IsOptional()
  @IsString()
  closeTime?: string;

  @IsOptional()
  @IsBoolean()
  isClosed?: boolean;
}

class UpsertClinicHoursDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ClinicHoursItemDto)
  items!: ClinicHoursItemDto[];
}

class CreateDoctorDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsString()
  specialty?: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsInt()
  @Min(15)
  @Max(240)
  consultationMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(60)
  bufferMinutes?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

class UpdateDoctorDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  specialty?: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsInt()
  @Min(15)
  @Max(240)
  consultationMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(60)
  bufferMinutes?: number;
}

class SetProcedureDurationDto {
  @IsInt()
  @Min(5)
  @Max(240)
  durationMinutes!: number;
}

/**
 * Admin booking management surface.
 *
 * Lets admins (after the ADMIN + SMS OTP flow) configure the pieces the bot's
 * booking engine depends on:
 *   - per-doctor schedules / availability
 *   - clinic operating hours
 *   - procedure (service) visit durations
 *
 * All routes sit behind the admin session guard and are consumed by the admin
 * console UI; the bot reads the same rows through the booking service.
 */
@ApiTags('Admin Booking')
@Controller('admin/booking')
@UseGuards(AdminAuthGuard)
@ApiBearerAuth()
export class AdminBookingController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('procedures')
  @ApiOperation({ summary: 'List procedures and their durations (admin)' })
  async listProcedures() {
    const procedures = await this.prisma.procedure.findMany({
      orderBy: { code: 'asc' },
      select: {
        id: true,
        code: true,
        name: true,
        durationMinutes: true,
        isActive: true,
      },
    });
    return { procedures };
  }

  @Get('clinics/:clinicId/hours')
  @ApiOperation({ summary: 'List clinic operating hours (admin)' })
  async listClinicHours(@Param('clinicId') clinicId: string) {
    const hours = await this.prisma.clinicOperatingHour.findMany({
      where: { clinicId },
      orderBy: { dayOfWeek: 'asc' },
    });
    return { hours };
  }

  @Get('clinics/:clinicId/doctors')
  @ApiOperation({ summary: 'List doctors for a clinic (admin)' })
  async listDoctors(@Param('clinicId') clinicId: string) {
    const doctors = await this.prisma.clinicDoctor.findMany({
      where: { clinicId },
      orderBy: { createdAt: 'asc' },
      include: { availability: { orderBy: { dayOfWeek: 'asc' } } },
    });
    return { doctors };
  }

  @Post('clinics/:clinicId/doctors')
  @ApiOperation({ summary: 'Create a doctor for a clinic (admin)' })
  async createDoctor(
    @Param('clinicId') clinicId: string,
    @Body() dto: CreateDoctorDto,
  ) {
    const doctor = await this.prisma.clinicDoctor.create({
      data: {
        clinicId,
        name: dto.name,
        title: dto.title ?? null,
        specialty: dto.specialty ?? null,
        isActive: dto.isActive ?? true,
        consultationMinutes: dto.consultationMinutes ?? 15,
        bufferMinutes: dto.bufferMinutes ?? 5,
      },
      include: { availability: true },
    });
    return { doctor };
  }

  @Patch('doctors/:id')
  @ApiOperation({ summary: 'Update a doctor (admin)' })
  async updateDoctor(@Param('id') id: string, @Body() dto: UpdateDoctorDto) {
    const existing = await this.prisma.clinicDoctor.findUnique({ where: { id } });
    if (!existing) {
      throw new Error('Doctor not found');
    }
    const doctor = await this.prisma.clinicDoctor.update({
      where: { id },
      data: {
        name: dto.name ?? existing.name,
        specialty: dto.specialty ?? existing.specialty,
        title: dto.title ?? existing.title,
        isActive: dto.isActive ?? existing.isActive,
        consultationMinutes:
          dto.consultationMinutes ?? existing.consultationMinutes,
        bufferMinutes: dto.bufferMinutes ?? existing.bufferMinutes,
      },
      include: { availability: true },
    });
    return { doctor };
  }

  @Delete('doctors/:id')
  @ApiOperation({ summary: 'Delete a doctor (admin)' })
  async deleteDoctor(@Param('id') id: string) {
    await this.prisma.clinicDoctor.delete({ where: { id } });
    return { ok: true };
  }

  @Put('doctors/:id/availability')
  @ApiOperation({ summary: 'Set doctor availability windows (admin)' })
  async setDoctorAvailability(
    @Param('id') id: string,
    @Body() dto: UpsertDoctorAvailabilityDto,
  ) {
    const doctor = await this.prisma.clinicDoctor.findUnique({ where: { id } });
    if (!doctor) {
      throw new Error('Doctor not found');
    }
    const ops = (dto.items ?? []).map((item) => ({
      doctorId: id,
      dayOfWeek: item.dayOfWeek,
      startTime: item.startTime,
      endTime: item.endTime,
      isActive: item.isActive ?? true,
    }));
    await this.prisma.doctorAvailability.deleteMany({ where: { doctorId: id } });
    if (ops.length > 0) {
      await this.prisma.doctorAvailability.createMany({ data: ops });
    }
    const availability = await this.prisma.doctorAvailability.findMany({
      where: { doctorId: id },
      orderBy: { dayOfWeek: 'asc' },
    });
    return { availability };
  }

  @Put('clinics/:clinicId/hours')
  @ApiOperation({ summary: 'Set clinic operating hours (admin)' })
  async setClinicHours(
    @Param('clinicId') clinicId: string,
    @Body() dto: UpsertClinicHoursDto,
  ) {
    const items = (dto.items ?? []).map((item) => ({
      clinicId,
      dayOfWeek: item.dayOfWeek,
      openTime: item.isClosed ? null : item.openTime ?? null,
      closeTime: item.isClosed ? null : item.closeTime ?? null,
      isClosed: item.isClosed ?? false,
    }));
    for (const item of items) {
      await this.prisma.clinicOperatingHour.upsert({
        where: { clinicId_dayOfWeek: { clinicId, dayOfWeek: item.dayOfWeek } },
        create: item,
        update: {
          openTime: item.openTime,
          closeTime: item.closeTime,
          isClosed: item.isClosed,
        },
      });
    }
    const hours = await this.prisma.clinicOperatingHour.findMany({
      where: { clinicId },
      orderBy: { dayOfWeek: 'asc' },
    });
    return { hours };
  }

  @Patch('procedures/:id/duration')
  @ApiOperation({ summary: 'Set procedure visit duration in minutes (admin)' })
  async setProcedureDuration(
    @Param('id') id: string,
    @Body() dto: SetProcedureDurationDto,
  ) {
    const procedure = await this.prisma.procedure.findUnique({ where: { id } });
    if (!procedure) {
      throw new Error('Procedure not found');
    }
    const updated = await this.prisma.procedure.update({
      where: { id },
      data: { durationMinutes: dto.durationMinutes },
    });
    return { procedure: updated };
  }
}
