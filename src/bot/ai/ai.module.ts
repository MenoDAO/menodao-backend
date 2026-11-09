import { Logger, Module, Provider } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BotAiService } from './bot-ai.service';
import { GeminiProvider } from './providers/gemini.provider';
import { OpenAiProvider } from './providers/openai.provider';
import {
  ILlmProvider,
  LLM_PROVIDER,
} from './interfaces/llm-provider.interface';
import { ObservedLlmProvider } from './observed-llm.provider';
import { PrismaService } from '../../prisma/prisma.service';

const logger = new Logger('BotAiModule');

const llmProviderFactory: Provider = {
  provide: LLM_PROVIDER,
  inject: [ConfigService, GeminiProvider, OpenAiProvider, PrismaService],
  useFactory: (
    configService: ConfigService,
    geminiProvider: GeminiProvider,
    openAiProvider: OpenAiProvider,
    prisma: PrismaService,
  ) => {
    // BOT_ prefix keeps the bot's LLM choice independent from the backend's
    // existing LlmService (which reads OPENAI_MODEL directly).
    const providerName = (
      configService.get<string>('BOT_LLM_PROVIDER') ?? 'gemini'
    ).toLowerCase();
    logger.log(`Wiring LLM_PROVIDER token to "${providerName}" provider.`);
    let provider: ILlmProvider;
    let model: string;
    let selectedProviderName = providerName;
    switch (providerName) {
      case 'openai':
        provider = openAiProvider;
        model =
          configService.get<string>('BOT_OPENAI_MODEL') ??
          configService.get<string>('OPENAI_MODEL') ??
          'gpt-4o-mini';
        break;
      case 'gemini':
        provider = geminiProvider;
        model =
          configService.get<string>('BOT_GEMINI_MODEL') ??
          configService.get<string>('GEMINI_MODEL') ??
          'gemini-2.0-flash';
        break;
      default:
        logger.warn(
          `Unknown BOT_LLM_PROVIDER "${providerName}", defaulting to Gemini.`,
        );
        provider = geminiProvider;
        selectedProviderName = 'gemini';
        model =
          configService.get<string>('BOT_GEMINI_MODEL') ??
          configService.get<string>('GEMINI_MODEL') ??
          'gemini-2.0-flash';
    }
    // Full prompts contain clinical/PII text — only persist them when
    // explicitly enabled (local debugging), never by default in production.
    const logPrompts =
      (
        configService.get<string>('BOT_LLM_LOG_PROMPTS') ?? 'false'
      ).toLowerCase() === 'true';
    return new ObservedLlmProvider(
      provider,
      prisma,
      selectedProviderName,
      model,
      logPrompts,
    );
  },
};

@Module({
  imports: [ConfigModule],
  providers: [GeminiProvider, OpenAiProvider, llmProviderFactory, BotAiService],
  exports: [BotAiService, LLM_PROVIDER],
})
export class BotAiModule {}
