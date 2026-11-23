import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI } from '@google/genai';
import {
  GenerateResponseOptions,
  ILlmProvider,
} from '../interfaces/llm-provider.interface';

/**
 * Model errors that mean "try a different model" rather than "the request is
 * wrong": retired models, overloaded models and quota exhaustion.
 */
function isModelUnavailable(error: unknown): boolean {
  if (error instanceof LlmTimeoutError) return true;
  const status = (error as { status?: number })?.status;
  if (status === 404 || status === 429 || status === 503) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /no longer available|NOT_FOUND|high demand|UNAVAILABLE|RESOURCE_EXHAUSTED/i.test(
    message,
  );
}

/** A model call that never came back, so we can move on to the next one. */
class LlmTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Gemini did not answer within ${timeoutMs}ms.`);
    this.name = 'LlmTimeoutError';
  }
}

/** Overload and quota errors are worth one quick retry on the same model. */
function isTransient(error: unknown): boolean {
  if (error instanceof LlmTimeoutError) return false;
  const status = (error as { status?: number })?.status;
  if (status === 429 || status === 503) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /high demand|UNAVAILABLE|RESOURCE_EXHAUSTED|overloaded|503|429/i.test(
    message,
  );
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

@Injectable()
export class GeminiProvider implements ILlmProvider {
  private readonly logger = new Logger(GeminiProvider.name);
  private client?: GoogleGenAI;
  /** Primary model first, then fallbacks. Deduplicated. */
  private readonly models: string[];
  private readonly timeoutMs: number;

  constructor(private readonly configService: ConfigService) {
    const primary =
      this.configService.get<string>('BOT_GEMINI_MODEL') ??
      this.configService.get<string>('GEMINI_MODEL') ??
      'gemini-2.5-flash-lite';
    const fallbacks = (
      this.configService.get<string>('GEMINI_FALLBACK_MODELS') ??
      'gemini-flash-latest,gemini-2.5-flash,gemini-flash-lite-latest'
    )
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean);
    this.models = [...new Set([primary, ...fallbacks])];
    this.timeoutMs = Number(
      this.configService.get<string>('BOT_LLM_TIMEOUT_MS') ?? 20_000,
    );
  }

  /** Fails the call instead of letting one hung model stall the webhook. */
  private async withTimeout<T>(promise: Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new LlmTimeoutError(this.timeoutMs)),
            this.timeoutMs,
          );
          timer.unref?.();
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * Lazily construct the client so an unused provider does not require
   * credentials at application startup.
   */
  private getClient(): GoogleGenAI {
    if (!this.client) {
      const apiKey = this.configService.get<string>('GEMINI_API_KEY');
      if (!apiKey) {
        throw new Error(
          'GEMINI_API_KEY is required when BOT_LLM_PROVIDER=gemini.',
        );
      }
      this.client = new GoogleGenAI({ apiKey });
    }
    return this.client;
  }

  async generateCompletion(options: GenerateResponseOptions): Promise<string> {
    const { systemPrompt, userPrompt, history = [], responseFormat, images } =
      options;

    const contents = [
      ...history.map((turn) => ({
        role: turn.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: turn.content }],
      })),
      {
        role: 'user',
        parts: [
          { text: userPrompt },
          ...(images ?? []).map((image) => ({
            inlineData: {
              mimeType: image.mimeType,
              data: image.base64,
            },
          })),
        ],
      },
    ];

    let lastError: unknown;
    modelLoop: for (let index = 0; index < this.models.length; index += 1) {
      const model = this.models[index];
      const hasNext = index < this.models.length - 1;

      // Overloaded models often recover on a second try a moment later; a hung
      // model never will, so timeouts move straight to the next model.
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        try {
          const response = await this.withTimeout(
            this.getClient().models.generateContent({
              model,
              contents,
              config: {
                systemInstruction: systemPrompt,
                temperature: 0.4,
                maxOutputTokens: 800,
                // Enable native JSON mode when requested — prevents markdown fences in output
                ...(responseFormat === 'json'
                  ? { responseMimeType: 'application/json' }
                  : {}),
              },
            }),
          );

          const text = response.text;

          if (!text) {
            throw new Error('Gemini returned an empty response.');
          }

          if (index > 0 || attempt > 1) {
            this.logger.log(
              `Gemini recovered on ${model} (attempt ${attempt}).`,
            );
          }
          return text.trim();
        } catch (error) {
          lastError = error;
          const message =
            error instanceof Error ? error.message : String(error);

          if (attempt === 1 && isTransient(error)) {
            this.logger.warn(
              `Gemini model ${model} overloaded (${message}); retrying once.`,
            );
            await sleep(700);
            continue;
          }

          if (!isModelUnavailable(error)) {
            // Bad request, missing key, safety block — another model will not help.
            this.logger.error(
              `Gemini completion failed on ${model}: ${message}`,
            );
            throw error;
          }

          if (!hasNext) {
            this.logger.error(
              `Gemini completion failed on ${model}: ${message}`,
            );
            break modelLoop;
          }

          this.logger.warn(
            `Gemini model ${model} unavailable (${message}); trying ${this.models[index + 1]}.`,
          );
          break;
        }
      }
    }

    if (lastError instanceof Error) throw lastError;
    throw new Error('Gemini completion failed.');
  }
}
