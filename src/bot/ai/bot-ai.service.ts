import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PiiSanitizer } from '../privacy/pii-sanitizer';
import type {
  ChatHistoryMessage,
  ILlmProvider,
} from './interfaces/llm-provider.interface';
import { LLM_PROVIDER } from './interfaces/llm-provider.interface';
import { BrandContextService } from '../context/brand-context.service';
import type { RetrievedBrandContext } from '../context/brand-context.service';
import {
  DR_PAPI_FALLBACK_REPLY,
  DR_PAPI_FALLBACK_REPLY_SW,
  buildDrPapiSystemPrompt,
  polishMemberReply,
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
  /** Classified intent for this turn (drives answer shape, not permissions). */
  intent?: string | null;
  /** Per-intent behaviour guidance injected into the system prompt. */
  intentGuidance?: string | null;
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
    private readonly contextService: BrandContextService,
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
    // grounding and the user prompt context. Include the previous user turn so
    // follow-ups ("and how much is that?") retrieve the right documents.
    const previousUserTurn = [...history]
      .reverse()
      .find((message) => message.role === 'user')?.content;
    const retrievalQuery = [previousUserTurn, userMessage]
      .filter((part): part is string => Boolean(part && part.trim()))
      .join(' ');
    const retrievedContext = await this.retrieveContext(retrievalQuery);
    const systemPrompt = await this.buildSystemPrompt(
      userMessage,
      retrievedContext,
      options,
    );
    const contextBlock =
      this.contextService.renderPromptBlock(retrievedContext);

    // Workstream 2: Sanitize user prompt and history before LLM call
    const rawUserPrompt = contextBlock
      ? `${contextBlock}\n\nUser question: ${userMessage}`
      : userMessage;
    const sanitizedUserPrompt = PiiSanitizer.sanitizeForLlm(rawUserPrompt, {
      fullName: options.memberName,
    });
    const sanitizedHistory = history.map((item) => ({
      ...item,
      content: PiiSanitizer.sanitizeForLlm(item.content, {
        fullName: options.memberName,
      }),
    }));

    let rawReply: string;
    try {
      rawReply = await this.llmProvider.generateCompletion({
        systemPrompt,
        userPrompt: sanitizedUserPrompt,
        history: sanitizedHistory,
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
    const firstName = options.memberName?.trim().split(/\s+/)[0] ?? null;
    const message = polishMemberReply(rawReply, firstName);
    const detectedLeadIntent = this.detectLeadIntent(userMessage, message);
    return { message, detectedLeadIntent };
  }

  /** Retrieval: ground the bot reply in the most relevant context docs. */
  private async retrieveContext(
    userMessage: string,
  ): Promise<RetrievedBrandContext[]> {
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

  private renderContextBlock(retrieved: RetrievedBrandContext[]): string {
    return this.contextService.renderPromptBlock(retrieved);
  }

  /** Grounding: backend Clinic (APPROVED) + active Procedure catalogue. */
  public async buildSystemPrompt(
    userMessage?: string,
    retrieved?: RetrievedBrandContext[],
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
          doctors: {
            where: { isActive: true },
            select: { name: true, specialty: true },
            orderBy: { name: 'asc' },
          },
          operatingSchedule: {
            select: {
              dayOfWeek: true,
              openTime: true,
              closeTime: true,
              isClosed: true,
            },
          },
        },
        orderBy: { name: 'asc' },
      }),
      this.prisma.procedure.findMany({
        where: { isActive: true },
        select: { code: true, name: true, cost: true, allowedTiers: true },
        orderBy: { name: 'asc' },
      }),
    ]);

    const clinicContext = clinics.length
      ? clinics
          .map((c) => {
            const structuredHours = this.formatClinicHours(c.operatingSchedule);
            const hours =
              structuredHours || c.operatingHours || 'hours not listed';
            const doctors = c.doctors.length
              ? ` | Doctors: ${c.doctors
                  .map((doctor) =>
                    doctor.specialty
                      ? `${doctor.name} (${doctor.specialty})`
                      : doctor.name,
                  )
                  .join(', ')}`
              : '';
            return `- ${c.name} | ${c.physicalLocation}, ${c.subCounty} | Hours: ${hours} | WhatsApp: ${c.whatsappNumber}${doctors}`;
          })
          .join('\n')
      : 'No active clinics currently on file.';

    // Procedures are the insurance coverage source of truth; tiers are
    // membership levels that gate them via Procedure.allowedTiers.
    const insuranceContext = procedures.length
      ? procedures
          .map((p) => {
            const tiers = Array.isArray(p.allowedTiers)
              ? (p.allowedTiers as unknown[])
                  .filter((tier): tier is string => typeof tier === 'string')
                  .join(', ')
              : '';
            return `- ${p.name} (${p.code}): KES ${p.cost}, covered tiers: ${
              tiers || 'see membership terms'
            }`;
          })
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
      intentGuidance: options.intentGuidance ?? undefined,
    });
  }

  private formatClinicHours(
    rows: Array<{
      dayOfWeek: number;
      openTime: string | null;
      closeTime: string | null;
      isClosed: boolean;
    }>,
  ): string {
    if (!rows.length) return '';
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return [...rows]
      .sort((a, b) => a.dayOfWeek - b.dayOfWeek)
      .map((row) => {
        const day = dayNames[row.dayOfWeek] ?? `Day ${row.dayOfWeek}`;
        if (row.isClosed || !row.openTime || !row.closeTime) {
          return `${day} closed`;
        }
        return `${day} ${row.openTime}-${row.closeTime}`;
      })
      .join(', ');
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
