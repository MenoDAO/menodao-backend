import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  ChatHistoryMessage,
  ILlmProvider,
} from './interfaces/llm-provider.interface';
import { LLM_PROVIDER } from './interfaces/llm-provider.interface';
import { BotContextService } from '../context/bot-context.service';
import type { RetrievedBotContext } from '../context/bot-context.service';
import {
  DR_PAPI_FALLBACK_REPLY,
  DR_PAPI_FALLBACK_REPLY_SW,
  buildDrPapiSystemPrompt,
  replyLanguage,
} from '../prompts';

export type LeadIntent = 'INSURANCE_INTEREST' | 'CLINIC_APPOINTMENT' | null;

export interface AiReply {
  message: string;
  detectedLeadIntent: LeadIntent;
}

export interface AiReplyOptions {
  /** Member.preferredLanguage from the backend profile ("en" | "sw"). */
  language?: string | null;
  /** Member.fullName, used to greet the member naturally. */
  memberName?: string | null;
}

/**
 * BotAiService (ported from menobot AiService).
 * Grounded in live backend data: APPROVED Clinics + active Procedures
 * (instead of menobot Clinic/InsurancePlan stubs).
 */
@Injectable()
export class BotAiService {
  private readonly logger = new Logger(BotAiService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly contextService: BotContextService,
    @Inject(LLM_PROVIDER) private readonly llmProvider: ILlmProvider,
  ) {}

  async generateReply(
    userMessage: string,
    history: ChatHistoryMessage[],
    operation = 'whatsapp_reply',
    options: AiReplyOptions = {},
  ): Promise<AiReply> {
    const language = replyLanguage(options.language);
    // One retrieval per reply: the same documents feed both the system prompt
    // grounding and the user prompt context.
    const retrievedContext = await this.retrieveContext(userMessage);
    const systemPrompt = await this.buildSystemPrompt(
      userMessage,
      retrievedContext,
      options,
    );
    const contextBlock =
      this.contextService.renderPromptBlock(retrievedContext);
    let rawReply: string;
    try {
      rawReply = await this.llmProvider.generateCompletion({
        systemPrompt,
        userPrompt: contextBlock
          ? `${contextBlock}\n\nUser question: ${userMessage}`
          : userMessage,
        history,
        operation,
      });
    } catch (error) {
      this.logger.error(
        `LLM generation failed, falling back: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      rawReply =
        language === 'sw' ? DR_PAPI_FALLBACK_REPLY_SW : DR_PAPI_FALLBACK_REPLY;
    }
    const message = rawReply;
    const detectedLeadIntent = this.detectLeadIntent(userMessage, rawReply);
    return { message, detectedLeadIntent };
  }

  /** Retrieval: ground the bot reply in the most relevant context docs. */
  private async retrieveContext(
    userMessage: string,
  ): Promise<RetrievedBotContext[]> {
    try {
      const results = await this.contextService.retrieve(userMessage);
      if (results.length > 0) {
        this.logger.log(
          `Retrieved ${results.length} context doc(s) for bot reply: ${results.map((r) => r.title).join(', ')}`,
        );
      }
      return results;
    } catch (error) {
      this.logger.warn(
        `Bot context retrieval failed, proceeding without context: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return [];
    }
  }

  private renderContextBlock(retrieved: RetrievedBotContext[]): string {
    return this.contextService.renderPromptBlock(retrieved);
  }

  /** Grounding: backend Clinic (APPROVED) + active Procedure catalogue. */
  public async buildSystemPrompt(
    userMessage?: string,
    retrieved?: RetrievedBotContext[],
    options: AiReplyOptions = {},
  ): Promise<string> {
    const [clinics, procedures] = await Promise.all([
      this.prisma.clinic.findMany({
        where: { status: 'APPROVED' },
        select: {
          id: true,
          name: true,
          physicalLocation: true,
          subCounty: true,
          operatingHours: true,
          whatsappNumber: true,
        },
        orderBy: { name: 'asc' },
      }),
      this.prisma.procedure.findMany({
        where: { isActive: true },
        select: { code: true, name: true },
        orderBy: { name: 'asc' },
      }),
    ]);

    const clinicContext = clinics.length
      ? clinics
          .map(
            (c) =>
              `- ${c.name} | ${c.physicalLocation}, ${c.subCounty} | Hours: ${c.operatingHours} | WhatsApp: ${c.whatsappNumber}`,
          )
          .join('\n')
      : 'No active clinics currently on file.';

    // Procedures are the insurance coverage source of truth; tiers are
    // membership levels that gate them via Procedure.allowedTiers.
    const insuranceContext = procedures.length
      ? procedures
          .map((p) => `- ${p.name} (${p.code}) — covered per membership tier`)
          .join('\n')
      : 'Coverage per membership tier (Bronze / Silver / Gold). See https://menodao.org for details.';

    const contextDocuments = retrieved
      ? this.contextService.renderPromptBlock(retrieved).trim()
      : userMessage
        ? this.contextService
            .renderPromptBlock(await this.retrieveContext(userMessage))
            .trim()
        : '';

    return buildDrPapiSystemPrompt({
      clinicContext,
      insuranceContext,
      contextDocuments: contextDocuments || undefined,
      language: options.language,
      memberName: options.memberName,
    });
  }

  private detectLeadIntent(userMessage: string, reply: string): LeadIntent {
    const combined = `${userMessage} ${reply}`.toLowerCase();
    const appointmentKeywords = [
      'appointment',
      'book',
      'schedule',
      'visit',
      'come in',
      'see a dentist',
      'available slot',
    ];
    const insuranceKeywords = [
      'insurance',
      'plan',
      'coverage',
      'sign up',
      'signup',
      'monthly cost',
      'premium',
    ];
    if (appointmentKeywords.some((k) => combined.includes(k)))
      return 'CLINIC_APPOINTMENT';
    if (insuranceKeywords.some((k) => combined.includes(k)))
      return 'INSURANCE_INTEREST';
    return null;
  }
}
