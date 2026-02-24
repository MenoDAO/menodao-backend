import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

export interface SasaPayTokenResponse {
  status: boolean;
  detail: string;
  access_token: string;
  expires_in: number;
  token_type: string;
  scope: string;
}

export interface SasaPayC2BRequest {
  MerchantCode: string;
  NetworkCode: string;
  PhoneNumber: string;
  TransactionDesc: string;
  AccountReference: string;
  Currency: string;
  Amount: number;
  CallBackURL: string;
}

export interface SasaPayC2BResponse {
  status: boolean;
  detail: string;
  MerchantRequestID?: string;
  CheckoutRequestID?: string;
  ResponseCode?: string;
  ResponseDescription?: string;
  CustomerMessage?: string;
}

export interface SasaPayB2CRequest {
  MerchantCode: string;
  MerchantTransactionReference: string;
  Currency: string;
  Amount: number;
  PaymentChannel: string;
  AccountNumber: string;
  TransactionDesc: string;
  CallBackURL: string;
}

export interface SasaPayB2CResponse {
  status: boolean;
  detail: string;
  MerchantRequestID?: string;
  CheckoutRequestID?: string;
  ResponseCode?: string;
  ResponseDescription?: string;
}

export interface SasaPayC2BCallbackData {
  MerchantRequestID?: string;
  CheckoutRequestID?: string;
  ResultCode?: string;
  ResultDesc?: string;
  TransactionDate?: string;
  Amount?: number;
  MpesaReceiptNumber?: string;
  PhoneNumber?: string;
}

export interface SasaPayB2CCallbackData {
  MerchantRequestID?: string;
  CheckoutRequestID?: string;
  ResultCode?: string;
  ResultDesc?: string;
  TransactionDate?: string;
  Amount?: number;
  MpesaReceiptNumber?: string;
  ReceiverPhoneNumber?: string;
}

@Injectable()
export class SasaPayService {
  private readonly logger = new Logger(SasaPayService.name);

  // Token cache
  private accessToken: string | null = null;
  private tokenExpiresAt: number = 0;

  // Config
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly merchantCode: string;
  private readonly baseUrl: string;
  private readonly networkCode: string;
  private readonly isDevEnvironment: boolean;
  private readonly callbackBaseUrl: string;

  constructor(private configService: ConfigService) {
    this.clientId = this.configService.get<string>('SASAPAY_CLIENT_ID') || '';
    this.clientSecret =
      this.configService.get<string>('SASAPAY_CLIENT_SECRET') || '';
    this.merchantCode =
      this.configService.get<string>('SASAPAY_MERCHANT_CODE') || '';
    this.baseUrl =
      this.configService.get<string>('SASAPAY_BASE_URL') ||
      'https://sandbox.sasapay.app';
    this.networkCode =
      this.configService.get<string>('SASAPAY_NETWORK_CODE') || '63902';

    this.isDevEnvironment =
      this.configService.get('NODE_ENV') === 'development';

    // Dynamic callback URL based on environment
    if (this.isDevEnvironment) {
      this.callbackBaseUrl =
        this.configService.get<string>('API_BASE_URL_DEV') ||
        this.configService.get<string>('API_BASE_URL') ||
        'https://dev-api.menodao.org';
    } else {
      this.callbackBaseUrl =
        this.configService.get<string>('API_BASE_URL') ||
        'https://api.menodao.org';
    }

    this.logger.log(
      `SasaPay initialized: baseUrl=${this.baseUrl}, env=${this.isDevEnvironment ? 'dev' : 'prod'}, callbackBase=${this.callbackBaseUrl}`,
    );

    if (!this.clientId || !this.clientSecret) {
      this.logger.warn(
        'SasaPay credentials not configured — payment calls will fail',
      );
    }

    if (!this.merchantCode) {
      this.logger.warn(
        'SasaPay MerchantCode not configured — will need to be set before payments work',
      );
    }
  }

  /**
   * Check if SasaPay is properly configured
   */
  isConfigured(): boolean {
    return !!(this.clientId && this.clientSecret && this.merchantCode);
  }

  /**
   * Normalize phone number to Kenyan format (254XXXXXXXXX)
   */
  normalizePhoneNumber(phone: string): string {
    let normalized = phone.replace(/[\s\-()]/g, '');
    if (normalized.startsWith('0')) {
      normalized = '254' + normalized.substring(1);
    }
    if (!normalized.startsWith('254')) {
      normalized = '254' + normalized;
    }
    return normalized;
  }

