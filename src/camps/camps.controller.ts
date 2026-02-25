import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Query,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { CampsService } from './camps.service';
import {
  CreateCampDto,
  UpdateCampDto,
  AssignMemberDto,
} from './dto/create-camp.dto';
import { StaffAuthGuard } from '../staff/guards/staff-auth.guard';
import { JwtOrStaffAuthGuard } from '../auth/guards/jwt-or-staff-auth.guard';

@ApiTags('Camps')
@Controller('camps')
@ApiBearerAuth()
export class CampsController {
  constructor(private readonly campsService: CampsService) {}

  // ── Staff-only endpoints ──────────────────────────────────

  @Post()
  @UseGuards(StaffAuthGuard)
  @ApiOperation({ summary: 'Create a new camp' })
  create(@Body() createCampDto: CreateCampDto) {
    return this.campsService.create(createCampDto);
  }

  // ── Accessible to both members and staff ──────────────────

  @Get()
  @UseGuards(JwtOrStaffAuthGuard)
  @ApiOperation({ summary: 'List all camps' })
  findAll() {
    return this.campsService.findAll();
  }

  @Get('upcoming')
  @UseGuards(JwtOrStaffAuthGuard)
  @ApiOperation({ summary: 'List upcoming active camps' })
  getUpcoming() {
    return this.campsService.getUpcomingCamps();
  }

  @Get('nearby')
  @UseGuards(JwtOrStaffAuthGuard)
  @ApiOperation({ summary: 'Find camps nearby a coordinate' })
  @ApiQuery({ name: 'lat', type: Number })
  @ApiQuery({ name: 'lon', type: Number })
  @ApiQuery({ name: 'radius', type: Number, required: false })
  findNearby(
    @Query('lat') lat: string,
    @Query('lon') lon: string,
    @Query('radius') radius: string = '50',
  ) {
    return this.campsService.findNearby(
      parseFloat(lat),
      parseFloat(lon),
      parseFloat(radius),
    );
  }

  @Get('member/:memberId')
  @UseGuards(JwtOrStaffAuthGuard)
  @ApiOperation({ summary: 'Get all camp registrations for a member' })
  getMemberRegistrations(@Param('memberId') memberId: string) {
    return this.campsService.getMemberRegistrations(memberId);
  }

  @Get(':id')
  @UseGuards(JwtOrStaffAuthGuard)
  @ApiOperation({ summary: 'Get camp details with capacity info' })
  findOne(@Param('id') id: string) {
    return this.campsService.getCamp(id);
  }

  // ── Staff-only write endpoints ────────────────────────────

  @Patch(':id')
  @UseGuards(StaffAuthGuard)
  @ApiOperation({ summary: 'Update a camp' })
  update(@Param('id') id: string, @Body() updateCampDto: UpdateCampDto) {
    return this.campsService.update(id, updateCampDto);
  }

  @Delete(':id')
  @UseGuards(StaffAuthGuard)
  @ApiOperation({ summary: 'Deactivate a camp' })
  remove(@Param('id') id: string) {
    return this.campsService.remove(id);
  }

  @Post(':id/register')
  @UseGuards(StaffAuthGuard)
  @ApiOperation({ summary: 'Register a member for a camp' })
  register(@Param('id') id: string, @Body() dto: AssignMemberDto) {
    return this.campsService.registerForCamp(dto.memberId, id);
  }

  @Post(':id/assign')
  @UseGuards(StaffAuthGuard)
  @ApiOperation({ summary: 'Legacy endpoint to assign a member' })
  assignMember(@Param('id') id: string, @Body() dto: AssignMemberDto) {
    return this.campsService.registerForCamp(dto.memberId, id);
  }

  @Post(':id/cancel')
  @UseGuards(StaffAuthGuard)
  @ApiOperation({ summary: 'Cancel a member registration' })
  cancel(@Param('id') id: string, @Body() dto: AssignMemberDto) {
    return this.campsService.cancelRegistration(dto.memberId, id);
  }
}
