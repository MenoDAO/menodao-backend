import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ProceduresService } from './procedures.service';
import { StaffAuthGuard } from '../staff/guards/staff-auth.guard';
import { StaffJwtCaptchaGuard } from '../captcha/guards/staff-jwt-captcha.guard';
import { PackageTier } from '@prisma/client';

@ApiTags('Procedures')
@Controller('procedures')
@UseGuards(StaffAuthGuard, StaffJwtCaptchaGuard)
@ApiBearerAuth()
export class ProceduresController {
  constructor(private proceduresService: ProceduresService) {}

  @Get()
  @ApiOperation({ summary: 'Get all active procedures' })
  async getAllProcedures() {
    return this.proceduresService.getAllProcedures();
  }

  @Get('tier/:tier')
  @ApiOperation({ summary: 'Get procedures allowed for a specific tier' })
  async getProceduresForTier(@Param('tier') tier: PackageTier) {
    return this.proceduresService.getProceduresForTier(tier);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get procedure by ID' })
  async getProcedureById(@Param('id') id: string) {
    return this.proceduresService.getProcedureById(id);
  }
}
