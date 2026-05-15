import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { of } from 'rxjs';
import { CaptchaService } from './captcha.service';

describe('CaptchaService', () => {
  let service: CaptchaService;
  let httpService: jest.Mocked<HttpService>;
  let configService: jest.Mocked<ConfigService>;

  beforeEach(async () => {
    httpService = {
      post: jest.fn(),
    } as unknown as jest.Mocked<HttpService>;

    configService = {
      get: jest.fn(),
    } as unknown as jest.Mocked<ConfigService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CaptchaService,
        { provide: HttpService, useValue: httpService },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get(CaptchaService);
  });

  it('is disabled when CAPTCHA_DISABLED is true', () => {
    configService.get.mockImplementation((key: string) => {
      if (key === 'CAPTCHA_DISABLED') return 'true';
      if (key === 'TURNSTILE_SECRET_KEY') return 'secret';
      return undefined;
    });
    expect(service.isEnabled()).toBe(false);
  });

  it('skips verification when disabled', async () => {
    configService.get.mockImplementation((key: string) => {
      if (key === 'CAPTCHA_DISABLED') return 'true';
      return undefined;
    });
    await expect(service.verify(undefined)).resolves.toBe(true);
    expect(httpService.post).not.toHaveBeenCalled();
  });

  it('verifies token with Turnstile API when enabled', async () => {
    configService.get.mockImplementation((key: string) => {
      if (key === 'TURNSTILE_SECRET_KEY') return 'secret-key';
      return undefined;
    });
    httpService.post.mockReturnValue(of({ data: { success: true } }));

    const result = await service.verify('valid-token', '127.0.0.1');

    expect(result).toBe(true);
    expect(httpService.post).toHaveBeenCalled();
  });

  it('rejects missing token when enabled', async () => {
    configService.get.mockImplementation((key: string) => {
      if (key === 'TURNSTILE_SECRET_KEY') return 'secret-key';
      return undefined;
    });

    await expect(service.verify(undefined)).resolves.toBe(false);
  });
});
