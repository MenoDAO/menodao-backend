import {
  Injectable,
  CanActivate,
  ExecutionContext,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';

@Injectable()
export class WebhookSignatureGuard implements CanActivate {
  private readonly logger = new Logger(WebhookSignatureGuard.name);

  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();

    const signature = request.headers['x-hub-signature-256'] as string;
    if (!signature) {
      this.logger.warn('Missing X-Hub-Signature-256 header');
      return false;
    }

    const rawBody: Buffer = request.rawBody;
    if (!rawBody || rawBody.length === 0) {
      this.logger.warn('Missing or empty raw body for signature validation');
      return false;
    }

    const appSecret = this.configService.get<string>('WHATSAPP_APP_SECRET');
    if (!appSecret) {
      this.logger.error('WHATSAPP_APP_SECRET is not configured');
      return false;
    }

    const expectedSignature =
      'sha256=' + createHmac('sha256', appSecret).update(rawBody).digest('hex');

    try {
      const sigBuffer = Buffer.from(signature);
      const expectedBuffer = Buffer.from(expectedSignature);

      // Buffers must be same length for timingSafeEqual
      if (sigBuffer.length !== expectedBuffer.length) {
        this.logger.warn('Signature length mismatch — possible tampering');
        return false;
      }

      const isValid = timingSafeEqual(sigBuffer, expectedBuffer);
      if (!isValid) {
        this.logger.warn('Invalid webhook signature');
      }
      return isValid;
    } catch {
      this.logger.error('Error during signature comparison');
      return false;
    }
  }
}
