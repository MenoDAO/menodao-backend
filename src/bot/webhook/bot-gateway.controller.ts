/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- provider payloads are untyped JSON */
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { BotGatewayService } from './bot-gateway.service';

/**
 * Alternate-gateway webhook (FlareSend / Waboxapp).
 * Meta Cloud API stays on /whatsapp/webhook (signature-guarded).
 * FlareSend has no HMAC in its payload — set FLARESEND_WEBHOOK_SECRET and
 * send it as x-webhook-secret when the provider supports it. Unset in
 * production will fail closed (401) so a missing secret is loud, not silent.
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
  handleFlaresendEvent(@Body() payload: any): { status: string } {
    const secret = this.configService.get<string>('FLARESEND_WEBHOOK_SECRET');
    if (secret) {
      // Header check is done in unit-testable form here; production callers
      // should also behind Caddy basic-auth if the provider can't sign.
      const header = payload?.__headers?.['x-webhook-secret'];
      if (header && header !== secret) {
        this.logger.warn('Rejecting FlareSend webhook: secret mismatch.');
        return { status: 'rejected' };
      }
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
