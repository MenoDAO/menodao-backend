import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { AssemblyAiService } from '../assemblyai/assemblyai.service';
import type { ILlmProvider } from '../ai/interfaces/llm-provider.interface';
import { LLM_PROVIDER } from '../ai/interfaces/llm-provider.interface';
import { randomUUID } from 'crypto';
import { BookingService } from '../booking/booking.service';
import {
  BORDER_AGENT_SYSTEM_PROMPT,
  INTENT_CLASSIFIER_SYSTEM_PROMPT,
  SYNTHETIC_STEWARD_SYSTEM_PROMPT,
  buildBorderAgentUserPrompt,
  buildIntentClassificationPrompt,
  buildSyntheticStewardUserPrompt,
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

const STATIC_CLINICAL_RECEIPT_SWAHILI =
  'Asante. Ujumbe wako wa sauti umepokelewa na kuandaliwa daktari wetu (Dr. Ruwa). ' +
  'Tutawasiliana nawe hivi karibuni kupitia nambari hii kupanga muda wa kuonana na daktari au kukupa maelekezo zaidi.\n\n---\n*Dr. Papi Foundation*';

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
      return {
        intakeUuid: sessionUuid,
        senderPhone,
        transcript: transcriptText,
        detectedLanguage,
        intent: 'HEALTH_EDUCATION',
        intentConfidence: 0,
        patientMessage:
          'Samahani, haiwezi kutambua namba hii. Tafadhali wasiliana na kliniki ya karibu.',
        status: 'failed',
        error: 'UNRESOLVED_MEMBER',
      };
    }
    const userId = member.id;
    const e164 = member.phoneNumber;

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
      await this.prisma.botMessageLog.create({
        data: {
          memberId: userId,
          role: 'assistant',
          content: STATIC_CLINICAL_RECEIPT_SWAHILI,
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
        patientMessage: STATIC_CLINICAL_RECEIPT_SWAHILI,
        status: 'completed',
      };
    }

    const stewardReply = await this.executeSyntheticSteward(transcriptText);
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
  ): Promise<PipelineExecutionResult> {
    const { reply, triageFlag } = await this.bookingService.handleDraftTurn(
      transcriptText,
      senderPhone,
      userId,
    );

    if (reply === '') {
      const stewardReply = await this.executeSyntheticSteward(transcriptText);
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

  private async executeSyntheticSteward(transcript: string): Promise<string> {
    const systemPrompt = SYNTHETIC_STEWARD_SYSTEM_PROMPT;
    const userPrompt = buildSyntheticStewardUserPrompt(transcript);
    const response = await this.llmProvider.generateCompletion({
      systemPrompt,
      userPrompt,
      operation: 'voice_health_education',
    });
    return response.trim();
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
