import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { LLM_PROVIDER } from '../ai/interfaces/llm-provider.interface';
import type { ILlmProvider } from '../ai/interfaces/llm-provider.interface';
import { PrismaService } from '../../prisma/prisma.service';
import { FieldMediaStorageService } from './field-media-storage.service';

export const FIELD_MEDIA_KINDS = ['IMAGE', 'VIDEO', 'DOCUMENT', 'AUDIO'] as const;
export type FieldMediaKind = (typeof FIELD_MEDIA_KINDS)[number];

export const FIELD_SUBMISSION_STATUSES = [
  'PENDING',
  'PARSED',
  'NEEDS_REVIEW',
  'PROCESSED',
  'REJECTED',
] as const;
export type FieldSubmissionStatus = (typeof FIELD_SUBMISSION_STATUSES)[number];

export const FIELD_CONTRIBUTOR_ROLES = [
  'DOCTOR',
  'PHYSICIAN',
  'HEALTH_PERSONNEL',
  'NURSE',
] as const;
export type FieldContributorRole = (typeof FIELD_CONTRIBUTOR_ROLES)[number];

export interface IngestFieldMediaInput {
  phoneCandidates: Array<string | null | undefined>;
  memberId?: string | null;
  providerMessageId?: string | null;
  whatsappId?: string | null;
  kind: FieldMediaKind;
  mimeType: string;
  buffer: Buffer;
  caption?: string | null;
  originalFilename?: string | null;
}

export interface IngestFieldMediaResult {
  accepted: boolean;
  submissionId?: string;
  status?: FieldSubmissionStatus;
  reply: string;
}

interface ParsedFieldDocument {
  reportType?: string;
  eventDate?: string;
  location?: string;
  campName?: string;
  peopleReached?: number | string | null;
  peopleScreened?: number | string | null;
  treatmentsDone?: number | string | null;
  referrals?: number | string | null;
  // Legacy keys are still accepted from older models and stored as-is.
  patientCount?: number | string | null;
  peopleSeen?: number | string | null;
  summary?: string;
  observations?: string[];
  clinicalFindings?: string[];
  actionsTaken?: string[];
  followUp?: string[];
  confidence?: number | string | null;
  unclear?: string[];
  [key: string]: unknown;
}

const SYSTEM_PROMPT = [
  'You extract structured field and clinical notes from an image uploaded by an authorised health worker.',
  'Return ONLY one JSON object. Never invent facts. If text is illegible or ambiguous, put the uncertain item in "unclear" and lower "confidence".',
  'Do not diagnose and do not recommend medication. Transcribe what the document says.',
  'Use keys: reportType, eventDate, location, campName, peopleReached, peopleScreened, treatmentsDone, referrals, patientCount, peopleSeen, summary, observations, clinicalFindings, actionsTaken, followUp, confidence (0-1), unclear (array).',
  'peopleReached, peopleScreened, treatmentsDone and referrals must be plain numbers (whole counts) or null when the document does not state them. patientCount and peopleSeen are legacy aliases for peopleReached.',
  'Empty arrays are fine when a key is not present in the document.',
].join(' ');

function stripNonDigits(value: string | null | undefined): string {
  return (value || '').replace(/\D/g, '');
}

/** Accepts E.164, local Kenyan, or raw digits; stores one canonical JID-free phone. */
export function normalizeFieldPhone(value: string): string | null {
  const digits = stripNonDigits(value);
  if (!digits) return null;
  if (digits.startsWith('254') && digits.length === 12) return digits;
  if (digits.startsWith('0') && digits.length === 10) return `254${digits.slice(1)}`;
  if (digits.startsWith('7') && digits.length === 9) return `254${digits}`;
  if (digits.length >= 9 && digits.length <= 15) return digits;
  return null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
}

function clampConfidence(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.min(1, Math.max(0, numeric));
}

