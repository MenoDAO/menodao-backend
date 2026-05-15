import {
  Controller,
  Post,
  Body,
  Get,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { RequestOtpDto } from './dto/request-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CaptchaGuard } from '../captcha/captcha.guard';
import { JwtCaptchaGuard } from '../captcha/guards/jwt-captcha.guard';
@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

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
}
