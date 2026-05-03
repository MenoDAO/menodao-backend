import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { ConversationTurn } from './session.service';

// ─── Exported Types ───────────────────────────────────────────────────────────

export type IntentType =
  | 'DENTAL_QUESTION'
  | 'SUBSCRIPTION_QUERY'
  | 'CLINIC_QUERY'
  | 'CLAIM_QUERY'
  | 'ESCALATION_REQUEST'
  | 'VISIT_HISTORY_QUERY'
  | 'REFERRAL_QUERY'
  | 'BLOCKCHAIN_QUERY'
  | 'ACCOUNT_QUERY'
  | 'MENU_NAVIGATION'
  | 'UNRECOGNISED';

export interface MemberContext {
  tier: string | null;
  annualCapLimit: number | null;
  annualCapUsed: number | null;
  isActive: boolean;
}

// ─── System Prompts ───────────────────────────────────────────────────────────

const INTENT_CLASSIFICATION_PROMPT = `You are an intent classifier for MenoAI, a WhatsApp dental insurance assistant for MenoDAO in Kenya.

Classify the user's message into exactly one of these intents:
- DENTAL_QUESTION: questions about dental health, symptoms, procedures, oral hygiene
- SUBSCRIPTION_QUERY: questions about subscription plans, pricing, upgrading, coverage
- CLINIC_QUERY: looking for a clinic, asking about clinic locations or hours
- CLAIM_QUERY: asking about submitting a claim, claim status, claim eligibility
- ESCALATION_REQUEST: wants to speak to a human dentist or support agent
- VISIT_HISTORY_QUERY: asking about past dental visits or treatment history
- REFERRAL_QUERY: asking about referral codes, champion programme, commissions
- BLOCKCHAIN_QUERY: asking about NFTs, blockchain records, Hypercert, impact proof
- ACCOUNT_QUERY: asking about profile, language settings, payment history
- MENU_NAVIGATION: wants to see the main menu or navigate to a specific section
- UNRECOGNISED: none of the above

Respond with ONLY the intent name, nothing else. No explanation, no punctuation.`;

const VALID_INTENTS = new Set<IntentType>([
  'DENTAL_QUESTION',
  'SUBSCRIPTION_QUERY',
  'CLINIC_QUERY',
  'CLAIM_QUERY',
  'ESCALATION_REQUEST',
  'VISIT_HISTORY_QUERY',
  'REFERRAL_QUERY',
  'BLOCKCHAIN_QUERY',
  'ACCOUNT_QUERY',
  'MENU_NAVIGATION',
  'UNRECOGNISED',
]);

function buildDentalSystemPrompt(ctx: MemberContext): string {
  const tier = ctx.tier ?? 'No active subscription';
  const capLimit =
    ctx.annualCapLimit != null ? `KES ${ctx.annualCapLimit}` : 'N/A';
  const capUsed =
    ctx.annualCapUsed != null ? `KES ${ctx.annualCapUsed}` : 'N/A';

  return `You are MenoAI, a knowledgeable dental health assistant for MenoDAO members in Kenya.

Member context:
- Subscription tier: ${tier}
- Annual benefit cap: ${capLimit}
- Cap used so far: ${capUsed}

Your role:
- Provide evidence-based dental health guidance relevant to Kenyan members
- Explain dental procedures, symptoms, and oral hygiene in plain language
- Recommend professional consultation for clinical decisions, diagnoses, or prescriptions
- Keep responses under 300 words and suitable for reading on a mobile phone
- Use simple, clear language. Avoid medical jargon unless you explain it
- When relevant, mention that MenoDAO covers specific procedures under the member's plan

Important constraints:
- Do NOT provide specific diagnoses
- Do NOT prescribe medication
- Do NOT replace professional dental advice
- Always end responses that involve symptoms or pain with: "⚠️ For a proper diagnosis, please visit a MenoHub clinic."

You are bilingual. Respond in the same language the member uses (English or Swahili).`;
}

// ─── Fallback messages ────────────────────────────────────────────────────────

const FALLBACK_EN =
  "I'm having trouble connecting right now. Would you like to speak with a human dentist instead? Reply _5_ or type _dentist_.";
const FALLBACK_SW =
  'Nina tatizo la kuunganika sasa hivi. Ungependa kuzungumza na daktari wa meno? Jibu _5_ au andika _daktari_.';

// ─── LlmService ───────────────────────────────────────────────────────────────

