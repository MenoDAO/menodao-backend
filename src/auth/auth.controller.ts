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
  @ApiOperation({ summary: 'Request OTP code sent to phone number' })
  async requestOtp(@Body() dto: RequestOtpDto) {
    return this.authService.requestOtp(
      dto.phoneNumber,
      dto.createIfNotExists || false,
      dto.fullName,
      dto.location,
    );
  }

  @Post('verify-otp')
  @ApiOperation({ summary: 'Verify OTP and get access token' })
  async verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.authService.verifyOtp(dto.phoneNumber, dto.code);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current authenticated member' })
  async getMe(@Request() req) {
    return req.user;
  }
}