/** Normalise model output to a non-negative integer count, or null if absent. */
function countOrNull(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : null;
  }
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.max(0, Math.trunc(numeric)) : null;
  }
  return null;
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = fenced ? fenced[1] : trimmed;
  try {
    const parsed: unknown = JSON.parse(candidate);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    const first = candidate.indexOf('{');
    const last = candidate.lastIndexOf('}');
    if (first < 0 || last <= first) return null;
    try {
      const parsed: unknown = JSON.parse(candidate.slice(first, last + 1));
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
}

@Injectable()
export class FieldDataService {
  private readonly logger = new Logger(FieldDataService.name);
  private readonly confidenceThreshold: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: FieldMediaStorageService,
    private readonly config: ConfigService,
    @Inject(LLM_PROVIDER) private readonly llm: ILlmProvider,
  ) {
    this.confidenceThreshold = Number(
      this.config.get<string>('FIELD_DATA_CONFIDENCE_THRESHOLD') ?? '0.65',
    );
  }

  async resolveContributor(candidates: Array<string | null | undefined>) {
    const phones = [
      ...new Set(
        candidates
          .map((candidate) => normalizeFieldPhone(candidate || ''))
          .filter((phone): phone is string => Boolean(phone)),
      ),
    ];
    if (phones.length === 0) return null;
    return this.prisma.fieldContributor.findFirst({
      where: { isActive: true, phoneNumber: { in: phones } },
    });
  }

  private replyFor(status: FieldSubmissionStatus, language?: string | null) {
    const sw = (language || '').toLowerCase().startsWith('sw');
    if (status === 'PARSED' || status === 'PROCESSED') {
      return sw
        ? 'Asante. Taarifa zako zimepokelewa na kuhifadhiwa. Timu ya kliniki itazikagua. Asante!'
        : 'Thank you. Your field record was received and saved. The clinical team will review it.';
    }
    return sw
      ? 'Asante. Taarifa zako zimepokelewa. Zinahitaji kuthibitishwa na msimamizi kabla ya kutumika. Asante!'
      : 'Thank you. Your record was received and saved. An administrator needs to verify it before it can be used.';
  }

  async ingestMedia(
    input: IngestFieldMediaInput,
  ): Promise<IngestFieldMediaResult> {
    const contributor = await this.resolveContributor(input.phoneCandidates);
    if (!contributor) {
      return {
        accepted: false,
        reply:
          'Samahani, huduma hii ya kukusanya taarifa za uwanjani ni kwa wataalamu wa afya walioidhinishwa tu. ' +
          'Sorry, this field-data service is only available to authorised doctors and health personnel.',
      };
    }

    const submissionId = this.storage.newSubmissionId();
    let stored;
    try {
      stored = await this.storage.save(
        submissionId,
        input.buffer,
        input.mimeType,
        input.originalFilename,
      );
    } catch (error) {
      this.logger.error(
        `Could not store field media: ${error instanceof Error ? error.message : String(error)}`,
      );
      return {
        accepted: false,
        reply:
          'Samahani, hatukuweza kuhifadhi faili hii kwa sasa. Tafadhali jaribu tena. ' +
          'Sorry, we could not save this file right now. Please try again.',
      };
    }

    const created = await this.prisma.fieldSubmission.create({
      data: {
        id: submissionId,
        contributorId: contributor.id,
        memberId: input.memberId ?? null,
        providerMessageId: input.providerMessageId ?? null,
        whatsappId: input.whatsappId ?? null,
        kind: input.kind,
        mimeType: input.mimeType,
        fileKey: stored.key,
        fileSize: input.buffer.length,
        originalFilename: input.originalFilename ?? null,
        caption: input.caption ?? null,
        status: 'PENDING',
      },
    });

    // Only still images can be read by the current vision model. Video,
    // document and audio uploads are preserved and routed straight to a human.
    if (input.kind !== 'IMAGE' || !input.mimeType.startsWith('image/')) {
      return this.markNeedsReview(
        created.id,
        'No automated parser for this media type; admin verification required.',
      );
    }

    try {
      const raw = await this.llm.generateCompletion({
        systemPrompt: SYSTEM_PROMPT,
        userPrompt: [
          'Extract all legible structured data from this field/clinical document image.',
          input.caption ? `Caption from sender: ${input.caption}` : '',
          'Respond with JSON only.',
        ]
          .filter(Boolean)
          .join('\n'),
        responseFormat: 'json',
        operation: 'field_data.parse',
        images: [
          {
            mimeType: input.mimeType,
            base64: input.buffer.toString('base64'),
          },
        ],
      });
      const parsed = parseJsonObject(raw) as ParsedFieldDocument | null;
      if (!parsed) {
        return this.markNeedsReview(
          created.id,
          'Model did not return valid JSON.',
        );
      }
      const confidence = clampConfidence(parsed.confidence);
      const unclear = asStringArray(parsed.unclear);
      const missingFields: string[] = [];
      if (!parsed.summary || !String(parsed.summary).trim())
        missingFields.push('summary');
      if (
        parsed.peopleReached == null &&
        parsed.patientCount == null &&
        parsed.peopleSeen == null &&
        !/attendance|census|count|registration/i.test(
          String(parsed.reportType || ''),
        )
      ) {
        // Not mandatory for every document, but worth flagging for outreach data.
      }
      const needsReview =
        confidence < this.confidenceThreshold ||
        unclear.length > 0 ||
        missingFields.length > 0;
      const status: FieldSubmissionStatus = needsReview
        ? 'NEEDS_REVIEW'
        : 'PARSED';
      const extracted: Prisma.InputJsonValue = {
        ...parsed,
        // Always persist the aggregation keys. Legacy aliases remain in the
        // payload via the spread, and continue to count as peopleReached.
        peopleReached:
          countOrNull(parsed.peopleReached) ??
          countOrNull(parsed.peopleSeen) ??
          countOrNull(parsed.patientCount),
        peopleScreened: countOrNull(parsed.peopleScreened),
        treatmentsDone: countOrNull(parsed.treatmentsDone),
        referrals: countOrNull(parsed.referrals),
        confidence,
        unclear,
      } as Prisma.InputJsonValue;
      const updated = await this.prisma.fieldSubmission.update({
        where: { id: created.id },
        data: {
          status,
          confidence,
          extracted,
          summary: parsed.summary ? String(parsed.summary).slice(0, 4000) : null,
          missingFields,
          needsAdminReview: needsReview,
          parseError: needsReview
            ? unclear.length
              ? `Unclear fields: ${unclear.join(', ')}`
              : confidence < this.confidenceThreshold
                ? `Low model confidence (${confidence.toFixed(2)}).`
                : `Missing fields: ${missingFields.join(', ')}`
            : null,
        },
      });
      return {
        accepted: true,
        submissionId: updated.id,
        status: updated.status as FieldSubmissionStatus,
        reply: this.replyFor(updated.status as FieldSubmissionStatus),
      };
    } catch (error) {
      this.logger.error(
        `Field document parsing failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return this.markNeedsReview(
        created.id,
        'Automated extraction failed; admin verification required.',
      );
    }
  }

  private async markNeedsReview(
    id: string,
    reason: string,
  ): Promise<IngestFieldMediaResult> {
    const updated = await this.prisma.fieldSubmission.update({
      where: { id: id },
      data: {
        status: 'NEEDS_REVIEW',
        needsAdminReview: true,
        parseError: reason.slice(0, 1000),
      },
    });
    return {
      accepted: true,
      submissionId: updated.id,
      status: 'NEEDS_REVIEW',
      reply: this.replyFor('NEEDS_REVIEW'),
    };
  }

  async listContributors() {
    return this.prisma.fieldContributor.findMany({
      orderBy: [{ isActive: 'desc' }, { displayName: 'asc' }],
    });
  }

  async createContributor(input: {
    phoneNumber: string;
    displayName: string;
    role?: FieldContributorRole;
    organization?: string | null;
  }) {
    const phone = normalizeFieldPhone(input.phoneNumber);
    if (!phone) throw new BadRequestException('Enter a valid phone number.');
    const displayName = input.displayName.trim();
    if (!displayName) throw new BadRequestException('Display name is required.');
    return this.prisma.fieldContributor.upsert({
      where: { phoneNumber: phone },
      create: {
        phoneNumber: phone,
        displayName,
        role: input.role ?? 'HEALTH_PERSONNEL',
        organization: input.organization?.trim() || null,
      },
      update: {
        displayName,
        role: input.role ?? 'HEALTH_PERSONNEL',
        organization: input.organization?.trim() || null,
        isActive: true,
      },
    });
  }

  async updateContributor(
    id: string,
    input: {
      displayName?: string;
      role?: FieldContributorRole;
      organization?: string | null;
      isActive?: boolean;
    },
  ) {
    await this.getContributor(id);
    return this.prisma.fieldContributor.update({
      where: { id },
      data: {
        ...(input.displayName !== undefined
          ? { displayName: input.displayName.trim() }
          : {}),
        ...(input.role !== undefined ? { role: input.role } : {}),
        ...(input.organization !== undefined
          ? { organization: input.organization?.trim() || null }
          : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
    });
  }

  async deleteContributor(id: string) {
    await this.getContributor(id);
    await this.prisma.fieldContributor.delete({ where: { id } });
    return { ok: true };
  }

  private async getContributor(id: string) {
    const contributor = await this.prisma.fieldContributor.findUnique({
      where: { id },
    });
    if (!contributor) throw new NotFoundException('Contributor not found.');
    return contributor;
  }

  async listSubmissions(params: {
    status?: FieldSubmissionStatus;
    contributorId?: string;
    limit: number;
  }) {
    return this.prisma.fieldSubmission.findMany({
      where: {
        ...(params.status ? { status: params.status } : {}),
        ...(params.contributorId ? { contributorId: params.contributorId } : {}),
      },
      include: { contributor: true },
      orderBy: { createdAt: 'desc' },
      take: Math.min(200, Math.max(1, params.limit)),
    });
  }

  async getSubmission(id: string) {
    const submission = await this.prisma.fieldSubmission.findUnique({
      where: { id },
      include: { contributor: true },
    });
    if (!submission) throw new NotFoundException('Submission not found.');
    return submission;
  }

  async getMedia(id: string) {
    const submission = await this.getSubmission(id);
    try {
      return await this.storage.read(submission.fileKey);
    } catch (error) {
      this.logger.error(
        `Could not read field media ${id}: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new NotFoundException('Stored media is no longer available.');
    }
  }

  async reviewSubmission(
    id: string,
    input: {
      status: 'PROCESSED' | 'REJECTED' | 'NEEDS_REVIEW';
      reviewNotes?: string | null;
      extracted?: Prisma.InputJsonValue;
      reviewerAdminId: string;
    },
  ) {
    await this.getSubmission(id);
    return this.prisma.fieldSubmission.update({
      where: { id },
      data: {
        status: input.status,
        reviewNotes: input.reviewNotes?.trim() || null,
        ...(input.extracted !== undefined ? { extracted: input.extracted } : {}),
        needsAdminReview: input.status === 'NEEDS_REVIEW',
        reviewedAt: new Date(),
        reviewerAdminId: input.reviewerAdminId,
      },
      include: { contributor: true },
    });
  }

  async reparseSubmission(id: string) {
    const submission = await this.getSubmission(id);
    if (submission.kind !== 'IMAGE' || !submission.mimeType.startsWith('image/')) {
      throw new BadRequestException('Only image submissions can be re-parsed.');
    }
    const media = await this.getMedia(id);
    const result = await this.ingestMedia({
      phoneCandidates: [submission.contributor.phoneNumber],
      memberId: submission.memberId,
      providerMessageId: null,
      whatsappId: submission.whatsappId,
      kind: 'IMAGE',
      mimeType: submission.mimeType,
      buffer: media.body,
      caption: submission.caption,
      originalFilename: submission.originalFilename,
    });
    if (!result.submissionId) {
      throw new BadRequestException(result.reply);
    }
    // ingestMedia creates a new audit-friendly row; remove the stale draft only
    // after the replacement has been parsed successfully.
    const replacement = await this.getSubmission(result.submissionId);
    if (replacement.status !== 'NEEDS_REVIEW') {
      await this.prisma.fieldSubmission.delete({ where: { id } }).catch(() => undefined);
    }
    return replacement;
  }
}

/**
 * Structural type keeps this service unit-testable without importing the
 * generated Prisma client at module load in Jest mocks.
 */
export interface PrismaServiceLike {
  fieldContributor: {
    findFirst(args: unknown): Promise<any>;
    findMany(args?: unknown): Promise<any[]>;
    findUnique(args: unknown): Promise<any>;
    upsert(args: unknown): Promise<any>;
    update(args: unknown): Promise<any>;
    create(args: unknown): Promise<any>;
    delete(args: unknown): Promise<any>;
  };
  fieldSubmission: {
    create(args: unknown): Promise<any>;
    update(args: unknown): Promise<any>;
    findMany(args?: unknown): Promise<any[]>;
    findUnique(args: unknown): Promise<any>;
    delete(args: unknown): Promise<any>;
  };
}