@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private readonly openai: OpenAI;
  private readonly model: string;
  private readonly TIMEOUT_MS = 15_000;
  private readonly RATE_LIMIT_RETRY_DELAY_MS = 2_000;

  constructor(private readonly configService: ConfigService) {
    this.openai = new OpenAI({
      apiKey: this.configService.get<string>('OPENAI_API_KEY', ''),
      timeout: this.TIMEOUT_MS,
      maxRetries: 0, // we handle retries manually
    });
    this.model = this.configService.get<string>('OPENAI_MODEL', 'gpt-4o');
  }

  /**
   * Classify the intent of a free-text message.
   * Returns 'UNRECOGNISED' on any error or timeout.
   */
  async classifyIntent(
    message: string,
    history: ConversationTurn[],
  ): Promise<IntentType> {
    const start = Date.now();
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: INTENT_CLASSIFICATION_PROMPT },
      // last 4 turns for context
      ...history.slice(-4).map(this.turnToParam),
      { role: 'user', content: message },
    ];

    try {
      const result = await this.callWithRetry(messages, {
        max_tokens: 20,
        temperature: 0,
      });

      const latencyMs = Date.now() - start;
      const raw = result.choices[0]?.message?.content?.trim() ?? '';
      const intent = raw as IntentType;

      this.logger.log(
        `[LLM] classifyIntent model=${this.model} tokens=${result.usage?.total_tokens ?? '?'} latency=${latencyMs}ms success=true intent=${intent}`,
      );

      return VALID_INTENTS.has(intent) ? intent : 'UNRECOGNISED';
    } catch (err) {
      const latencyMs = Date.now() - start;
      this.logger.error(
        `[LLM] classifyIntent model=${this.model} latency=${latencyMs}ms success=false error=${this.errorMessage(err)}`,
      );
      return 'UNRECOGNISED';
    }
  }

  /**
   * Generate a dental health response for the member.
   * Returns a localised fallback message on error or timeout.
   */
  async dentalChat(
    message: string,
    history: ConversationTurn[],
    memberContext: MemberContext,
    language: 'en' | 'sw' = 'en',
  ): Promise<string> {
    const start = Date.now();
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: buildDentalSystemPrompt(memberContext) },
      // last 10 turns
      ...history.slice(-10).map(this.turnToParam),
      { role: 'user', content: message },
    ];

    try {
      const result = await this.callWithRetry(messages, {
        max_tokens: 450,
        temperature: 0.4,
      });

      const latencyMs = Date.now() - start;
      const content = result.choices[0]?.message?.content ?? '';
      const finishReason = result.choices[0]?.finish_reason;

      this.logger.log(
        `[LLM] dentalChat model=${this.model} tokens=${result.usage?.total_tokens ?? '?'} latency=${latencyMs}ms success=true finish=${finishReason}`,
      );

      // If response was cut off, append ellipsis
      if (finishReason === 'length') {
        this.logger.warn('[LLM] dentalChat response truncated at max_tokens');
        return content.trimEnd() + '…';
      }

      return content;
    } catch (err) {
      const latencyMs = Date.now() - start;
      this.logger.error(
        `[LLM] dentalChat model=${this.model} latency=${latencyMs}ms success=false error=${this.errorMessage(err)}`,
      );
      return language === 'sw' ? FALLBACK_SW : FALLBACK_EN;
    }
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  /**
   * Calls the OpenAI chat completions API.
   * On a 429 rate-limit response, retries once after RATE_LIMIT_RETRY_DELAY_MS.
   * All other errors are re-thrown immediately.
   */
  private async callWithRetry(
    messages: OpenAI.Chat.ChatCompletionMessageParam[],
    options: { max_tokens: number; temperature: number },
  ): Promise<OpenAI.Chat.ChatCompletion> {
    try {
      return await this.openai.chat.completions.create({
        model: this.model,
        messages,
        ...options,
      });
    } catch (err) {
      if (this.isRateLimit(err)) {
        this.logger.warn(
          `[LLM] Rate limited (429). Retrying once after ${this.RATE_LIMIT_RETRY_DELAY_MS}ms…`,
        );
        await this.sleep(this.RATE_LIMIT_RETRY_DELAY_MS);
        // Single retry — any error here propagates to the caller
        return await this.openai.chat.completions.create({
          model: this.model,
          messages,
          ...options,
        });
      }
      throw err;
    }
  }

  private turnToParam(
    turn: ConversationTurn,
  ): OpenAI.Chat.ChatCompletionMessageParam {
    return { role: turn.role, content: turn.content };
  }

  private isRateLimit(err: unknown): boolean {
    if (err && typeof err === 'object') {
      // openai SDK wraps HTTP errors with a `status` property
      const status = (err as { status?: number }).status;
      return status === 429;
    }
    return false;
  }

  private errorMessage(err: unknown): string {
    if (err instanceof Error) return err.message;
    return String(err);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
