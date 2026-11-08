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
    const providerName = (
      configService.get<string>('LLM_PROVIDER_NAME') ?? 'gemini'
    ).toLowerCase();
    logger.log(`Wiring LLM_PROVIDER token to "${providerName}" provider.`);
    let provider: ILlmProvider;
    let model: string;
    let selectedProviderName = providerName;
    switch (providerName) {
      case 'openai':
        provider = openAiProvider;
        model = configService.get<string>('OPENAI_MODEL') ?? 'gpt-4o-mini';
        break;
      case 'gemini':
        provider = geminiProvider;
        model = configService.get<string>('GEMINI_MODEL') ?? 'gemini-2.0-flash';
        break;
      default:
        logger.warn(
          `Unknown LLM_PROVIDER_NAME "${providerName}", defaulting to Gemini.`,
        );
        provider = geminiProvider;
        selectedProviderName = 'gemini';
        model = configService.get<string>('GEMINI_MODEL') ?? 'gemini-2.0-flash';
    }
    return new ObservedLlmProvider(
      provider,
      prisma,
      selectedProviderName,
      model,
    );
  },
};

@Module({
  imports: [ConfigModule],
  providers: [GeminiProvider, OpenAiProvider, llmProviderFactory, BotAiService],
  exports: [BotAiService, LLM_PROVIDER],
})
export class BotAiModule {}
