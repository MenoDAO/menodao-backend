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
  BadRequestException,
  Patch,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { ClinicsService } from './clinics.service';
import { RegisterClinicDto } from './dto/register-clinic.dto';
import { UpdateClinicDto } from './dto/update-clinic.dto';
import { AdminCreateClinicDto } from './dto/admin-create-clinic.dto';
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

  @Get('map')
  @ApiOperation({ summary: 'Get all approved clinics for the member map' })
  async getMapClinics() {
    return this.clinicsService.getMapClinics();
  }

  @Get('nearby')
  @ApiOperation({
    summary: 'Get approved clinics near a location, sorted by distance',
  })
  @ApiQuery({ name: 'lat', type: Number, required: true })
  @ApiQuery({ name: 'lng', type: Number, required: true })
  @ApiQuery({
    name: 'radius',
    type: Number,
    required: false,
    description: 'Radius in km (default 50)',
  })
  async getNearbyClinics(
    @Query('lat') lat: string,
    @Query('lng') lng: string,
    @Query('radius') radius?: string,
  ) {
    if (!lat || !lng) {
      throw new BadRequestException(
        'lat and lng query parameters are required',
      );
    }
    const latNum = parseFloat(lat);
    const lngNum = parseFloat(lng);
    if (isNaN(latNum) || isNaN(lngNum)) {
      throw new BadRequestException('lat and lng must be valid numbers');
    }
    const radiusNum = radius ? parseFloat(radius) : 50;
    return this.clinicsService.getNearbyClinics(latNum, lngNum, radiusNum);
  }

  @Get('ping')
  @ApiOperation({ summary: 'Check if clinics controller is alive' })
  async ping() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Approved clinic details for booking' })
  async getPublicClinic(@Param('id') id: string) {
    return this.clinicsService.getPublicClinic(id);
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

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Admin-create a new clinic directly' })
  async adminCreateClinic(
    @Body() dto: AdminCreateClinicDto,
    @Request() req: { admin: { id: string } },
  ) {
    return this.clinicsService.adminCreateClinic(dto, req.admin.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get clinic details (admin)' })
  async getClinic(@Param('id') id: string) {
    return this.clinicsService.getClinic(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update clinic fields (admin)' })
  async updateClinic(@Param('id') id: string, @Body() dto: UpdateClinicDto) {
    return this.clinicsService.updateClinic(id, dto);
  }

  @Get(':id/branches')
  @ApiOperation({ summary: 'Get all branch clinics for a parent clinic' })
  async getClinicBranches(@Param('id') id: string) {
    return this.clinicsService.getClinicBranches(id);
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
