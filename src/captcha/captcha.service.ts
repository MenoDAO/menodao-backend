import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

interface TurnstileVerifyResponse {
  success: boolean;
  'error-codes'?: string[];
  challenge_ts?: string;
  hostname?: string;
}

@Injectable()
export class CaptchaService {
  private readonly logger = new Logger(CaptchaService.name);
  private readonly verifyUrl =
    'https://challenges.cloudflare.com/turnstile/v0/siteverify';

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
  ) {}

  isEnabled(): boolean {
    if (this.configService.get<string>('CAPTCHA_DISABLED') === 'true') {
      return false;
    }
    return !!this.configService.get<string>('TURNSTILE_SECRET_KEY');
  }

  async verify(token: string | undefined, remoteIp?: string): Promise<boolean> {
    if (!this.isEnabled()) {
      return true;
    }

    if (!token?.trim()) {
      return false;
    }

    const secret = this.configService.get<string>('TURNSTILE_SECRET_KEY');
    if (!secret) {
      return false;
    }

    try {
      const params = new URLSearchParams({
        secret,
        response: token.trim(),
      });
      if (remoteIp) {
        params.append('remoteip', remoteIp);
      }

      const { data } = await firstValueFrom(
        this.httpService.post<TurnstileVerifyResponse>(
          this.verifyUrl,
          params.toString(),
          {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            timeout: 10_000,
          },
        ),
      );

      if (!data.success) {
        this.logger.warn(
          `Turnstile verification failed: ${(data['error-codes'] ?? []).join(', ')}`,
        );
      }

      return data.success;
    } catch (error) {
      this.logger.error('Turnstile verification request failed', error);
      return false;
    }
  }
}
