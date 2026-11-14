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
  const status = (error as { status?: number })?.status;
  if (status === 404 || status === 429 || status === 503) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /no longer available|NOT_FOUND|high demand|UNAVAILABLE|RESOURCE_EXHAUSTED/i.test(
    message,
  );
}

@Injectable()
export class GeminiProvider implements ILlmProvider {
  private readonly logger = new Logger(GeminiProvider.name);
  private client?: GoogleGenAI;
  /** Primary model first, then fallbacks. Deduplicated. */
  private readonly models: string[];

  constructor(private readonly configService: ConfigService) {
    const primary =
      this.configService.get<string>('BOT_GEMINI_MODEL') ??
      this.configService.get<string>('GEMINI_MODEL') ??
      'gemini-3.5-flash';
    const fallbacks = (
      this.configService.get<string>('GEMINI_FALLBACK_MODELS') ??
      'gemini-3.6-flash,gemini-3.8-flash'
    )
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean);
    this.models = [...new Set([primary, ...fallbacks])];
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
    const { systemPrompt, userPrompt, history = [], responseFormat } = options;

    const contents = [
      ...history.map((turn) => ({
        role: turn.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: turn.content }],
      })),
      {
        role: 'user',
        parts: [{ text: userPrompt }],
      },
    ];

    let lastError: unknown;
    for (let index = 0; index < this.models.length; index += 1) {
      const model = this.models[index];
      try {
        const response = await this.getClient().models.generateContent({
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
        });

        const text = response.text;

        if (!text) {
          throw new Error('Gemini returned an empty response.');
        }

        if (index > 0) {
          this.logger.log(`Gemini recovered on fallback model ${model}.`);
        }
        return text.trim();
      } catch (error) {
        lastError = error;
        const message =
          error instanceof Error ? error.message : String(error);
        const hasNext = index < this.models.length - 1;
        if (!hasNext || !isModelUnavailable(error)) {
          this.logger.error(`Gemini completion failed on ${model}: ${message}`);
          break;
        }
        this.logger.warn(
          `Gemini model ${model} unavailable (${message}); trying ${this.models[index + 1]}.`,
        );
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error(String(lastError ?? 'Gemini completion failed.'));
  }
}
