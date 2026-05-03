import {
  Controller,
  Get,
  Post,
  Query,
  Body,
  Res,
  HttpStatus,
  UseGuards,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import type { Response } from 'express';
import { timingSafeEqual } from 'crypto';
import { firstValueFrom } from 'rxjs';

import { WhatsAppService } from './whatsapp.service';
import { SessionService } from './session.service';
import { WebhookSignatureGuard } from './guards/webhook-signature.guard';
import type { MetaWebhookPayload } from './dto/webhook.dto';

// ─── Query param shape for GET /whatsapp/webhook ──────────────────────────────

interface HubVerifyQuery {
  'hub.mode'?: string;
  'hub.verify_token'?: string;
  'hub.challenge'?: string;
}

// ─── Health check response shape ─────────────────────────────────────────────

interface ServiceHealth {
  status: 'ok' | 'error';
  latencyMs?: number;
  error?: string;
}

interface HealthResponse {
  status: 'ok' | 'error';
  whatsappApi: ServiceHealth;
  openaiApi: ServiceHealth;
  redis: ServiceHealth;
  timestamp: string;
}

// ─── Controller ───────────────────────────────────────────────────────────────

@Controller('whatsapp')
export class WhatsAppController {
  private readonly logger = new Logger(WhatsAppController.name);

  constructor(
    private readonly whatsappService: WhatsAppService,
    private readonly sessionService: SessionService,
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  // ─── GET /whatsapp/webhook — Meta hub verification ─────────────────────────

  @Get('webhook')
  verifyWebhook(@Query() query: HubVerifyQuery, @Res() res: Response): void {
    const mode = query['hub.mode'];
    const token = query['hub.verify_token'] ?? '';
    const challenge = query['hub.challenge'] ?? '';

    if (mode !== 'subscribe') {
      this.logger.warn(
        `[WhatsApp] Webhook verification failed: hub.mode="${mode}"`,
      );
      res.status(HttpStatus.FORBIDDEN).send();
      return;
    }

    const expectedToken =
      this.configService.get<string>('WHATSAPP_VERIFY_TOKEN') ?? '';

    // Constant-time comparison to prevent timing attacks
    let tokensMatch = false;
    try {
      const tokenBuf = Buffer.from(token);
      const expectedBuf = Buffer.from(expectedToken);
      if (tokenBuf.length === expectedBuf.length && expectedBuf.length > 0) {
        tokensMatch = timingSafeEqual(tokenBuf, expectedBuf);
      }
    } catch {
      tokensMatch = false;
    }

    if (!tokensMatch) {
      this.logger.warn(
        '[WhatsApp] Webhook verification failed: token mismatch',
      );
      res.status(HttpStatus.FORBIDDEN).send();
      return;
    }

    this.logger.log('[WhatsApp] Webhook verified successfully');
    res.status(HttpStatus.OK).type('text/plain').send(challenge);
  }

  // ─── POST /whatsapp/webhook — Inbound message events ──────────────────────

  @Post('webhook')
  @UseGuards(WebhookSignatureGuard)
  receiveWebhook(@Body() payload: MetaWebhookPayload): Record<string, never> {
    // Fire-and-forget: return 200 immediately, process async
    // All errors inside handleInbound are caught and never propagate
    void this.whatsappService.handleInbound(payload);
    return {};
  }

  // ─── GET /whatsapp/health — Dependency health probe ───────────────────────

  @Get('health')
  async healthCheck(@Res() res: Response): Promise<void> {
    const whatsappHealth = await this.probeWhatsAppApi();
    const openaiHealth = await this.probeOpenAiApi();
    const redisHealth = await this.probeRedis();

    const allOk =
      whatsappHealth.status === 'ok' &&
      openaiHealth.status === 'ok' &&
      redisHealth.status === 'ok';

    const body: HealthResponse = {
      status: allOk ? 'ok' : 'error',
      whatsappApi: whatsappHealth,
      openaiApi: openaiHealth,
      redis: redisHealth,
      timestamp: new Date().toISOString(),
    };

    res
      .status(allOk ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE)
      .json(body);
  }

  // ─── Health probe helpers ──────────────────────────────────────────────────

  private async probeWhatsAppApi(): Promise<ServiceHealth> {
    const phoneNumberId = this.configService.get<string>(
      'WHATSAPP_PHONE_NUMBER_ID',
      '',
    );
    const accessToken = this.configService.get<string>(
      'WHATSAPP_ACCESS_TOKEN',
      '',
    );
    const url = `https://graph.facebook.com/v19.0/${phoneNumberId}`;
    const start = Date.now();

    try {
      await firstValueFrom(
        this.httpService.get(url, {
          headers: { Authorization: `Bearer ${accessToken}` },
        }),
      );
      return { status: 'ok', latencyMs: Date.now() - start };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[Health] WhatsApp API probe failed: ${message}`);
      return {
        status: 'error',
        latencyMs: Date.now() - start,
        error: message,
      };
    }
  }

  private async probeOpenAiApi(): Promise<ServiceHealth> {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY', '');
    const url = 'https://api.openai.com/v1/models';
    const start = Date.now();

    try {
      await firstValueFrom(
        this.httpService.get(url, {
          headers: { Authorization: `Bearer ${apiKey}` },
        }),
      );
      return { status: 'ok', latencyMs: Date.now() - start };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[Health] OpenAI API probe failed: ${message}`);
      return {
        status: 'error',
        latencyMs: Date.now() - start,
        error: message,
      };
    }
  }

  private async probeRedis(): Promise<ServiceHealth> {
    // Access the Redis client via SessionService's internal redis field.
    // SessionService falls back to in-memory when REDIS_URL is not set.
    const redisUrl = this.configService.get<string>('REDIS_URL');

    if (!redisUrl) {
      // In-memory fallback is active — report as disabled, not an error
      return { status: 'ok', error: 'disabled (in-memory fallback)' };
    }

    const start = Date.now();
    try {
      // Use the session service's Redis connection indirectly by attempting a
      // get on a known-absent key — this exercises the connection without
      // exposing the private redis field.
      await this.sessionService.get('__health_probe__');
      return { status: 'ok', latencyMs: Date.now() - start };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[Health] Redis probe failed: ${message}`);
      return {
        status: 'error',
        latencyMs: Date.now() - start,
        error: message,
      };
    }
  }
}
