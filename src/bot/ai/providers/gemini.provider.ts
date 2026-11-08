import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI } from '@google/genai';
import {
  GenerateResponseOptions,
  ILlmProvider,
} from '../interfaces/llm-provider.interface';

@Injectable()
export class GeminiProvider implements ILlmProvider {
  private readonly logger = new Logger(GeminiProvider.name);
  private client?: GoogleGenAI;
  private readonly model: string;

  constructor(private readonly configService: ConfigService) {
    this.model =
      this.configService.get<string>('GEMINI_MODEL') ?? 'gemini-2.0-flash';
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
          'GEMINI_API_KEY is required when LLM_PROVIDER_NAME=gemini.',
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

    try {
      const response = await this.getClient().models.generateContent({
        model: this.model,
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

      return text.trim();
    } catch (error) {
      this.logger.error(
        `Gemini completion failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw error;
    }
  }
}