  /**
   * Get OAuth2 access token with caching
   * Uses Basic Auth (base64 of CLIENT_ID:CLIENT_SECRET)
   */
  async getAccessToken(): Promise<string> {
    // Return cached token if still valid (refresh at 90% of TTL)
    const now = Date.now();
    if (this.accessToken && now < this.tokenExpiresAt) {
      return this.accessToken;
    }

    this.logger.log('Fetching new SasaPay access token...');

    try {
      const credentials = Buffer.from(
        `${this.clientId}:${this.clientSecret}`,
      ).toString('base64');

      const response = await axios.get<SasaPayTokenResponse>(
        `${this.baseUrl}/api/v1/auth/token/?grant_type=client_credentials`,
        {
          headers: {
            Authorization: `Basic ${credentials}`,
          },
        },
      );

      const data = response.data;

      if (!data.status || !data.access_token) {
        throw new Error(
          `Token request failed: ${data.detail || 'Unknown error'}`,
        );
      }

      this.accessToken = data.access_token;
      // Cache token, expire at 90% of TTL to avoid edge-case expiry
      const ttlMs = (data.expires_in || 3600) * 1000;
      this.tokenExpiresAt = now + ttlMs * 0.9;

      this.logger.log(`SasaPay token obtained, expires in ${data.expires_in}s`);

      return this.accessToken;
    } catch (error) {
      this.accessToken = null;
      this.tokenExpiresAt = 0;

      if (axios.isAxiosError(error) && error.response) {
        const errorData = error.response.data as Record<string, any>;
        this.logger.error(
          `SasaPay auth failed [${error.response.status}]: ${JSON.stringify(errorData)}`,
        );
        throw new Error(
          `SasaPay authentication failed: ${errorData?.detail || error.response.statusText}`,
        );
      }

      const errorMessage = (error as Error).message || 'Unknown error';
      this.logger.error(`SasaPay auth error: ${errorMessage}`);
      throw new Error(`SasaPay authentication failed: ${errorMessage}`);
    }
  }

  /**
   * C2B: Request payment from customer via M-Pesa STK Push
   */
  async requestPayment(
    phoneNumber: string,
    amount: number,
    accountReference: string,
    description: string,
  ): Promise<SasaPayC2BResponse> {
    const token = await this.getAccessToken();
    const normalizedPhone = this.normalizePhoneNumber(phoneNumber);
    const callbackUrl = `${this.callbackBaseUrl}/contributions/callback`;

    const requestBody: SasaPayC2BRequest = {
      MerchantCode: this.merchantCode,
      NetworkCode: this.networkCode,
      PhoneNumber: normalizedPhone,
      TransactionDesc: description,
      AccountReference: accountReference,
      Currency: 'KES',
      Amount: Math.round(amount),
      CallBackURL: callbackUrl,
    };

    this.logger.log(
      `C2B STK Push: phone=${normalizedPhone}, amount=${amount}, ref=${accountReference}, callback=${callbackUrl}`,
    );

    try {
      const response = await axios.post<SasaPayC2BResponse>(
        `${this.baseUrl}/api/v1/payments/request-payment/`,
        requestBody,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        },
      );

      const data = response.data;
      this.logger.log(
        `C2B response: status=${data.status}, detail=${data.detail}, CheckoutRequestID=${data.CheckoutRequestID}`,
      );

      return data;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response) {
        const errorData = error.response.data as Record<string, any>;
        this.logger.error(
          `C2B request failed [${error.response.status}]: ${JSON.stringify(errorData)}`,
        );
        return {
          status: false,
          detail:
            errorData?.detail || errorData?.message || 'Payment request failed',
        };
      }

      const errorMessage = (error as Error).message || 'Unknown error';
      this.logger.error(`C2B request error: ${errorMessage}`);
      return {
        status: false,
        detail: `Payment request failed: ${errorMessage}`,
      };
    }
  }

  /**
   * B2C: Send money to customer (disbursal)
   */
  async sendMoney(
    phoneNumber: string,
    amount: number,
    transactionReference: string,
    description: string,
  ): Promise<SasaPayB2CResponse> {
    const token = await this.getAccessToken();
    const normalizedPhone = this.normalizePhoneNumber(phoneNumber);
    const callbackUrl = `${this.callbackBaseUrl}/contributions/callback`;

    const requestBody: SasaPayB2CRequest = {
      MerchantCode: this.merchantCode,
      MerchantTransactionReference: transactionReference,
      Currency: 'KES',
      Amount: Math.round(amount),
      PaymentChannel: this.networkCode,
      AccountNumber: normalizedPhone,
      TransactionDesc: description,
      CallBackURL: callbackUrl,
    };

    this.logger.log(
      `B2C Send: phone=${normalizedPhone}, amount=${amount}, ref=${transactionReference}, callback=${callbackUrl}`,
    );

    try {
      const response = await axios.post<SasaPayB2CResponse>(
        `${this.baseUrl}/api/v1/payments/b2c/`,
        requestBody,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        },
      );

      const data = response.data;
      this.logger.log(
        `B2C response: status=${data.status}, detail=${data.detail}, MerchantRequestID=${data.MerchantRequestID}`,
      );

      return data;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response) {
        const errorData = error.response.data as Record<string, any>;
        this.logger.error(
          `B2C request failed [${error.response.status}]: ${JSON.stringify(errorData)}`,
        );
        return {
          status: false,
          detail:
            errorData?.detail ||
            errorData?.message ||
            'Disbursal request failed',
        };
      }

      const errorMessage = (error as Error).message || 'Unknown error';
      this.logger.error(`B2C request error: ${errorMessage}`);
      return {
        status: false,
        detail: `Disbursal request failed: ${errorMessage}`,
      };
    }
  }
}
