import { Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  GenerateResponseOptions,
  ILlmProvider,
} from './interfaces/llm-provider.interface';

const REDACTED = '[redacted: set BOT_LLM_LOG_PROMPTS=true to persist]';

export class ObservedLlmProvider implements ILlmProvider {
  private readonly logger = new Logger(ObservedLlmProvider.name);

  constructor(
    private readonly provider: ILlmProvider,
    private readonly prisma: PrismaService,
    private readonly providerName: string,
    private readonly model: string,
    private readonly logPrompts: boolean = false,
    private readonly memberId?: string | null,
  ) {}

  async generateCompletion(options: GenerateResponseOptions): Promise<string> {
    const startedAt = Date.now();
    let response: string | undefined;
    let errorMessage: string | undefined;

    try {
      response = await this.provider.generateCompletion(options);
      return response;
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      await this.recordCall(
        options,
        response,
        errorMessage,
        Date.now() - startedAt,
      );
    }
  }

  private async recordCall(
    options: GenerateResponseOptions,
    response: string | undefined,
    error: string | undefined,
    durationMs: number,
  ): Promise<void> {
    try {
      await this.prisma.botLlmCallLog.create({
        data: {
          memberId: this.memberId ?? null,
          provider: this.providerName,
          model: this.model,
          operation: options.operation ?? 'unspecified',
          responseFormat: options.responseFormat ?? null,
          // Prompts and replies carry clinical/PII content; persist metadata
          // only unless explicitly enabled for debugging.
          systemPrompt: this.logPrompts ? options.systemPrompt : REDACTED,
          userPrompt: this.logPrompts ? options.userPrompt : REDACTED,
          history: this.logPrompts
            ? JSON.stringify(options.history ?? [])
            : REDACTED,
          response: this.logPrompts ? (response ?? null) : REDACTED,
          status: error === undefined ? 'SUCCESS' : 'FAILED',
          error: error === undefined ? null : error.slice(0, 500),
          durationMs,
        },
      });
    } catch (loggingError) {
      this.logger.error(
        `Unable to persist LLM call log: ${
          loggingError instanceof Error
            ? loggingError.message
            : String(loggingError)
        }`,
      );
    }
  }
}
