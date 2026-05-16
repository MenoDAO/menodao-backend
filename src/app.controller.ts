import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('health')
  getHealth(): {
    status: string;
    timestamp: string;
    environment: string;
    version: string;
    gitSha?: string;
    captchaEnabled: boolean;
  } {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      version: process.env.npm_package_version || '0.0.1',
      gitSha: process.env.GIT_SHA,
      captchaEnabled:
        process.env.CAPTCHA_DISABLED !== 'true' &&
        !!process.env.TURNSTILE_SECRET_KEY,
    };
  }
}
