import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  HttpCode,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { ClinicsService } from './clinics.service';
import { RegisterClinicDto } from './dto/register-clinic.dto';
import { AdminAuthGuard } from '../admin/guards/admin-auth.guard';
import { ClinicStatus } from '@prisma/client';

@ApiTags('Clinics')
@Controller('clinics')
export class ClinicsController {
  constructor(private readonly clinicsService: ClinicsService) {
    console.log('✅ ClinicsController (Public) initialized at /clinics');
  }

  @Post('register')
  @HttpCode(201)
  @ApiOperation({ summary: 'Register a new partner clinic (public)' })
  async register(@Body() dto: RegisterClinicDto) {
    return this.clinicsService.registerClinic(dto);
  }

  @Get('ping')
  @ApiOperation({ summary: 'Check if clinics controller is alive' })
  async ping() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }
}

@ApiTags('Admin Clinics')
@Controller('admin/clinics')
@UseGuards(AdminAuthGuard)
@ApiBearerAuth()
export class AdminClinicsController {
  constructor(private readonly clinicsService: ClinicsService) {
    console.log('✅ AdminClinicsController initialized at /admin/clinics');
  }

  @Get()
  @ApiOperation({ summary: 'List clinics (admin)' })
  @ApiQuery({ name: 'status', required: false, enum: ClinicStatus })
  async listClinics(@Query('status') status?: ClinicStatus) {
    return this.clinicsService.listClinics(status);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get clinic details (admin)' })
  async getClinic(@Param('id') id: string) {
    return this.clinicsService.getClinic(id);
  }

  @Post(':id/approve')
  @ApiOperation({ summary: 'Approve a clinic and generate staff credentials' })
  async approveClinic(
    @Param('id') id: string,
    @Request() req: { admin: { id: string } },
  ) {
    return this.clinicsService.approveClinic(id, req.admin.id);
  }

  @Post(':id/suspend')
  @ApiOperation({ summary: 'Suspend a clinic' })
  async suspendClinic(@Param('id') id: string) {
    return this.clinicsService.suspendClinic(id);
  }

  @Post(':id/reject')
  @ApiOperation({ summary: 'Reject a clinic application' })
  async rejectClinic(@Param('id') id: string, @Body('reason') reason: string) {
    return this.clinicsService.rejectClinic(id, reason);
  }
}
