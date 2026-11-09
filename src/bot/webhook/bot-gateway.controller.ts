/* eslint-disable @typescript-eslint/no-unsafe-member-access -- provider payloads are untyped JSON */
import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { timingSafeEqual } from 'crypto';
import { BotGatewayService } from './bot-gateway.service';

function secretsMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Alternate-gateway webhook (FlareSend / Waboxapp).
 * Meta Cloud API stays on /whatsapp/webhook (signature-guarded).
 *
 * FlareSend payloads are not HMAC-signed, so set FLARESEND_WEBHOOK_SECRET and
 * have the provider send it as `x-webhook-secret`. In production a missing
 * secret fails closed (401) so an unprotected webhook is loud, not silent.
 */
@ApiTags('Bot Webhook')
@Controller('bot/webhook')
export class BotGatewayController {
  private readonly logger = new Logger(BotGatewayController.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly gateway: BotGatewayService,
  ) {}

  @Post('flaresend')
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  handleFlaresendEvent(
    @Body() payload: any,
    @Headers('x-webhook-secret') providedSecret?: string,
  ): { status: string } {
    const secret = this.configService.get<string>('FLARESEND_WEBHOOK_SECRET');
    if (!secret) {
      if (process.env.NODE_ENV === 'production') {
        this.logger.error(
          'Rejecting FlareSend webhook: FLARESEND_WEBHOOK_SECRET is not configured.',
        );
        throw new UnauthorizedException('Webhook secret not configured');
      }
      this.logger.warn(
        'FLARESEND_WEBHOOK_SECRET not set — accepting unsigned webhook (development only).',
      );
    } else if (!providedSecret || !secretsMatch(providedSecret, secret)) {
      this.logger.warn('Rejecting FlareSend webhook: secret mismatch.');
      throw new UnauthorizedException('Invalid webhook secret');
    }

    this.logger.log(
      `FlareSend webhook received: event=${payload?.event ?? 'unknown'}, senderType=${String(payload?.data?.from ?? '').endsWith('@lid') ? 'lid' : 'phone'}`,
    );
    this.gateway.processWebhookPayload(payload).catch((error) => {
      this.logger.error(
        `Unhandled error while processing webhook payload: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    });
    return { status: 'received' };
  }

  @Post('waboxapp')
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  handleWaboxappEvent(@Body() payload: any): { status: string } {
    // Waboxapp authenticates with a token inside the JSON body; the gateway
    // rejects the payload when WABOXAPP_API_TOKEN is missing or mismatched.
    this.logger.log(
      `Waboxapp webhook received: event=${payload?.event ?? 'unknown'}, messageId=${payload?.message?.uid ?? payload?.m?.uid ?? 'unknown'}`,
    );
    this.gateway.processWebhookPayload(payload).catch((error) => {
      this.logger.error(
        `Unhandled error while processing webhook payload: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    });
    return { status: 'received' };
  }
}
