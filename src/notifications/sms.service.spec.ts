import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SMSService, DeliveryResult } from './sms.service';

describe('SMSService', () => {
  let service: SMSService;
  let configService: ConfigService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SMSService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: any) => {
              // Default to mock provider for tests
              if (key === 'SMS_PROVIDER') {
                return 'mock';
              }
              return defaultValue;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<SMSService>(SMSService);
    configService = module.get<ConfigService>(ConfigService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('sendSMS with Mock Provider', () => {
    it('should successfully send SMS using mock provider', async () => {
      const result = await service.sendSMS('+1234567890', 'Test message');

      expect(result.success).toBe(true);
      expect(result.messageId).toBeDefined();
      expect(result.messageId).toMatch(/^mock-/);
      expect(result.timestamp).toBeInstanceOf(Date);
      expect(result.error).toBeUndefined();
    });

    it('should handle multiple SMS sends', async () => {
      const phones = ['+1234567890', '+0987654321', '+1111111111'];
      const results: DeliveryResult[] = [];

      for (const phone of phones) {
        const result = await service.sendSMS(phone, 'Test message');
        results.push(result);
      }

      expect(results).toHaveLength(3);
      results.forEach((result) => {
        expect(result.success).toBe(true);
        expect(result.messageId).toBeDefined();
      });
    });

    it('should handle empty message', async () => {
      const result = await service.sendSMS('+1234567890', '');

      // Mock provider accepts empty messages
      expect(result.success).toBe(true);
    });

    it('should handle long messages', async () => {
      const longMessage = 'A'.repeat(1600);
      const result = await service.sendSMS('+1234567890', longMessage);

      expect(result.success).toBe(true);
    });

    it('should generate unique message IDs', async () => {
      const result1 = await service.sendSMS('+1234567890', 'Message 1');
      const result2 = await service.sendSMS('+1234567890', 'Message 2');

      expect(result1.messageId).not.toBe(result2.messageId);
    });
  });

  describe('getProviderName', () => {
    it('should return MockSMSProvider for default configuration', () => {
      const providerName = service.getProviderName();
      expect(providerName).toBe('MockSMSProvider');
    });
  });

  describe('Provider initialization', () => {
    it('should fall back to mock provider when Twilio credentials are missing', async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          SMSService,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn((key: string, defaultValue?: any) => {
                if (key === 'SMS_PROVIDER') return 'twilio';
                // Missing credentials
                return defaultValue;
              }),
            },
          },
        ],
      }).compile();

      const smsService = module.get<SMSService>(SMSService);
      const providerName = smsService.getProviderName();

      expect(providerName).toBe('MockSMSProvider');
    });

    it('should fall back to mock provider when AWS SNS credentials are missing', async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          SMSService,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn((key: string, defaultValue?: any) => {
                if (key === 'SMS_PROVIDER') return 'aws-sns';
                // Missing credentials
                return defaultValue;
              }),
            },
          },
        ],
      }).compile();

      const smsService = module.get<SMSService>(SMSService);
      const providerName = smsService.getProviderName();

      expect(providerName).toBe('MockSMSProvider');
    });
  });

  describe('Error handling', () => {
    it('should handle unexpected errors gracefully', async () => {
      // Create a service with a provider that throws errors
      const mockProvider = {
        sendSMS: jest.fn().mockRejectedValue(new Error('Network error')),
      };

      // Replace the provider
      (service as any).provider = mockProvider;

      const result = await service.sendSMS('+1234567890', 'Test message');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Network error');
      expect(result.timestamp).toBeInstanceOf(Date);
    });
  });

  describe('Phone number formats', () => {
    it('should handle E.164 formatted phone numbers', async () => {
      const phones = [
        '+1234567890',
        '+44123456789',
        '+81234567890',
        '+861234567890',
      ];

      for (const phone of phones) {
        const result = await service.sendSMS(phone, 'Test');
        expect(result.success).toBe(true);
      }
    });

    it('should handle phone numbers without country code (mock provider)', async () => {
      // Mock provider doesn't validate format
      const result = await service.sendSMS('1234567890', 'Test');
      expect(result.success).toBe(true);
    });
  });

  describe('Message content', () => {
    it('should handle messages with special characters', async () => {
      const messages = [
        'Hello! How are you?',
        'Price: $100.00',
        'Emoji test: 😀🎉',
        'Newline\ntest',
        'Tab\ttest',
      ];

      for (const message of messages) {
        const result = await service.sendSMS('+1234567890', message);
        expect(result.success).toBe(true);
      }
    });

    it('should handle Unicode characters', async () => {
      const result = await service.sendSMS(
        '+1234567890',
        '你好世界 مرحبا بالعالم',
      );
      expect(result.success).toBe(true);
    });
  });

  describe('Delivery results', () => {
    it('should include timestamp in delivery result', async () => {
      const before = new Date();
      const result = await service.sendSMS('+1234567890', 'Test');
      const after = new Date();

      expect(result.timestamp.getTime()).toBeGreaterThanOrEqual(
        before.getTime(),
      );
      expect(result.timestamp.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('should include messageId on success', async () => {
      const result = await service.sendSMS('+1234567890', 'Test');

      expect(result.success).toBe(true);
      expect(result.messageId).toBeDefined();
      expect(typeof result.messageId).toBe('string');
      expect(result.messageId!.length).toBeGreaterThan(0);
    });

    it('should include error message on failure', async () => {
      const mockProvider = {
        sendSMS: jest.fn().mockResolvedValue({
          success: false,
          error: 'Invalid phone number',
          timestamp: new Date(),
        }),
      };

      (service as any).provider = mockProvider;

      const result = await service.sendSMS('+invalid', 'Test');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid phone number');
      expect(result.messageId).toBeUndefined();
    });
  });
});
