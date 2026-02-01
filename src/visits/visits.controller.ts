import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { VisitsService } from './visits.service';
import { StaffAuthGuard } from '../staff/guards/staff-auth.guard';
import { CheckInDto } from './dto/check-in.dto';
import { AddProcedureDto } from './dto/add-procedure.dto';

interface RequestWithStaff extends Request {
  staff: {
    id: string;
    username: string;
    role: string;
  };
}

@ApiTags('Visits')
@Controller('visits')
@UseGuards(StaffAuthGuard)
@ApiBearerAuth()
export class VisitsController {
  constructor(private visitsService: VisitsService) {}

  @Post('search')
  @ApiOperation({ summary: 'Search member by phone number' })
  async searchMember(@Body() dto: CheckInDto) {
    return this.visitsService.searchMember(dto.phoneNumber);
  }

  @Post('check-in')
  @ApiOperation({ summary: 'Check-in a patient (create open visit)' })
  async checkIn(@Body() dto: CheckInDto, @Request() req: RequestWithStaff) {
    return this.visitsService.checkIn(dto, req.staff.id);
  }

  @Get('open/:memberId')
  @ApiOperation({ summary: 'Get open visit for a member' })
  async getOpenVisit(@Param('memberId') memberId: string) {
    return this.visitsService.getOpenVisit(memberId);
  }

  @Post('add-procedure')
  @ApiOperation({ summary: 'Add a procedure to an open visit' })
  async addProcedure(
    @Body() dto: AddProcedureDto,
    @Request() req: RequestWithStaff,
  ) {
    return this.visitsService.addProcedure(
      dto.visitId,
      dto.procedureId,
      req.staff.id,
    );
  }

  @Post('discharge/:visitId')
  @ApiOperation({
    summary: 'Discharge a visit (close visit, create claims, send SMS)',
  })
  async dischargeVisit(@Param('visitId') visitId: string) {
    return this.visitsService.dischargeVisit(visitId);
  }
}
