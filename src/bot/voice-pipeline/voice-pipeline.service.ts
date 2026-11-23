import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { AssemblyAiService } from '../assemblyai/assemblyai.service';
import type { ILlmProvider } from '../ai/interfaces/llm-provider.interface';
import { LLM_PROVIDER } from '../ai/interfaces/llm-provider.interface';
import { randomUUID } from 'crypto';
import { normalizeVoiceTranscript } from './voice-transcript.util';
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
import {
  intentGuidance,
  normalizeAction,
  normalizeIntent,
} from '../intents/intent.types';
import type {
  BotActionName,
  IntentClassification,
  IntentEntities,
  IntentType,
} from '../intents/intent.types';
import {
  fallbackClassification,
  isSymptomOnlyMessage,
} from '../intents/intent-fallback';
import { BotActorService } from '../actions/bot-actor.service';
import { BotActionRegistryService } from '../actions/bot-action-registry.service';
import type {
  BotActionContext,
  BotActionResult,
} from '../actions/bot-action.types';
import {
  BotMemberDataService,
  type MemberDataScope,
} from '../account/bot-member-data.service';

export type { IntentType } from '../intents/intent.types';

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

/** Used only if the conversational triage reply cannot be generated. */
const CLINICAL_FALLBACK_REPLY = {
  en: `I'm sorry your tooth is hurting. How long has it been sore, and is there any swelling or bleeding? If the pain is severe, your face is swollen, or you can't breathe or swallow, please seek urgent care now.`,
  sw: `Samahani jino lako linaumia. Limekuwa likiuma kwa muda gani, na kuna uvimbe au damu yoyote? Kama maumivu ni makali sana, uso umevimba, au unashindwa kupumua au kumeza, tafadhali nenda kwa huduma ya dharura sasa.`,
} as const;

const UNRESOLVED_MEMBER_MESSAGE =
  "Samahani, sijaweza kukutambua kwa nambari hii. Kama wewe ni mwanachama, tafadhali wasiliana na kliniki yetu ili tukuunganishe.\n\nSorry, I couldn't match this number to a member account. If you're a member, please contact one of our clinics so we can link your account.";

