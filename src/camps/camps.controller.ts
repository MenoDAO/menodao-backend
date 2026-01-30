import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { CampsService } from './camps.service';
import {
  CreateCampDto,
  UpdateCampDto,
  AssignMemberDto,
} from './dto/create-camp.dto';
import { StaffAuthGuard } from '../staff/guards/staff-auth.guard';

@ApiTags('Camps')
@Controller('camps')
@UseGuards(StaffAuthGuard)
@ApiBearerAuth()
export class CampsController {
  constructor(private readonly campsService: CampsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new camp' })
  create(@Body() createCampDto: CreateCampDto) {
    return this.campsService.create(createCampDto);
  }

  @Get()
  @ApiOperation({ summary: 'List all camps' })
  findAll() {
    return this.campsService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get camp details' })
  findOne(@Param('id') id: string) {
    return this.campsService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a camp' })
  update(@Param('id') id: string, @Body() updateCampDto: UpdateCampDto) {
    return this.campsService.update(id, updateCampDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete or deactivate a camp' })
  remove(@Param('id') id: string) {
    return this.campsService.remove(id);
  }

  @Post(':id/assign')
  @ApiOperation({ summary: 'Assign a member to a camp' })
  assignMember(@Param('id') id: string, @Body() dto: AssignMemberDto) {
    return this.campsService.assignMember(id, dto.memberId);
  }
}
