import {
  Controller,
  Post,
  Body,
  Get,
  UseGuards,
  Request,
  Param,
  HttpCode,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import type { Request as ExpressRequest } from 'express';
import { AuthService } from './auth.service';
import { RequestOtpDto } from './dto/request-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CaptchaGuard } from '../captcha/captcha.guard';
import { JwtCaptchaGuard } from '../captcha/guards/jwt-captcha.guard';
import { WebAuthnService } from '../webauthn/webauthn.service';
import {
  WebAuthnLoginOptionsDto,
  WebAuthnVerifyDto,
} from '../webauthn/webauthn.dto';
import {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private webauthn: WebAuthnService,
  ) {}

  @Post('check-phone')
  @ApiOperation({ summary: 'Check if phone number exists in system' })
  async checkPhone(@Body() dto: RequestOtpDto) {
    return this.authService.checkPhoneExists(dto.phoneNumber);
  }

  @Post('request-otp')
  @UseGuards(CaptchaGuard)
  @ApiOperation({ summary: 'Request OTP code sent to phone number' })
  async requestOtp(@Body() dto: RequestOtpDto) {
    return this.authService.requestOtp(
      dto.phoneNumber,
      dto.createIfNotExists || false,
      dto.fullName,
      dto.location,
      dto.referredBy,
    );
  }

  @Post('verify-otp')
  @UseGuards(CaptchaGuard)
  @ApiOperation({ summary: 'Verify OTP and get access token' })
  async verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.authService.verifyOtp(dto.phoneNumber, dto.code);
  }

  @Post('refresh-captcha')
  @UseGuards(JwtAuthGuard, CaptchaGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Verify CAPTCHA and refresh JWT with captchaVerified claim',
  })
  async refreshCaptcha(@Request() req) {
    return this.authService.refreshCaptchaSession(req.user.id);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard, JwtCaptchaGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current authenticated member' })
  async getMe(@Request() req) {
    const { captchaVerified: _, ...member } = req.user;
    return member;
  }

  @Post('webauthn/login/options')
  @HttpCode(200)
  @ApiOperation({ summary: 'Begin fingerprint / Face ID login for members' })
  webauthnLoginOptions(
    @Body() dto: WebAuthnLoginOptionsDto,
    @Request() req: ExpressRequest,
  ) {
    return this.webauthn.authenticationOptions(
      'member',
      dto?.username,
      originOf(req),
    );
  }

  @Post('webauthn/login/verify')
  @HttpCode(200)
  @ApiOperation({ summary: 'Finish device biometric member login' })
  async webauthnLoginVerify(
    @Body() dto: WebAuthnVerifyDto,
    @Request() req: ExpressRequest,
  ) {
    const memberId = await this.webauthn.verifyAuthentication(
      'member',
      dto.credential as unknown as AuthenticationResponseJSON,
      originOf(req),
    );
    return this.authService.issueSessionById(memberId);
  }

  @Post('webauthn/register/options')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Begin registering this device for member biometric login',
  })
  async webauthnRegisterOptions(@Request() req) {
    const member = req.user;
    return this.webauthn.registrationOptions(
      'member',
      {
        id: member.id,
        username: member.phoneNumber,
        displayName: member.fullName || member.phoneNumber,
      },
      originOf(req),
    );
  }

  @Post('webauthn/register/verify')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Save this device passkey (public key only)' })
  webauthnRegisterVerify(@Request() req, @Body() dto: WebAuthnVerifyDto) {
    return this.webauthn.verifyRegistration(
      'member',
      req.user.id,
      dto.credential as unknown as RegistrationResponseJSON,
      originOf(req),
      dto.label,
    );
  }

  @Get('webauthn/credentials')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List devices registered for biometric login' })
  listWebauthn(@Request() req) {
    return this.webauthn.listCredentials('member', req.user.id);
  }

  @Post('webauthn/credentials/:id/delete')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(200)
  @ApiOperation({ summary: 'Remove a registered device' })
  deleteWebauthn(@Request() req, @Param('id') id: string) {
    return this.webauthn.deleteCredential('member', req.user.id, id);
  }
}

function originOf(req: ExpressRequest): string | undefined {
  const origin = req.headers.origin;
  if (typeof origin === 'string' && origin) return origin;
  const referer = req.headers.referer;
  return typeof referer === 'string' ? referer : undefined;
}
