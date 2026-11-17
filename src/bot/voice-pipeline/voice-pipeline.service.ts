import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { AssemblyAiService } from '../assemblyai/assemblyai.service';
import type { ILlmProvider } from '../ai/interfaces/llm-provider.interface';
import { LLM_PROVIDER } from '../ai/interfaces/llm-provider.interface';
import { randomUUID } from 'crypto';
import { BookingService } from '../booking/booking.service';
import { BotAiService } from '../ai/bot-ai.service';
import type { ChatHistoryMessage } from '../ai/interfaces/llm-provider.interface';
import {
  BORDER_AGENT_SYSTEM_PROMPT,
  INTENT_CLASSIFIER_SYSTEM_PROMPT,
  buildBorderAgentUserPrompt,
  buildIntentClassificationPrompt,
  replyLanguage,
} from '../prompts';
import { BotIdentityService } from '../identity/bot-identity.service';
import { CareEventsService } from '../../care-intelligence/care-events.service';
import { CareEventType, CarePrivacyClass } from '@prisma/client';

export type IntentType =
  | 'CLINICAL_INTAKE'
  | 'HEALTH_EDUCATION'
  | 'BOOKING_SESSION';

export interface ClinicalIntakeSchema {
  primary_symptom: string;
  patient_verbatim_quote: string;
  anatomical_location: string;
  duration_and_onset: string;
  pain_character: string;
  functional_impact: string;
  previous_interventions: string;
  immediate_triage_flag: boolean;
  confidence_score: number;
}

export interface PipelineExecutionResult {
  intakeUuid: string;
  senderPhone: string;
  transcript: string;
  detectedLanguage?: string;
  intent: IntentType;
  intentConfidence: number;
  clinicalIntake?: ClinicalIntakeSchema;
  bookingResult?: { confirmationMessage: string };
  healthEducationReply?: string;
  patientMessage: string;
  ttsAudioBase64?: string;
  status: 'completed' | 'failed';
  error?: string;
}

const CLINICAL_RECEIPT = {
  en: (name: string, symptom: string, voice: boolean) =>
    `Thank you${name ? `, ${name}` : ''}. I've received your ${voice ? 'voice note' : 'message'} about ${symptom} and forwarded it to our clinical team (Dr. Ruwa). We will get back to you on this number to arrange a visit or give you further guidance.\n\nIf the pain or swelling gets worse, please go to the nearest clinic immediately.\n\n---\n*Dr. Papi Foundation*`,
  sw: (name: string, symptom: string, voice: boolean) =>
    `Asante${name ? `, ${name}` : ''}. Nimepokea ${voice ? 'ujumbe wako wa sauti' : 'ujumbe wako'} kuhusu ${symptom} na kuupeleka kwa timu yetu ya kliniki (Dr. Ruwa). Tutawasiliana nawe kupitia nambari hii kupanga muda wa kuonana na daktari au kukupa maelekezo zaidi.\n\nKama maumivu au uvimbe unaongezeka, tafadhali nenda kliniki iliyo karibu mara moja.\n\n---\n*Dr. Papi Foundation*`,
} as const;

const UNRESOLVED_MEMBER_MESSAGE =
  "Samahani, sijaweza kukutambua kwa nambari hii. Kama wewe ni mwanachama, tafadhali wasiliana na kliniki yetu ili tukuunganishe.\n\nSorry, I couldn't match this number to a member account. If you're a member, please contact one of our clinics so we can link your account.";

@Injectable()
export class VoicePipelineService {
  private readonly logger = new Logger(VoicePipelineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly assemblyAiService: AssemblyAiService,
    @Inject(LLM_PROVIDER) private readonly llmProvider: ILlmProvider,
    private readonly bookingService: BookingService,
    private readonly identity: BotIdentityService,
    private readonly botAi: BotAiService,
    @Optional() private readonly careEvents?: CareEventsService,
  ) {}

