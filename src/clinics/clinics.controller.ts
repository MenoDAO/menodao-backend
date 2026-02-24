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
@Controller()
export class ClinicsController {
  constructor(private readonly clinicsService: ClinicsService) {}

  // ── Public endpoint (no auth) ─────────────────────────────

  @Post('clinics/register')
  @HttpCode(201)
  @ApiOperation({ summary: 'Register a new partner clinic (public)' })
  async register(@Body() dto: RegisterClinicDto) {
    return this.clinicsService.registerClinic(dto);
  }

  // ── Admin endpoints ───────────────────────────────────────

  @Get('admin/clinics')
  @UseGuards(AdminAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List clinics (admin)' })
  @ApiQuery({ name: 'status', required: false, enum: ClinicStatus })
  async listClinics(@Query('status') status?: ClinicStatus) {
    return this.clinicsService.listClinics(status);
  }

  @Get('admin/clinics/:id')
  @UseGuards(AdminAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get clinic details (admin)' })
  async getClinic(@Param('id') id: string) {
    return this.clinicsService.getClinic(id);
  }

  @Post('admin/clinics/:id/approve')
  @UseGuards(AdminAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Approve a clinic and generate staff credentials' })
  async approveClinic(@Param('id') id: string, @Request() req: any) {
    return this.clinicsService.approveClinic(id, req.admin.id);
  }

  @Post('admin/clinics/:id/suspend')
  @UseGuards(AdminAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Suspend a clinic' })
  async suspendClinic(@Param('id') id: string) {
    return this.clinicsService.suspendClinic(id);
  }

  @Post('admin/clinics/:id/reject')
  @UseGuards(AdminAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Reject a clinic application' })
  async rejectClinic(@Param('id') id: string, @Body('reason') reason: string) {
    return this.clinicsService.rejectClinic(id, reason);
  }
}
