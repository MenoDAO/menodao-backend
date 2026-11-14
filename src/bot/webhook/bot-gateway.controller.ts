/* eslint-disable @typescript-eslint/no-unsafe-member-access -- provider payloads are untyped JSON */
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
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
 * FlareSend does not sign its webhooks and sends no secret header: the only
 * thing you configure per instance is the endpoint URL. So the URL carries the
 * credential:
 *
 *   POST /bot/webhook/flaresend/:token
 *
 * The token is compared in constant time against
 * FLARESEND_WEBHOOK_PATH_TOKEN. When FLARESEND_INSTANCE_ID is set, events for
 * any other instance are rejected too. A missing token fails closed, so an
 * unprotected endpoint is loud rather than silent.
 */
@ApiTags('Bot Webhook')
@Controller('bot/webhook')
export class BotGatewayController {
  private readonly logger = new Logger(BotGatewayController.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly gateway: BotGatewayService,
  ) {}

  @Post('flaresend/:token')
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  handleFlaresendEvent(
    @Param('token') token: string,
    @Body() payload: any,
  ): { status: string } {
    const expected = this.configService.get<string>(
      'FLARESEND_WEBHOOK_PATH_TOKEN',
    );
    if (!expected) {
      this.logger.error(
        'Rejecting FlareSend webhook: FLARESEND_WEBHOOK_PATH_TOKEN is not configured.',
      );
      throw new UnauthorizedException('Webhook token not configured');
    }
    if (!token || !secretsMatch(token, expected)) {
      this.logger.warn('Rejecting FlareSend webhook: token mismatch.');
      throw new UnauthorizedException('Invalid webhook token');
    }

    const expectedInstance =
      this.configService.get<string>('FLARESEND_INSTANCE_ID');
    if (
      expectedInstance &&
      payload?.instanceId &&
      payload.instanceId !== expectedInstance
    ) {
      this.logger.warn(
        `Rejecting FlareSend webhook: unexpected instance ${payload.instanceId}.`,
      );
      throw new UnauthorizedException('Unknown instance');
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
