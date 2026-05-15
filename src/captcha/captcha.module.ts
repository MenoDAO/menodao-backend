import { Global, Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { CaptchaService } from './captcha.service';
import { CaptchaGuard } from './captcha.guard';
import { JwtCaptchaGuard } from './guards/jwt-captcha.guard';
import { StaffJwtCaptchaGuard } from './guards/staff-jwt-captcha.guard';

@Global()
@Module({
  imports: [HttpModule],
  providers: [
    CaptchaService,
    CaptchaGuard,
    JwtCaptchaGuard,
    StaffJwtCaptchaGuard,
  ],
  exports: [
    CaptchaService,
    CaptchaGuard,
    JwtCaptchaGuard,
    StaffJwtCaptchaGuard,
  ],
})
export class CaptchaModule {}
