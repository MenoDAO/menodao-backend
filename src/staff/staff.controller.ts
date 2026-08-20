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
  Param,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiBody } from '@nestjs/swagger';
import { StaffService } from './staff.service';
import { StaffAuthGuard } from './guards/staff-auth.guard';
import { StaffLoginDto, ChangePasswordDto } from './dto/staff-login.dto';
import { CaptchaGuard } from '../captcha/captcha.guard';
import { EnrollStaffDto } from './dto/enroll-staff.dto';
import { StaffRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import type { Request as ExpressRequest } from 'express';
import { WebAuthnService } from '../webauthn/webauthn.service';
import {
  WebAuthnLoginOptionsDto,
  WebAuthnVerifyDto,
} from '../webauthn/webauthn.dto';
import {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';

interface AuthenticatedRequest extends ExpressRequest {
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
  constructor(
    private staffService: StaffService,
    private webauthn: WebAuthnService,
  ) {}

  @Post('login')
  @HttpCode(200)
  @UseGuards(CaptchaGuard)
  @ApiOperation({ summary: 'Staff login' })
  @ApiBody({ type: StaffLoginDto })
  async login(@Body() dto: StaffLoginDto) {
    return this.staffService.login(dto.username, dto.password);
  }

  @Post('webauthn/login/options')
  @HttpCode(200)
  @ApiOperation({ summary: 'Begin fingerprint / Face ID / Windows Hello login' })
  async webauthnLoginOptions(
    @Body() dto: WebAuthnLoginOptionsDto,
    @Request() req: ExpressRequest,
  ) {
    return this.webauthn.authenticationOptions(
      'staff',
      dto?.username,
      originOf(req),
    );
  }

  @Post('webauthn/login/verify')
  @HttpCode(200)
  @ApiOperation({ summary: 'Finish device biometric staff login' })
  async webauthnLoginVerify(
    @Body() dto: WebAuthnVerifyDto,
    @Request() req: ExpressRequest,
  ) {
    const staffId = await this.webauthn.verifyAuthentication(
      'staff',
      dto.credential as unknown as AuthenticationResponseJSON,
      originOf(req),
    );
    return this.staffService.issueSessionById(staffId);
  }

  @Post('webauthn/register/options')
  @UseGuards(StaffAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Begin registering this device for biometric login' })
  async webauthnRegisterOptions(@Request() req: AuthenticatedRequest) {
    const profile = await this.staffService.getProfile(req.staff.id);
    if (!profile) throw new ForbiddenException('Staff not found');
    return this.webauthn.registrationOptions(
      'staff',
      {
        id: profile.id,
        username: profile.username,
        displayName: profile.fullName,
      },
      originOf(req),
    );
  }

  @Post('webauthn/register/verify')
  @UseGuards(StaffAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Save this device passkey (public key only)' })
  async webauthnRegisterVerify(
    @Request() req: AuthenticatedRequest,
    @Body() dto: WebAuthnVerifyDto,
  ) {
    return this.webauthn.verifyRegistration(
      'staff',
      req.staff.id,
      dto.credential as unknown as RegistrationResponseJSON,
      originOf(req),
      dto.label,
    );
  }

  @Get('webauthn/credentials')
  @UseGuards(StaffAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List devices registered for biometric login' })
  listWebauthn(@Request() req: AuthenticatedRequest) {
    return this.webauthn.listCredentials('staff', req.staff.id);
  }

  @Post('webauthn/credentials/:id/delete')
  @UseGuards(StaffAuthGuard)
  @ApiBearerAuth()
  @HttpCode(200)
  @ApiOperation({ summary: 'Remove a registered device' })
  deleteWebauthn(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.webauthn.deleteCredential('staff', req.staff.id, id);
  }

  @Post('refresh-captcha')
  @UseGuards(StaffAuthGuard, CaptchaGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Verify CAPTCHA and refresh staff JWT with captchaVerified claim',
  })
  async refreshCaptcha(@Request() req: AuthenticatedRequest) {
    return this.staffService.refreshCaptchaSession(req.staff.id);
  }

  @Get('profile')
  @UseGuards(StaffAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get staff profile' })
  async getProfile(@Request() req: AuthenticatedRequest) {
    return this.staffService.getProfile(req.staff.id);
  }

  @Get('activity')
  @UseGuards(StaffAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Recent activity for the logged-in staff member' })
  async getActivity(
    @Request() req: AuthenticatedRequest,
    @Query('limit') limit?: string,
  ) {
    return this.staffService.getActivity(req.staff.id, Number(limit) || 20);
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
  @ApiOperation({ summary: 'List members associated with this clinic' })
  async getMembers(
    @Request() req: AuthenticatedRequest,
    @Query('branch') branch?: string,
  ) {
    // Get staff details to check clinic association
    const staff = await this.staffService.getProfile(req.staff.id);

    // If staff belongs to a clinic, only show members who have visited that clinic
    // Otherwise show all members (for non-clinic staff)
    return this.staffService.getMembers({
      branch,
      clinicId: staff?.clinicId || undefined,
    });
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

  @Get('clinics')
  @UseGuards(StaffAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List approved clinics (staff view)' })
  async getClinics(@Request() req: AuthenticatedRequest) {
    return this.staffService.getClinics();
  }
}

function originOf(req: ExpressRequest): string | undefined {
  const origin = req.headers.origin;
  if (typeof origin === 'string' && origin) return origin;
  const referer = req.headers.referer;
  return typeof referer === 'string' ? referer : undefined;
}
