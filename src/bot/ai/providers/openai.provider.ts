import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import {
  GenerateResponseOptions,
  ILlmProvider,
} from '../interfaces/llm-provider.interface';

@Injectable()
export class OpenAiProvider implements ILlmProvider {
  private readonly logger = new Logger(OpenAiProvider.name);
  private client?: OpenAI;
  private readonly model: string;

  constructor(private readonly configService: ConfigService) {
    this.model =
      this.configService.get<string>('OPENAI_MODEL') ?? 'gpt-4o-mini';
  }

  /**
   * Lazily construct the client so an unused provider does not require
   * credentials at application startup.
   */
  private getClient(): OpenAI {
    if (!this.client) {
      const apiKey = this.configService.get<string>('OPENAI_API_KEY');
      if (!apiKey) {
        throw new Error(
          'OPENAI_API_KEY is required when BOT_LLM_PROVIDER=openai.',
        );
      }
      this.client = new OpenAI({ apiKey });
    }
    return this.client;
  }

  async generateCompletion(options: GenerateResponseOptions): Promise<string> {
    const { systemPrompt, userPrompt, history = [], responseFormat, images, pdfBase64 } =
      options;

    const userContent: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
      { type: 'text', text: userPrompt },
      ...(images ?? []).map((image) => ({
        type: 'image_url' as const,
        image_url: {
          url: `data:${image.mimeType};base64,${image.base64}`,
          detail: 'high' as const,
        },
      })),
    ];

    if (pdfBase64) {
      userContent.push({
        type: 'file',
        file: {
          filename: 'field-report.pdf',
          file_data: `data:application/pdf;base64,${pdfBase64}`,
        },
      });
    }

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      ...history.map(
        (turn) =>
          ({
            role: turn.role === 'assistant' ? 'assistant' : 'user',
            content: turn.content,
          }) as OpenAI.Chat.Completions.ChatCompletionMessageParam,
      ),
      {
        role: 'user',
        content: images?.length || pdfBase64 ? userContent : userPrompt,
      },
    ];

    try {
      const completion = await this.getClient().chat.completions.create({
        model: this.model,
        messages,
        temperature: 0.4,
        max_tokens: 800,
        // Enable native JSON mode when requested — prevents markdown fences in output
        ...(responseFormat === 'json'
          ? { response_format: { type: 'json_object' as const } }
          : {}),
      });

      const text = completion.choices[0]?.message?.content;

      if (!text) {
        throw new Error('OpenAI returned an empty response.');
      }

      return text.trim();
    } catch (error) {
      this.logger.error(
        `OpenAI completion failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw error;
    }
  }
}