  async processVoicePipeline(
    audioSource: Buffer | string,
    senderPhone: string = 'simulator-user',
    intakeUuid?: string,
  ): Promise<PipelineExecutionResult> {
    const sessionUuid = intakeUuid || randomUUID();
    this.logger.log(
      `Starting voice pipeline execution [${sessionUuid}] for ${senderPhone}`,
    );
    try {
      const sttResult =
        await this.assemblyAiService.transcribeAudio(audioSource);
      const transcript = sttResult.text;
      if (!transcript || transcript.trim().length === 0) {
        throw new Error('Received empty transcript from audio source.');
      }
      return await this.processTextPipeline(
        transcript,
        senderPhone,
        sessionUuid,
        sttResult.languageCode,
        senderPhone,
        true,
      );
    } catch (error) {
      this.logger.error(`Voice pipeline error [${sessionUuid}]: ${error}`);
      return {
        intakeUuid: sessionUuid,
        senderPhone,
        transcript: '',
        intent: 'HEALTH_EDUCATION',
        intentConfidence: 0,
        patientMessage:
          'Samahani, hatukuweza kusikiliza ujumbe wako vizuri. Tafadhali jaribu kutuma tena au uandike kwa maneno.',
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async processTextPipeline(
    transcriptText: string,
    senderPhone: string = 'simulator-user',
    intakeUuid?: string,
    detectedLanguage?: string,
    whatsappId: string = senderPhone,
    isVoice = false,
  ): Promise<PipelineExecutionResult> {
    const sessionUuid = intakeUuid || randomUUID();
    this.logger.log(
      `Routing message [${sessionUuid}]: "${transcriptText.substring(0, 60)}..."`,
    );

    // Resolve existing Member by phone — no bot signup for known numbers.
    const member = await this.identity.resolveMember({
      phoneDigitsFallback: senderPhone,
      whatsappId,
    });
    if (!member) {
      this.logger.warn(
        `Unresolved sender [${sessionUuid}] (masked): ***${(senderPhone || '').slice(-4)}; whatsappId=${whatsappId.includes('@lid') ? 'lid' : 'phone'}`,
      );
      return {
        intakeUuid: sessionUuid,
        senderPhone,
        transcript: transcriptText,
        detectedLanguage,
        intent: 'HEALTH_EDUCATION',
        intentConfidence: 0,
        patientMessage: UNRESOLVED_MEMBER_MESSAGE,
        status: 'failed',
        error: 'UNRESOLVED_MEMBER',
      };
    }
    const userId = member.id;
    const e164 = member.phoneNumber;
    const language = replyLanguage(member.preferredLanguage);
    const memberName = member.fullName?.trim() || null;

    await this.prisma.botMessageLog.create({
      data: {
        memberId: userId,
        role: 'user',
        content: `[Session: ${sessionUuid}] ${transcriptText}`,
      },
    });

    void this.careEvents?.track({
      type: CareEventType.AI_CONVERSATION_STARTED,
      memberId: userId,
      sessionId: sessionUuid,
      source: 'bot-voice-pipeline',
      privacyClass: CarePrivacyClass.ANALYTICS,
    });

    const existingDraft = await this.prisma.botBookingDraft.findUnique({
      where: { memberId: userId },
    });

    if (existingDraft) {
      if (this.bookingService.isDraftFresh(existingDraft)) {
        this.logger.log(
          `[${sessionUuid}] Active booking draft found — routing to handleDraftTurn()`,
        );
        return this.runBookingDraftTurn(
          transcriptText,
          e164,
          userId,
          sessionUuid,
          detectedLanguage,
          language,
          memberName,
        );
      }
      this.logger.log(
        `[${sessionUuid}] Stale booking draft found — deleting and re-classifying`,
      );
      await this.prisma.botBookingDraft.delete({ where: { memberId: userId } });
    }

    const classification = await this.classifyIntent(transcriptText);
    this.logger.log(
      `Intent classified [${sessionUuid}]: ${classification.intent} (${classification.confidence})`,
    );

    if (classification.intent === 'BOOKING_SESSION') {
      return this.runBookingDraftTurn(
        transcriptText,
        e164,
        userId,
        sessionUuid,
        detectedLanguage,
        language,
        memberName,
      );
    }

    if (classification.intent === 'CLINICAL_INTAKE') {
      const clinicalSchema = await this.executeBorderAgent(transcriptText);
      await this.prisma.botLead.create({
        data: {
          memberId: userId,
          type: 'CLINICAL_INTAKE',
          notes: JSON.stringify({
            sessionUuid,
            detectedLanguage,
            clinicalData: clinicalSchema,
          }),
          status: clinicalSchema.immediate_triage_flag
            ? 'URGENT_TRIAGE'
            : 'NEW',
        },
      });
      const clinicalReceipt = this.buildClinicalReceipt(
        clinicalSchema,
        language,
        memberName,
        isVoice,
      );
      await this.prisma.botMessageLog.create({
        data: {
          memberId: userId,
          role: 'assistant',
          content: clinicalReceipt,
        },
      });
      void this.careEvents?.track({
        type: CareEventType.AI_ESCALATED,
        memberId: userId,
        sessionId: sessionUuid,
        source: 'bot-voice-pipeline',
        privacyClass: CarePrivacyClass.CLINICAL,
        metadata: { triageFlag: clinicalSchema.immediate_triage_flag },
      });
      return {
        intakeUuid: sessionUuid,
        senderPhone,
        transcript: transcriptText,
        detectedLanguage,
        intent: 'CLINICAL_INTAKE',
        intentConfidence: classification.confidence,
        clinicalIntake: clinicalSchema,
        patientMessage: clinicalReceipt,
        status: 'completed',
      };
    }

    const stewardReply = await this.generateMemberReply(
      userId,
      transcriptText,
      language,
      memberName,
      sessionUuid,
    );
    await this.prisma.botMessageLog.create({
      data: { memberId: userId, role: 'assistant', content: stewardReply },
    });
    return {
      intakeUuid: sessionUuid,
      senderPhone,
      transcript: transcriptText,
      detectedLanguage,
      intent: 'HEALTH_EDUCATION',
      intentConfidence: classification.confidence,
      healthEducationReply: stewardReply,
      patientMessage: stewardReply,
      status: 'completed',
    };
  }

  private async runBookingDraftTurn(
    transcriptText: string,
    senderPhone: string,
    userId: string,
    sessionUuid: string,
    detectedLanguage?: string,
    language: 'en' | 'sw' = 'en',
    memberName: string | null = null,
  ): Promise<PipelineExecutionResult> {
    const { reply, triageFlag } = await this.bookingService.handleDraftTurn(
      transcriptText,
      senderPhone,
      userId,
      language,
      memberName,
    );

    if (reply === '') {
      const stewardReply = await this.generateMemberReply(
        userId,
        transcriptText,
        language,
        memberName,
        sessionUuid,
      );
      await this.prisma.botMessageLog.create({
        data: { memberId: userId, role: 'assistant', content: stewardReply },
      });
      return {
        intakeUuid: sessionUuid,
        senderPhone,
        transcript: transcriptText,
        detectedLanguage,
        intent: 'HEALTH_EDUCATION',
        intentConfidence: 0.7,
        healthEducationReply: stewardReply,
        patientMessage: stewardReply,
        status: 'completed',
      };
    }

    if (triageFlag) {
      try {
        const clinicalSchema = await this.executeBorderAgent(transcriptText);
        await this.prisma.botLead.create({
          data: {
            memberId: userId,
            type: 'CLINICAL_INTAKE',
            notes: JSON.stringify({
              sessionUuid,
              source: 'booking_triage_flag',
              detectedLanguage,
              clinicalData: clinicalSchema,
            }),
            status: 'URGENT_TRIAGE',
          },
        });
      } catch (e) {
        this.logger.warn(`Border agent run after triageFlag failed: ${e}`);
      }
    }

    await this.prisma.botMessageLog.create({
      data: { memberId: userId, role: 'assistant', content: reply },
    });

    void this.careEvents?.track({
      type: CareEventType.APPOINTMENT_REQUESTED,
      memberId: userId,
      sessionId: sessionUuid,
      source: 'bot-voice-pipeline',
      privacyClass: CarePrivacyClass.OPERATIONAL,
    });

    return {
      intakeUuid: sessionUuid,
      senderPhone,
      transcript: transcriptText,
      detectedLanguage,
      intent: 'BOOKING_SESSION',
      intentConfidence: 1,
      bookingResult: { confirmationMessage: reply },
      patientMessage: reply,
      status: 'completed',
    };
  }

  private async classifyIntent(
    transcript: string,
  ): Promise<{ intent: IntentType; confidence: number }> {
    const prompt = buildIntentClassificationPrompt(transcript);
    try {
      const result = await this.llmProvider.generateCompletion({
        systemPrompt: INTENT_CLASSIFIER_SYSTEM_PROMPT,
        userPrompt: prompt,
        operation: 'voice_intent_classification',
      });
      const cleaned = this.extractJsonString(result);
      const parsed = JSON.parse(cleaned) as {
        intent?: string;
        confidence?: unknown;
      };
      let intent: IntentType = 'HEALTH_EDUCATION';
      if (parsed.intent === 'BOOKING_SESSION') intent = 'BOOKING_SESSION';
      else if (parsed.intent === 'CLINICAL_INTAKE') intent = 'CLINICAL_INTAKE';
      const confidence =
        typeof parsed.confidence === 'number' ? parsed.confidence : 0.95;
      return { intent, confidence };
    } catch (error) {
      this.logger.warn(
        `Intent classification parsing failed, using fallback heuristic: ${error}`,
      );
      const lower = transcript.toLowerCase();
      const bookingKeywords = [
        'book',
        'schedule',
        'appointment',
        'reserve',
        'session',
        'miadi',
        'panga',
        'slot',
        'nafasi',
        'tarehe',
      ];
      const clinicalKeywords = [
        'maumivu',
        'jino',
        'meno',
        'pain',
        'ache',
        'hurt',
        'bleed',
        'damu',
        'uvimbe',
        'swelling',
        'kuuma',
        'tibu',
      ];
      if (bookingKeywords.some((k) => lower.includes(k))) {
        return { intent: 'BOOKING_SESSION', confidence: 0.85 };
      }
      if (clinicalKeywords.some((k) => lower.includes(k))) {
        return { intent: 'CLINICAL_INTAKE', confidence: 0.8 };
      }
      return { intent: 'HEALTH_EDUCATION', confidence: 0.8 };
    }
  }

  private async executeBorderAgent(
    transcript: string,
  ): Promise<ClinicalIntakeSchema> {
    const systemPrompt = BORDER_AGENT_SYSTEM_PROMPT;
    const userPrompt = buildBorderAgentUserPrompt(transcript);
    try {
      const response = await this.llmProvider.generateCompletion({
        systemPrompt,
        userPrompt,
        operation: 'voice_clinical_intake',
      });
      const cleaned = this.extractJsonString(response);
      return JSON.parse(cleaned) as ClinicalIntakeSchema;
    } catch (error) {
      this.logger.error(`Border agent clinical extraction error: ${error}`);
      return {
        primary_symptom: 'Dental consultation request',
        patient_verbatim_quote: transcript,
        anatomical_location: 'unspecified',
        duration_and_onset: 'unspecified',
        pain_character: 'unspecified',
        functional_impact: 'unspecified',
        previous_interventions: 'none mentioned',
        immediate_triage_flag: false,
        confidence_score: 0.7,
      };
    }
  }

  /**
   * Generate the member-facing reply through BotAiService (retrieval-grounded
   * Dr. Papi persona, conversation history, member language + name).
   */
  private async generateMemberReply(
    memberId: string,
    transcriptText: string,
    language: 'en' | 'sw',
    memberName: string | null,
    sessionUuid: string,
  ): Promise<string> {
    const history = await this.loadChatHistory(memberId, sessionUuid);
    const { message } = await this.botAi.generateReply(
      transcriptText,
      history,
      'whatsapp_reply',
      {
        language,
        memberName,
      },
    );
    return message;
  }

  /**
   * Build conversation history (last 8 turns) from the durable bot log,
   * excluding the turn that was just persisted.
   */
  private async loadChatHistory(
    memberId: string,
    sessionUuid: string,
  ): Promise<ChatHistoryMessage[]> {
    const logs = await this.prisma.botMessageLog.findMany({
      where: { memberId },
      orderBy: { createdAt: 'desc' },
      take: 9,
    });
    const history: ChatHistoryMessage[] = [];
    for (const log of logs.reverse()) {
      const isCurrentUserTurn =
        log.role === 'user' &&
        log.content.startsWith(`[Session: ${sessionUuid}] `);
      if (isCurrentUserTurn) continue;
      history.push({
        role: log.role === 'assistant' ? 'assistant' : 'user',
        content: log.content.replace(/^\[Session: [^\]]+\]\s*/, ''),
      });
      if (history.length >= 8) break;
    }
    return history;
  }

  /**
   * Language-, member-, and channel-aware clinical receipt. Replaces the old
   * hard-coded Swahili voice-note acknowledgement with a reply that names the
   * reported symptom and respects the member's preferred language.
   */
  private buildClinicalReceipt(
    clinicalSchema: ClinicalIntakeSchema | null | undefined,
    language: 'en' | 'sw',
    memberName: string | null,
    isVoice: boolean,
  ): string {
    const name = memberName?.trim() ?? '';
    const symptom = clinicalSchema?.primary_symptom ?? 'dental concern';
    const receipt =
      language === 'sw'
        ? CLINICAL_RECEIPT.sw(name, symptom, isVoice)
        : CLINICAL_RECEIPT.en(name, symptom, isVoice);
    if (clinicalSchema?.immediate_triage_flag) {
      return `${receipt}\n\n🚨 Tafadhali nenda kliniki iliyo karibu au wasiliana na timu yetu ya haraka. / Please contact the nearest clinic or our urgent care team immediately.`;
    }
    return receipt;
  }

  private extractJsonString(raw: string): string {
    let clean = raw.trim();
    if (clean.startsWith('```json')) {
      clean = clean.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    } else if (clean.startsWith('```')) {
      clean = clean.replace(/^```\s*/, '').replace(/\s*```$/, '');
    }
    return clean;
  }
}
