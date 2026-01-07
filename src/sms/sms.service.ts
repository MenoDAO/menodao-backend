import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

export interface SMSResult {
  success: boolean;
  messageId?: string;
  error?: string;
  responseCode?: number | string;
}

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);

  constructor(private configService: ConfigService) {}

  /**
   * Normalize phone number to Kenyan format (254XXXXXXXXX)
   */
  private normalizePhoneNumber(phone: string): string {
    let normalized = phone.replace(/[\s\-\(\)]/g, ''); // Remove spaces, dashes, parentheses
    normalized = normalized.replace(/^\+/, ''); // Remove leading +

    // If starts with 0, replace with 254
    if (normalized.startsWith('0')) {
      normalized = '254' + normalized.substring(1);
    }

    // If doesn't start with 254, add it
    if (!normalized.startsWith('254')) {
      normalized = '254' + normalized;
    }

    return normalized;
  }

  /**
   * Send SMS via TextSMS.co.ke provider
   * API docs: https://textsms.co.ke
   */
  async sendSms(phoneNumber: string, message: string): Promise<SMSResult> {
    const providerUrl = this.configService.get<string>('SMS_PROVIDER_URL');
    const apiKey = this.configService.get<string>('SMS_PROVIDER_API_KEY');
    const partnerId = this.configService.get<string>('SMS_PROVIDER_PARTNER_ID');
    const shortcode = this.configService.get<string>('SMS_SENDER_ID') || 'MenoDAO';
    const nodeEnv = this.configService.get<string>('NODE_ENV');

    // In development, just log the message (unless SMS is explicitly configured)
    if (nodeEnv === 'development' && !providerUrl) {
      this.logger.log(`[DEV SMS] To: ${phoneNumber}, Message: ${message}`);
      return { success: true, messageId: `dev-${Date.now()}` };
    }

    // Validate configuration
    if (!providerUrl || providerUrl.trim() === '') {
      this.logger.warn('SMS_PROVIDER_URL not configured');
      return {
        success: false,
        error: 'SMS service is not configured. Please contact support.',
      };
    }

    if (!apiKey || apiKey.trim() === '') {
      this.logger.warn('SMS_PROVIDER_API_KEY not configured');
      return {
        success: false,
        error: 'SMS API key is not configured. Please contact support.',
      };
    }

    if (!partnerId || partnerId.trim() === '') {
      this.logger.warn('SMS_PROVIDER_PARTNER_ID not configured');
      return {
        success: false,
        error: 'SMS partner ID is not configured. Please contact support.',
      };
    }

    try {
      // Normalize phone number to 254XXXXXXXXX format
      const normalizedPhone = this.normalizePhoneNumber(phoneNumber);

      // Prepare SMS data for TextSMS.co.ke provider
      const smsData = {
        apikey: apiKey,
        partnerID: partnerId,
        mobile: normalizedPhone,
        message: message,
        shortcode: shortcode,
        pass_type: 'plain',
      };

      this.logger.log(`Sending SMS to ${normalizedPhone}`);
      this.logger.debug(`SMS Data: ${JSON.stringify({
        mobile: smsData.mobile,
        shortcode: smsData.shortcode,
        messageLength: message.length,
      })}`);

      // Send POST request to provider
      const response = await axios.post(providerUrl, smsData, {
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: 30000, // 30 seconds timeout
      });

      this.logger.debug(`SMS Response: ${JSON.stringify(response.data)}`);

      // Parse provider response
      // Expected format: { responses: [{ "response-code": 200, "response-description": "Success", "mobile": "254...", "messageid": "...", "networkid": 1 }] }
      if (response.data.responses && Array.isArray(response.data.responses)) {
        const smsResponse = response.data.responses[0];

        if (
          smsResponse['response-code'] === 200 ||
          smsResponse['response-code'] === '200'
        ) {
          this.logger.log(`SMS sent successfully to ${normalizedPhone}. Message ID: ${smsResponse.messageid}`);
          return {
            success: true,
            messageId: smsResponse.messageid || String(Date.now()),
            responseCode: smsResponse['response-code'],
          };
        } else {
          const errorDesc = smsResponse['response-description'] || 'SMS sending failed';
          this.logger.error(`SMS failed: ${errorDesc} (code: ${smsResponse['response-code']})`);
          return {
            success: false,
            error: this.mapProviderError(smsResponse['response-code'], errorDesc),
            responseCode: smsResponse['response-code'],
          };
        }
      } else if (response.data.success || response.data.status === 'success') {
        // Fallback for alternative response format
        this.logger.log(`SMS sent successfully to ${normalizedPhone}`);
        return {
          success: true,
          messageId: response.data.messageId || response.data.id || String(Date.now()),
        };
      } else {
        const errorMessage = response.data.error || response.data.message || 'Unexpected response format';
        this.logger.error(`SMS failed: ${errorMessage}`);
        return {
          success: false,
          error: errorMessage,
        };
      }
    } catch (error) {
      this.logger.error(`SMS sending error: ${error.message}`);

      if (axios.isAxiosError(error)) {
        if (error.code === 'ECONNABORTED') {
          return {
            success: false,
            error: 'SMS service timeout. Please try again later.',
          };
        }

        if (error.response) {
          const errorMessage =
            error.response.data?.message ||
            error.response.data?.error ||
            `SMS service error (${error.response.status})`;
          return {
            success: false,
            error: errorMessage,
          };
        }

        if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
          return {
            success: false,
            error: 'SMS service unavailable. Please try again later.',
          };
        }
      }

      return {
        success: false,
        error: 'Failed to send SMS. Please try again later.',
      };
    }
  }

  /**
   * Map provider error codes to user-friendly messages
   */
  private mapProviderError(code: number | string, description: string): string {
    const codeNum = typeof code === 'string' ? parseInt(code, 10) : code;

    switch (codeNum) {
      case 401:
        return 'SMS authentication failed. Please contact support.';
      case 402:
        return 'Insufficient SMS credits. Please contact support.';
      case 403:
        return 'Invalid sender ID. Please contact support.';
      case 404:
        return 'Invalid phone number format.';
      case 405:
        return 'Message content is invalid or too long.';
      case 429:
        return 'Too many SMS requests. Please wait and try again.';
      case 500:
      case 502:
      case 503:
        return 'SMS service temporarily unavailable. Please try again later.';
      default:
        return description || 'SMS sending failed. Please try again.';
    }
  }

  /**
   * Send OTP code via SMS
   */
  async sendOtp(phoneNumber: string, code: string): Promise<SMSResult> {
    const message = `Your MenoDAO verification code is: ${code}. Valid for 5 minutes. Do not share this code.`;
    return this.sendSms(phoneNumber, message);
  }

  /**
   * Send welcome SMS after successful registration
   */
  async sendWelcome(phoneNumber: string, name?: string): Promise<SMSResult> {
    const greeting = name ? `Hello ${name}` : 'Hello';
    const message = `${greeting}! Welcome to MenoDAO. Your dental health membership is now active. Download the app or visit menodao.org to get started.`;
    return this.sendSms(phoneNumber, message);
  }

  /**
   * Send subscription confirmation SMS
   */
  async sendSubscriptionConfirmation(
    phoneNumber: string,
    tier: string,
    amount: number,
  ): Promise<SMSResult> {
    const message = `Your MenoDAO ${tier} subscription is now active! Monthly contribution: KES ${amount}. Thank you for joining the dental health community.`;
    return this.sendSms(phoneNumber, message);
  }

  /**
   * Send payment reminder SMS
   */
  async sendPaymentReminder(
    phoneNumber: string,
    amount: number,
    dueDate: string,
  ): Promise<SMSResult> {
    const message = `Reminder: Your MenoDAO contribution of KES ${amount} is due on ${dueDate}. Pay now to maintain your membership benefits.`;
    return this.sendSms(phoneNumber, message);
  }

  /**
   * Send claim status update SMS
   */
  async sendClaimUpdate(
    phoneNumber: string,
    status: string,
    claimType: string,
  ): Promise<SMSResult> {
    const message = `Your MenoDAO ${claimType} claim has been ${status.toLowerCase()}. Check the app for details.`;
    return this.sendSms(phoneNumber, message);
  }
}
