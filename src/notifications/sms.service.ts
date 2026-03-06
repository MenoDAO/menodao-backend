import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface DeliveryResult {
  success: boolean;
  messageId?: string;
  error?: string;
  timestamp: Date;
}

export interface SMSProvider {
  sendSMS(phone: string, message: string): Promise<DeliveryResult>;
}

/**
 * Mock SMS Provider for development and testing
 * Logs SMS sends without actually sending messages
 */
class MockSMSProvider implements SMSProvider {
  private readonly logger = new Logger('MockSMSProvider');

  async sendSMS(phone: string, message: string): Promise<DeliveryResult> {
    this.logger.log(`[MOCK SMS] To: ${phone}, Message: ${message}`);

    // Simulate network delay
    await new Promise((resolve) => setTimeout(resolve, 100));

    return {
      success: true,
      messageId: `mock-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date(),
    };
  }
}

/**
 * Twilio SMS Provider
 * Integrates with Twilio API for actual SMS delivery
 */
class TwilioSMSProvider implements SMSProvider {
  private readonly logger = new Logger('TwilioSMSProvider');
  private twilioClient: any;
  private fromNumber: string;

  constructor(accountSid: string, authToken: string, fromNumber: string) {
    // Lazy load Twilio SDK only if credentials are provided
    try {
      const twilio = require('twilio');
      this.twilioClient = twilio(accountSid, authToken);
      this.fromNumber = fromNumber;
      this.logger.log('Twilio SMS provider initialized');
    } catch (error) {
      this.logger.error(
        'Failed to initialize Twilio client. Install twilio package: npm install twilio',
      );
      throw error;
    }
  }

  async sendSMS(phone: string, message: string): Promise<DeliveryResult> {
    const maxRetries = 3;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const result = await this.twilioClient.messages.create({
          body: message,
          to: phone,
          from: this.fromNumber,
        });

        this.logger.log(
          `SMS sent successfully to ${phone}, SID: ${result.sid}`,
        );

        return {
          success: true,
          messageId: result.sid,
          timestamp: new Date(),
        };
      } catch (error) {
        lastError = error;
        this.logger.warn(
          `SMS send attempt ${attempt}/${maxRetries} failed for ${phone}: ${error.message}`,
        );

        // Don't retry on permanent failures
        if (this.isPermanentError(error)) {
          break;
        }

        // Exponential backoff for transient failures
        if (attempt < maxRetries) {
          const delay = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    return {
      success: false,
      error: lastError?.message || 'Unknown error',
      timestamp: new Date(),
    };
  }

  private isPermanentError(error: any): boolean {
    // Twilio error codes for permanent failures
    const permanentErrorCodes = [
      21211, // Invalid phone number
      21614, // Invalid phone number format
      21408, // Permission denied
    ];

    return permanentErrorCodes.includes(error.code);
  }
}

/**
 * AWS SNS SMS Provider
 * Integrates with AWS SNS for SMS delivery
 */
class AWSSNSSMSProvider implements SMSProvider {
  private readonly logger = new Logger('AWSSNSSMSProvider');
  private snsClient: any;

  constructor(region: string, accessKeyId: string, secretAccessKey: string) {
    try {
      const AWS = require('aws-sdk');
      this.snsClient = new AWS.SNS({
        region,
        accessKeyId,
        secretAccessKey,
      });
      this.logger.log('AWS SNS SMS provider initialized');
    } catch (error) {
      this.logger.error(
        'Failed to initialize AWS SNS client. Install aws-sdk package: npm install aws-sdk',
      );
      throw error;
    }
  }

  async sendSMS(phone: string, message: string): Promise<DeliveryResult> {
    const maxRetries = 3;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const params = {
          Message: message,
          PhoneNumber: phone,
          MessageAttributes: {
            'AWS.SNS.SMS.SMSType': {
              DataType: 'String',
              StringValue: 'Transactional',
            },
          },
        };

        const result = await this.snsClient.publish(params).promise();

        this.logger.log(
          `SMS sent successfully to ${phone}, MessageId: ${result.MessageId}`,
        );

        return {
          success: true,
          messageId: result.MessageId,
          timestamp: new Date(),
        };
      } catch (error) {
        lastError = error;
        this.logger.warn(
          `SMS send attempt ${attempt}/${maxRetries} failed for ${phone}: ${error.message}`,
        );

        // Don't retry on permanent failures
        if (error.code === 'InvalidParameter') {
          break;
        }

        // Exponential backoff for transient failures
        if (attempt < maxRetries) {
          const delay = Math.pow(2, attempt) * 1000;
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    return {
      success: false,
      error: lastError?.message || 'Unknown error',
      timestamp: new Date(),
    };
  }
}

/**
 * SMS Service
 * Handles SMS message delivery with support for multiple providers
 * Requirements: 3.11
 */
@Injectable()
export class SMSService {
  private readonly logger = new Logger(SMSService.name);
  private provider: SMSProvider;

  constructor(private configService: ConfigService) {
    this.initializeProvider();
  }

  private initializeProvider(): void {
    const smsProvider = this.configService.get<string>('SMS_PROVIDER', 'mock');

    switch (smsProvider.toLowerCase()) {
      case 'twilio':
        this.initializeTwilioProvider();
        break;
      case 'aws-sns':
      case 'sns':
        this.initializeAWSSNSProvider();
        break;
      case 'mock':
      default:
        this.provider = new MockSMSProvider();
        this.logger.log('Using Mock SMS provider (no actual SMS will be sent)');
        break;
    }
  }

  private initializeTwilioProvider(): void {
    const accountSid = this.configService.get<string>('TWILIO_ACCOUNT_SID');
    const authToken = this.configService.get<string>('TWILIO_AUTH_TOKEN');
    const fromNumber = this.configService.get<string>('TWILIO_PHONE_NUMBER');

    if (!accountSid || !authToken || !fromNumber) {
      this.logger.warn(
        'Twilio credentials not configured. Falling back to Mock provider.',
      );
      this.provider = new MockSMSProvider();
      return;
    }

    try {
      this.provider = new TwilioSMSProvider(accountSid, authToken, fromNumber);
    } catch (error) {
      this.logger.error(
        `Failed to initialize Twilio provider: ${error.message}. Falling back to Mock provider.`,
      );
      this.provider = new MockSMSProvider();
    }
  }

  private initializeAWSSNSProvider(): void {
    const region = this.configService.get<string>('AWS_REGION');
    const accessKeyId = this.configService.get<string>('AWS_ACCESS_KEY_ID');
    const secretAccessKey = this.configService.get<string>(
      'AWS_SECRET_ACCESS_KEY',
    );

    if (!region || !accessKeyId || !secretAccessKey) {
      this.logger.warn(
        'AWS SNS credentials not configured. Falling back to Mock provider.',
      );
      this.provider = new MockSMSProvider();
      return;
    }

    try {
      this.provider = new AWSSNSSMSProvider(
        region,
        accessKeyId,
        secretAccessKey,
      );
    } catch (error) {
      this.logger.error(
        `Failed to initialize AWS SNS provider: ${error.message}. Falling back to Mock provider.`,
      );
      this.provider = new MockSMSProvider();
    }
  }

  /**
   * Send SMS to a phone number
   * Implements retry logic for transient failures
   * Requirements: 3.11
   *
   * @param phone - Phone number in E.164 format (e.g., +1234567890)
   * @param message - Message content to send
   * @returns DeliveryResult with success status and details
   */
  async sendSMS(phone: string, message: string): Promise<DeliveryResult> {
    try {
      const result = await this.provider.sendSMS(phone, message);

      if (result.success) {
        this.logger.log(`SMS delivered successfully to ${phone}`);
      } else {
        this.logger.error(`SMS delivery failed to ${phone}: ${result.error}`);
      }

      return result;
    } catch (error) {
      this.logger.error(
        `Unexpected error sending SMS to ${phone}: ${error.message}`,
      );
      return {
        success: false,
        error: error.message,
        timestamp: new Date(),
      };
    }
  }

  /**
   * Get the current provider name for logging/debugging
   */
  getProviderName(): string {
    return this.provider.constructor.name;
  }
}
