import {
  Controller,
  Post,
  Get,
  Body,
  UseGuards,
  Request,
  HttpCode,
  ForbiddenException,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiBody } from '@nestjs/swagger';
import { StaffService } from './staff.service';
import { StaffAuthGuard } from './guards/staff-auth.guard';
import { StaffLoginDto, ChangePasswordDto } from './dto/staff-login.dto';
import { EnrollStaffDto } from './dto/enroll-staff.dto';
import { StaffRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';

interface AuthenticatedRequest extends Request {
  staff: {
    id: string;
    username: string;
    fullName: string;
    role: StaffRole;
    branch?: string;
  };
}

@ApiTags('Staff')
@Controller('staff')
export class StaffController {
  constructor(private staffService: StaffService) {}

  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Staff login' })
  @ApiBody({ type: StaffLoginDto })
  async login(@Body() dto: StaffLoginDto) {
    return this.staffService.login(dto.username, dto.password);
  }

  @Get('profile')
  @UseGuards(StaffAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get staff profile' })
  async getProfile(@Request() req: AuthenticatedRequest) {
    return this.staffService.getProfile(req.staff.id);
  }

  @Get('users')
  @UseGuards(StaffAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all staff users (Admin only)' })
  async getUsers(
    @Request() req: AuthenticatedRequest,
    @Query('branch') branch?: string,
    @Query('role') role?: StaffRole,
  ) {
    if (req.staff.role !== StaffRole.ADMIN) {
      throw new ForbiddenException('Only admin staff can view staff list');
    }
    return this.staffService.getStaffUsers({ branch, role });
  }

  @Get('stats')
  @UseGuards(StaffAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get staff dashboard stats' })
  async getStats(@Request() req: AuthenticatedRequest) {
    return this.staffService.getStaffStats(req.staff.id);
  }

  @Get('members')
  @UseGuards(StaffAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all members (Staff access)' })
  async getMembers(
    @Request() req: AuthenticatedRequest,
    @Query('branch') branch?: string,
  ) {
    return this.staffService.getMembers({ branch });
  }

  @Post('enroll')
  @UseGuards(StaffAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Enroll a new staff member (Admin only)' })
  async enroll(
    @Request() req: AuthenticatedRequest,
    @Body() dto: EnrollStaffDto,
  ) {
    if (req.staff.role !== StaffRole.ADMIN) {
      throw new ForbiddenException('Only admin staff can enroll new staff');
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);
    return this.staffService.enrollStaff({
      username: dto.username,
      passwordHash,
      fullName: dto.fullName,
      role: dto.role,
      branch: dto.branch,
    });
  }

  @Post('bulk-sms')
  @UseGuards(StaffAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Send bulk SMS to members' })
  async sendBulkSms(@Body() dto: { phoneNumbers: string[]; message: string }) {
    return await this.staffService.sendBulkSms(dto.phoneNumbers, dto.message);
  }

  @Post('change-password')
  @UseGuards(StaffAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Change staff password' })
  @ApiBody({ type: ChangePasswordDto })
  async changePassword(
    @Request() req: AuthenticatedRequest,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.staffService.changePassword(
      req.staff.id,
      dto.currentPassword,
      dto.newPassword,
    );
  }
}
