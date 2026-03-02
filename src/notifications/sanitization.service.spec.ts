import { Test, TestingModule } from '@nestjs/testing';
import { SanitizationService } from './sanitization.service';

describe('SanitizationService', () => {
  let service: SanitizationService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SanitizationService],
    }).compile();

    service = module.get<SanitizationService>(SanitizationService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('containsSensitiveContent', () => {
    it('should detect "password" (case-insensitive)', () => {
      expect(service.containsSensitiveContent('Your password is 12345')).toBe(
        true,
      );
      expect(service.containsSensitiveContent('PASSWORD: secret123')).toBe(
        true,
      );
      expect(service.containsSensitiveContent('Reset your Password here')).toBe(
        true,
      );
    });

    it('should detect "otp" and "one-time password" (case-insensitive)', () => {
      expect(service.containsSensitiveContent('Your OTP is 123456')).toBe(true);
      expect(service.containsSensitiveContent('otp: 654321')).toBe(true);
      expect(
        service.containsSensitiveContent('Your one-time password is 999999'),
      ).toBe(true);
    });

    it('should detect "pin" and "PIN code" (case-insensitive)', () => {
      expect(service.containsSensitiveContent('Your PIN is 1234')).toBe(true);
      expect(service.containsSensitiveContent('Enter your pin')).toBe(true);
      expect(service.containsSensitiveContent('PIN code: 5678')).toBe(true);
    });

    it('should detect "verification code" patterns', () => {
      expect(
        service.containsSensitiveContent('Your verification code is 123456'),
      ).toBe(true);
      expect(service.containsSensitiveContent('Code: 1234')).toBe(true);
      expect(service.containsSensitiveContent('Use code 98765')).toBe(true);
    });

    it('should return false for non-sensitive content', () => {
      expect(service.containsSensitiveContent('Welcome to our service!')).toBe(
        false,
      );
      expect(
        service.containsSensitiveContent('Your appointment is confirmed'),
      ).toBe(false);
      expect(service.containsSensitiveContent('Thank you for joining')).toBe(
        false,
      );
    });
  });

  describe('sanitizeMessage', () => {
    it('should return "[PROTECTED]" for messages with sensitive content', () => {
      expect(service.sanitizeMessage('Your password is 12345')).toBe(
        '[PROTECTED]',
      );
      expect(service.sanitizeMessage('OTP: 123456')).toBe('[PROTECTED]');
      expect(service.sanitizeMessage('Your PIN is 1234')).toBe('[PROTECTED]');
      expect(service.sanitizeMessage('Verification code: 999999')).toBe(
        '[PROTECTED]',
      );
    });

    it('should return original message for non-sensitive content', () => {
      const message = 'Welcome to our service!';
      expect(service.sanitizeMessage(message)).toBe(message);

      const message2 = 'Your appointment is confirmed';
      expect(service.sanitizeMessage(message2)).toBe(message2);
    });
  });
});
