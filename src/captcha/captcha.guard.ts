import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CaptchaService } from './captcha.service';
import { SKIP_CAPTCHA_KEY } from './decorators/skip-captcha.decorator';

@Injectable()
export class CaptchaGuard implements CanActivate {
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
    const token =
      request.body?.captchaToken ?? request.headers['x-captcha-token'];

    const remoteIp =
      request.ip ||
      request.headers['x-forwarded-for']?.split(',')[0]?.trim();

    const valid = await this.captchaService.verify(token, remoteIp);
    if (!valid) {
      throw new ForbiddenException({
        message: 'CAPTCHA verification failed. Please try again.',
        code: 'CAPTCHA_INVALID',
      });
    }

    return true;
  }
}