@Injectable()
export class VoicePipelineService {
  private readonly logger = new Logger(VoicePipelineService.name);
  private readonly voiceResultCache = new Map<
    string,
    { result: PipelineExecutionResult; expiresAt: number }
  >();
  private voiceKeytermsCache?: { terms: string[]; expiresAt: number };

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly assemblyAiService: AssemblyAiService,
    @Inject(LLM_PROVIDER) private readonly llmProvider: ILlmProvider,
    private readonly bookingService: BookingService,
    private readonly identity: BotIdentityService,
    private readonly botAi: BotAiService,
    private readonly actorService: BotActorService,
    private readonly actionRegistry: BotActionRegistryService,
    private readonly memberData: BotMemberDataService,
    @Optional() private readonly careEvents?: CareEventsService,
  ) {}

  async processVoicePipeline(
    audioSource: Buffer | string,
    senderPhone: string = 'simulator-user',
    intakeUuid?: string,
    languageHint?: string | null,
    mediaId?: string | null,
  ): Promise<PipelineExecutionResult> {
    const cacheKey = mediaId ? `voice:${mediaId}` : null;
    if (cacheKey) {
      const cached = this.voiceResultCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        this.logger.log(`Using cached voice transcript for media ${mediaId}`);
        return cached.result;
      }
    }

    const sessionUuid = intakeUuid || randomUUID();
    this.logger.log(
      `Starting voice pipeline execution [${sessionUuid}] for ${senderPhone}`,
    );
    try {
      const keyterms = await this.loadVoiceKeyterms();
      const sttResult = await this.assemblyAiService.transcribeAudio(
        audioSource,
        {
          languageHint,
          keyterms,
        },
      );
      const transcript = sttResult.text;
      if (!transcript || transcript.trim().length === 0) {
        throw new Error('Received empty transcript from audio source.');
      }

      // Avoid acting on very uncertain transcripts. Echoing the heard text
      // lets the member correct us without forcing every voice note through
      // a confirmation step.
      if (sttResult.confidence !== undefined && sttResult.confidence < 0.5) {
        const result: PipelineExecutionResult = {
          intakeUuid: sessionUuid,
          senderPhone,
          transcript,
          detectedLanguage: sttResult.languageCode || languageHint || undefined,
          intent: 'GENERAL_CONVERSATION',
          intentConfidence: sttResult.confidence,
          patientMessage:
            languageHint === 'sw'
              ? `Samahani, sikusikia vizuri. Umesema: "${transcript}". Tafadhali rudia au andika kwa maneno.`
              : `Sorry, I didn't catch that clearly. I heard: "${transcript}". Please repeat or type your message.`,
          status: 'failed',
          error: 'LOW_CONFIDENCE_TRANSCRIPTION',
        };
        return result;
      }

      const result = await this.processTextPipeline(
        transcript,
        senderPhone,
        sessionUuid,
        sttResult.languageCode || languageHint || undefined,
        senderPhone,
        sttResult.duration,
        true,
      );

      if (sttResult.confidence !== undefined && sttResult.confidence < 0.75) {
        const echoPrefix =
          (sttResult.languageCode || languageHint) === 'sw'
            ? 'Nimesikia'
            : 'I heard';
        result.patientMessage = `${echoPrefix}: "${transcript}"\n\n${result.patientMessage}`;
      }

      if (cacheKey) {
        this.voiceResultCache.set(cacheKey, {
          result,
          expiresAt: Date.now() + 10 * 60 * 1000,
        });
      }
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const lower = message.toLowerCase();
      let stage = 'processing';
      if (
        lower.includes('empty transcript') ||
        (lower.includes('transcript') && lower.includes('empty'))
      ) {
        stage = 'stt-empty';
      } else if (lower.includes('assemblyai is not initialized')) {
        stage = 'stt-config';
      } else if (
        lower.includes('assemblyai') ||
        lower.includes('transcrib') ||
        lower.includes('transcript')
      ) {
        stage = 'stt';
      } else if (lower.includes('audio')) {
        stage = 'stt-audio';
      } else if (
        lower.includes('gemini') ||
        lower.includes('llm') ||
        lower.includes('generatecompletion') ||
        lower.includes('model')
      ) {
        stage = 'llm';
      } else if (lower.includes('timeout')) {
        stage = 'timeout';
      }
      this.logger.error(
        `Voice pipeline error [${sessionUuid}] stage=${stage}: ${message}`,
      );
      return {
        intakeUuid: sessionUuid,
        senderPhone,
        transcript: '',
        intent: 'HEALTH_EDUCATION',
        intentConfidence: 0,
        patientMessage:
          'Samahani, hatukuweza kusikiliza ujumbe wako vizuri. Tafadhali jaribu kutuma tena au uandike kwa maneno.' +
          ` (ref: voice-${stage})`,
        status: 'failed',
        error: message,
      };
    }
  }

  async processTextPipeline(
    transcriptText: string,
    senderPhone: string = 'simulator-user',
    intakeUuid?: string,
    detectedLanguage?: string,
    whatsappId: string = senderPhone,
    audioDuration?: number,
    isVoice = false,
  ): Promise<PipelineExecutionResult> {
    const workingTranscript = isVoice
      ? normalizeVoiceTranscript(transcriptText)
      : transcriptText;
    const sessionUuid = intakeUuid || randomUUID();
    this.logger.log(
      `Routing ${isVoice ? 'voice note' : 'message'} [${sessionUuid}]: "${workingTranscript.substring(0, 60)}..."`,
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
        transcript: workingTranscript,
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
        content: `[Session: ${sessionUuid}] ${workingTranscript}`,
      },
    });

    const existingDraft = await this.prisma.botBookingDraft.findUnique({
      where: { memberId: userId },
    });
    let hasActiveDraft = false;
    if (existingDraft) {
      if (this.bookingService.isDraftFresh(existingDraft)) {
        hasActiveDraft = true;
      } else {
        this.logger.log(
          `[${sessionUuid}] Stale booking draft found — deleting and re-classifying`,
        );
        await this.prisma.botBookingDraft.delete({
          where: { memberId: userId },
        });
      }
    }

    const recentHistory = await this.loadChatHistory(userId, sessionUuid);
    const classification = await this.classifyIntent(
      workingTranscript,
      recentHistory,
    );
    this.logger.log(
      `Intent classified [${sessionUuid}]: ${classification.intent} (${classification.confidence})` +
        (classification.action ? ` action=${classification.action}` : ''),
    );

    void this.careEvents?.track({
      type: CareEventType.AI_CONVERSATION_STARTED,
      memberId: userId,
      sessionId: sessionUuid,
      source: isVoice ? 'bot-voice-pipeline' : 'bot-text-pipeline',
      privacyClass: CarePrivacyClass.ANALYTICS,
      metadata: {
        isVoice,
        transcriptLength: workingTranscript.length,
        detectedLanguage: detectedLanguage || null,
        intent: classification.intent,
        intentConfidence: classification.confidence,
        action: classification.action,
        audioDuration: audioDuration || null,
      },
    });

    // Resolve the sender once. An admin phone is only privileged after the
    // explicit ADMIN + SMS verification flow, so normal chat stays member-level.
    const actor = await this.actorService.resolve({
      memberId: userId,
      memberPhone: e164,
      senderId: whatsappId,
      memberName,
    });
    const actionContext: BotActionContext = {
      actor,
      memberId: userId,
      memberPhone: e164,
      senderId: whatsappId,
      language,
      message: workingTranscript,
      sessionId: sessionUuid,
      entities: classification.entities,
    };

    // Bounded runtime execution: the model may propose an action, but the
    // registry validates it, checks the capability server-side, and only then
    // runs it. Unknown or mismatched actions fall through to intent routing.
    const planned = await this.tryPlannedAction(classification, actionContext);
    if (planned) {
      if (planned.route === 'BOOKING') {
        return this.runBookingDraftTurn(
          workingTranscript,
          e164,
          userId,
          sessionUuid,
          detectedLanguage,
          language,
          memberName,
        );
      }
      if (planned.reply) {
        return this.respond({
          memberId: userId,
          transcriptText: workingTranscript,
          senderPhone,
          sessionUuid,
          detectedLanguage,
          language,
          intent: classification.intent,
          confidence: classification.confidence,
          reply: planned.reply,
        });
      }
    }

    if (classification.intent === 'AVAILABILITY_INQUIRY') {
      return this.runAvailabilityInquiry(
        workingTranscript,
        e164,
        userId,
        sessionUuid,
        detectedLanguage,
        language,
        memberName,
        hasActiveDraft,
      );
    }

    if (
      classification.intent === 'BOOKING_SESSION' ||
      (hasActiveDraft && classification.intent === 'GENERAL_CONVERSATION')
    ) {
      // A fresh draft handles confirmations ("yes", "sawa") as conversation.
      // Side questions (pricing, directions, symptoms) are answered instead of
      // being swallowed by the booking state machine.
      return this.runBookingDraftTurn(
        workingTranscript,
        e164,
        userId,
        sessionUuid,
        detectedLanguage,
        language,
        memberName,
      );
    }

    if (classification.intent === 'CLINICAL_INTAKE') {
      const clinicalSchema = await this.executeBorderAgent(workingTranscript);
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
      const triageReply = await this.generateMemberReply(
        userId,
        workingTranscript,
        language,
        memberName,
        sessionUuid,
        'CLINICAL_INTAKE',
        recentHistory,
      );
      const clinicalReceipt = this.buildClinicalReceipt(
        triageReply,
        clinicalSchema,
        language,
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
        transcript: workingTranscript,
        detectedLanguage,
        intent: 'CLINICAL_INTAKE',
        intentConfidence: classification.confidence,
        clinicalIntake: clinicalSchema,
        patientMessage: clinicalReceipt,
        status: 'completed',
      };
    }

    if (classification.intent === 'APPOINTMENT_MANAGEMENT') {
      return this.runMemberRecordReply(
        'APPOINTMENTS',
        actionContext,
        classification,
        workingTranscript,
        senderPhone,
        sessionUuid,
        detectedLanguage,
      );
    }

    if (classification.intent === 'ACCOUNT_AND_BILLING') {
      const scope: MemberDataScope =
        (classification.entities?.scope as MemberDataScope | undefined) ??
        'ACCOUNT';
      return this.runMemberRecordReply(
        scope,
        actionContext,
        classification,
        workingTranscript,
        senderPhone,
        sessionUuid,
        detectedLanguage,
      );
    }

    if (classification.intent === 'HUMAN_HANDOFF') {
      return this.runActionReply(
        'ESCALATE_TO_HUMAN',
        actionContext,
        classification,
        workingTranscript,
        senderPhone,
        sessionUuid,
        detectedLanguage,
      );
    }

    if (classification.intent === 'COMPLAINT_OR_FEEDBACK') {
      return this.runActionReply(
        'LOG_FEEDBACK',
        actionContext,
        classification,
        workingTranscript,
        senderPhone,
        sessionUuid,
        detectedLanguage,
      );
    }

    if (classification.intent === 'ADMIN_DATA_REQUEST') {
      // No action chosen, or the action fell through: never let the general
      // persona answer a privileged request. Explain the verification path.
      const reply =
        language === 'sw'
          ? 'Ufikiaji wa rekodi za mwanachama mwingine unahitaji uthibitisho. Tuma ADMIN kuanza, kisha tuma nambari ya simu ya mwanachama na ujibu kwa msimbo wa SMS.'
          : 'Access to another member’s records needs verification. Send ADMIN to start, then send the member’s phone number and reply with the SMS code.';
      return this.respond({
        memberId: userId,
        transcriptText: workingTranscript,
        senderPhone,
        sessionUuid,
        detectedLanguage,
        language,
        intent: classification.intent,
        confidence: classification.confidence,
        reply,
      });
    }

    return this.runConversationalReply(
      classification,
      actionContext,
      workingTranscript,
      senderPhone,
      sessionUuid,
      detectedLanguage,
      recentHistory,
    );
  }

  /**
   * Run an LLM-proposed action only when it is in the closed registry and fits
   * the classified intent. Returns null when the caller should use normal
   * intent routing instead.
   */
  private async tryPlannedAction(
    classification: IntentClassification,
    ctx: BotActionContext,
  ): Promise<BotActionResult | null> {
    const action = classification.action;
    if (!action || !this.actionRegistry.isKnown(action)) return null;

    const allowedForIntent: Partial<Record<IntentType, BotActionName[]>> = {
      AVAILABILITY_INQUIRY: ['GET_AVAILABILITY'],
      BOOKING_SESSION: ['START_BOOKING'],
      APPOINTMENT_MANAGEMENT: ['GET_MY_RECORDS'],
      ACCOUNT_AND_BILLING: ['GET_MY_RECORDS'],
      HUMAN_HANDOFF: ['ESCALATE_TO_HUMAN'],
      COMPLAINT_OR_FEEDBACK: ['LOG_FEEDBACK'],
      ADMIN_DATA_REQUEST: ['GET_MEMBER_RECORDS'],
    };
    const permitted = allowedForIntent[classification.intent] ?? [];
    if (!permitted.includes(action)) {
      this.logger.warn(
        `Ignoring action ${action} for intent ${classification.intent} (not permitted)`,
      );
      return null;
    }

    return this.actionRegistry.execute(action, ctx);
  }

  private async runMemberRecordReply(
    scope: MemberDataScope,
    ctx: BotActionContext,
    classification: IntentClassification,
    transcriptText: string,
    senderPhone: string,
    sessionUuid: string,
    detectedLanguage?: string,
  ): Promise<PipelineExecutionResult> {
    const reply = await this.memberData.handleRequest(
      { id: ctx.memberId, phoneNumber: ctx.memberPhone },
      scope,
    );
    return this.respond({
      memberId: ctx.memberId,
      transcriptText,
      senderPhone,
      sessionUuid,
      detectedLanguage,
      language: ctx.language,
      intent: classification.intent,
      confidence: classification.confidence,
      reply,
    });
  }

  private async runActionReply(
    action: BotActionName,
    ctx: BotActionContext,
    classification: IntentClassification,
    transcriptText: string,
    senderPhone: string,
    sessionUuid: string,
    detectedLanguage?: string,
  ): Promise<PipelineExecutionResult> {
    const result = await this.actionRegistry.execute(action, ctx);
    const reply =
      result.reply ||
      (ctx.language === 'sw'
        ? 'Nimepokea ombi lako. Timu yetu itakufuata hivi karibuni.'
        : 'I have received your request. Our team will follow up shortly.');
    return this.respond({
      memberId: ctx.memberId,
      transcriptText,
      senderPhone,
      sessionUuid,
      detectedLanguage,
      language: ctx.language,
      intent: classification.intent,
      confidence: classification.confidence,
      reply,
    });
  }

  private async runConversationalReply(
    classification: IntentClassification,
    ctx: BotActionContext,
    transcriptText: string,
    senderPhone: string,
    sessionUuid: string,
    detectedLanguage?: string,
    history?: ChatHistoryMessage[],
  ): Promise<PipelineExecutionResult> {
    const reply = await this.generateMemberReply(
      ctx.memberId,
      transcriptText,
      ctx.language,
      ctx.actor.displayName ?? null,
      sessionUuid,
      classification.intent,
      history,
    );
    return this.respond({
      memberId: ctx.memberId,
      transcriptText,
      senderPhone,
      sessionUuid,
      detectedLanguage,
      language: ctx.language,
      intent: classification.intent,
      confidence: classification.confidence,
      reply,
    });
  }

  /** Persist the assistant turn and shape the pipeline result. */
  private async respond(params: {
    memberId: string;
    transcriptText: string;
    senderPhone: string;
    sessionUuid: string;
    detectedLanguage?: string;
    language: 'en' | 'sw';
    intent: IntentType;
    confidence: number;
    reply: string;
  }): Promise<PipelineExecutionResult> {
    const {
      memberId,
      transcriptText,
      senderPhone,
      sessionUuid,
      detectedLanguage,
      intent,
      confidence,
      reply,
    } = params;
    await this.prisma.botMessageLog.create({
      data: { memberId, role: 'assistant', content: reply },
    });
    return {
      intakeUuid: sessionUuid,
      senderPhone,
      transcript: transcriptText,
      detectedLanguage,
      intent,
      intentConfidence: confidence,
      ...(intent === 'HEALTH_EDUCATION' ||
      intent === 'GENERAL_CONVERSATION' ||
      intent === 'PRICING_AND_COVERAGE' ||
      intent === 'CLINIC_INFO' ||
      intent === 'PROCEDURE_EXPLAINER' ||
      intent === 'PREPARATION_AND_AFTERCARE'
        ? { healthEducationReply: reply }
        : {}),
      patientMessage: reply,
      status: 'completed',
    };
  }

  private async runAvailabilityInquiry(
    transcriptText: string,
    senderPhone: string,
    userId: string,
    sessionUuid: string,
    detectedLanguage: string | undefined,
    language: 'en' | 'sw',
    memberName: string | null,
    hasActiveDraft: boolean,
  ): Promise<PipelineExecutionResult> {
    const reply = await this.bookingService.describeAvailability(
      transcriptText,
      language,
    );
    const suffix = hasActiveDraft
      ? language === 'sw'
        ? '\n\n(Ukiwa tayari kuendelea na miadi uliyokuwa ukiweka, niambie tu.)'
        : "\n\n(If you'd like to continue with the booking you started, just tell me.)"
      : '';
    const finalReply = `${reply}${suffix}`;
    await this.prisma.botMessageLog.create({
      data: { memberId: userId, role: 'assistant', content: finalReply },
    });
    return {
      intakeUuid: sessionUuid,
      senderPhone,
      transcript: transcriptText,
      detectedLanguage,
      intent: 'AVAILABILITY_INQUIRY',
      intentConfidence: 0.9,
      patientMessage: finalReply,
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

  private async loadVoiceKeyterms(): Promise<string[]> {
    const now = Date.now();
    if (this.voiceKeytermsCache && this.voiceKeytermsCache.expiresAt > now) {
      return this.voiceKeytermsCache.terms;
    }

    try {
      const [clinics, procedures] = await Promise.all([
        this.prisma.clinic.findMany({
          where: { status: 'APPROVED' },
          select: {
            name: true,
            subCounty: true,
            doctors: {
              where: { isActive: true },
              select: { name: true, specialty: true },
            },
          },
        }),
        this.prisma.procedure.findMany({
          where: { isActive: true },
          select: { name: true },
        }),
      ]);

      const terms = new Set<string>([
        'MenoDAO',
        'Dr Papi',
        'dental',
        'clinic',
        'appointment',
        'booking',
        'insurance',
        'member',
        'kesho',
        'leo',
        'asubuhi',
        'mchana',
        'jioni',
        'usiku',
      ]);

      for (const clinic of clinics) {
        if (clinic.name) terms.add(clinic.name);
        if (clinic.subCounty) terms.add(clinic.subCounty);
        for (const doctor of clinic.doctors ?? []) {
          if (doctor.name) terms.add(doctor.name);
          if (doctor.specialty) terms.add(doctor.specialty);
        }
      }
      for (const procedure of procedures) {
        if (procedure.name) terms.add(procedure.name);
      }

      const result = Array.from(terms)
        .map((term) => term.trim())
        .filter(Boolean)
        .slice(0, 200);
      this.voiceKeytermsCache = {
        terms: result,
        expiresAt: now + 5 * 60 * 1000,
      };
      return result;
    } catch (error) {
      this.logger.warn(`Could not load dynamic voice keyterms: ${error}`);
      return [
        'MenoDAO',
        'Dr Papi',
        'dental',
        'clinic',
        'appointment',
        'booking',
      ];
    }
  }

  private async classifyIntent(
    transcript: string,
    history: ChatHistoryMessage[] = [],
  ): Promise<IntentClassification> {
    const historyText = history
      .map((message) => `${message.role}: ${message.content}`)
      .join('\n');
    const prompt = buildIntentClassificationPrompt(transcript, historyText);
    try {
      const result = await this.llmProvider.generateCompletion({
        systemPrompt: INTENT_CLASSIFIER_SYSTEM_PROMPT,
        userPrompt: prompt,
        operation: 'voice_intent_classification',
      });
      const cleaned = this.extractJsonString(result);
      const parsed = JSON.parse(cleaned) as Record<string, unknown>;
      const intent = normalizeIntent(parsed.intent) ?? 'HEALTH_EDUCATION';
      const action = normalizeAction(parsed.action);
      const confidence =
        typeof parsed.confidence === 'number'
          ? Math.min(Math.max(parsed.confidence, 0), 1)
          : 0.8;
      let entities = this.parseEntities(parsed.entities);
      if (action === 'GET_MEMBER_RECORDS' && !entities?.memberPhone) {
        const phone = this.extractPhone(transcript);
        if (phone) {
          entities ??= {};
          entities.memberPhone = phone;
        }
      }
      const reasoning =
        typeof parsed.reasoning === 'string'
          ? parsed.reasoning.slice(0, 200)
          : undefined;
      const classification = {
        intent,
        confidence,
        action,
        entities,
        reasoning,
      };
      return this.applySymptomFirstGuard(transcript, classification);
    } catch (error) {
      this.logger.warn(
        `Intent classification parsing failed, using fallback heuristic: ${error}`,
      );
      return this.applySymptomFirstGuard(
        transcript,
        fallbackClassification(transcript),
      );
    }
  }

  /**
   * A sore tooth is a question before it is a booking. Even if the classifier
   * proposes START_BOOKING, a symptom-only message is routed to triage first.
   */
  private applySymptomFirstGuard(
    transcript: string,
    classification: IntentClassification,
  ): IntentClassification {
    if (
      isSymptomOnlyMessage(transcript) &&
      classification.intent !== 'CLINICAL_INTAKE'
    ) {
      this.logger.log(
        `Symptom-first guard applied [${transcript.slice(0, 40)}]: ${classification.intent} -> CLINICAL_INTAKE`,
      );
      return {
        ...classification,
        intent: 'CLINICAL_INTAKE',
        action: null,
        confidence: Math.max(classification.confidence, 0.9),
        reasoning: 'symptom_first',
      };
    }
    return classification;
  }

  private parseEntities(raw: unknown): IntentEntities | undefined {
    if (!raw || typeof raw !== 'object') return undefined;
    const source = raw as Record<string, unknown>;
    const pick = (key: string): string | undefined => {
      const value = source[key];
      return typeof value === 'string' && value.trim()
        ? value.trim()
        : undefined;
    };
    const scopeRaw = pick('scope')?.toUpperCase();
    const scopes: MemberDataScope[] = [
      'ACCOUNT',
      'PAYMENTS',
      'APPOINTMENTS',
      'VISITS',
      'CLAIMS',
    ];
    const scope = scopes.includes(scopeRaw as MemberDataScope)
      ? (scopeRaw as MemberDataScope)
      : undefined;
    const entities: IntentEntities = {
      clinic: pick('clinic'),
      doctor: pick('doctor'),
      date: pick('date'),
      time: pick('time'),
      service: pick('service'),
      memberPhone: pick('memberPhone'),
      scope,
    };
    const hasValue = Object.values(entities).some((value) => value != null);
    return hasValue ? entities : undefined;
  }

  private extractPhone(text: string): string | undefined {
    const match = (text || '').match(
      /(?:\+?254|0)?7\d{2}[\s-]?\d{3}[\s-]?\d{3}/,
    );
    return match?.[0]?.replace(/[^\d]/g, '');
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
    intent: IntentType = 'HEALTH_EDUCATION',
    history?: ChatHistoryMessage[],
  ): Promise<string> {
    const chatHistory =
      history ?? (await this.loadChatHistory(memberId, sessionUuid));
    const { message } = await this.botAi.generateReply(
      transcriptText,
      chatHistory,
      'whatsapp_reply',
      {
        language,
        memberName,
        intent,
        intentGuidance: intentGuidance(intent),
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
   * Adds an urgent-care line for red flags to the conversational triage reply.
   * No receipt, signature or "we'll arrange a visit" promise — the member
   * should feel heard first, not processed.
   */
  private buildClinicalReceipt(
    triageReply: string,
    clinicalSchema: ClinicalIntakeSchema | null | undefined,
    language: 'en' | 'sw',
  ): string {
    const reply = triageReply.trim() || CLINICAL_FALLBACK_REPLY[language];
    if (clinicalSchema?.immediate_triage_flag) {
      const urgentLine =
        language === 'sw'
          ? '🚨 Usisubiri. Nenda kliniki iliyo karibu au piga huduma ya dharura sasa.'
          : "🚨 Don't wait. Go to the nearest clinic or call emergency services now.";
      return `${reply}\n\n${urgentLine}`;
    }
    // Keep it to the conversational reply — no signature and no "forwarded to
    // the team" promise, which felt like a brush-off when someone is in pain.
    return reply;
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
