import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CaptchaService } from '../captcha.service';
import { SKIP_CAPTCHA_KEY } from '../decorators/skip-captcha.decorator';

/**
 * Requires a JWT issued after CAPTCHA verification (`captchaVerified: true`),
 * or a fresh Turnstile token in `x-captcha-token` / body `captchaToken`.
 */
@Injectable()
export class JwtCaptchaGuard implements CanActivate {
  constructor(
    private readonly captchaService: CaptchaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_CAPTCHA_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) {
      return true;
    }

    if (!this.captchaService.isEnabled()) {
      return true;
    }

    const request = context.switchToHttp().getRequest();

    if (request.user?.captchaVerified === true) {
      return true;
    }

    const headerToken =
      request.body?.captchaToken ?? request.headers['x-captcha-token'];
    if (headerToken) {
      const remoteIp =
        request.ip ||
        request.headers['x-forwarded-for']?.split(',')[0]?.trim();
      const valid = await this.captchaService.verify(headerToken, remoteIp);
      if (valid) {
        request.captchaVerified = true;
        return true;
      }
    }

    throw new ForbiddenException({
      message: 'CAPTCHA verification required',
      code: 'CAPTCHA_REQUIRED',
    });
  }
}
