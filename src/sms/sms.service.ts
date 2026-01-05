import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);

  constructor(private configService: ConfigService) {}

  /**
   * Send SMS via custom provider
   * Configure your provider's API structure here
   */
  async sendSms(phoneNumber: string, message: string): Promise<boolean> {
    const providerUrl = this.configService.get<string>('SMS_PROVIDER_URL');
    const apiKey = this.configService.get<string>('SMS_PROVIDER_API_KEY');
    const senderId = this.configService.get<string>('SMS_SENDER_ID');

    // In development, just log the message
    if (this.configService.get<string>('NODE_ENV') === 'development') {
      this.logger.log(`[DEV SMS] To: ${phoneNumber}, Message: ${message}`);
      return true;
    }

    if (!providerUrl || !apiKey) {
      this.logger.warn('SMS provider not configured');
      return false;
    }

    try {
      // Customize this based on your SMS provider's API structure
      const response = await axios.post(
        providerUrl,
        {
          to: phoneNumber,
          message: message,
          sender_id: senderId,
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
        },
      );

      this.logger.log(`SMS sent to ${phoneNumber}: ${response.data}`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to send SMS to ${phoneNumber}:`, error.message);
      return false;
    }
  }

  /**
   * Send OTP code
   */
  async sendOtp(phoneNumber: string, code: string): Promise<boolean> {
    const message = `Your MenoDAO verification code is: ${code}. Valid for 5 minutes. Do not share this code.`;
    return this.sendSms(phoneNumber, message);
  }
}
