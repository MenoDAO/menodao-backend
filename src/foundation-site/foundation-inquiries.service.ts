import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { FoundationInquiryKind, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../appointments/email.service';

const NOTIFY = ['menodao.org@gmail.com'];

const FORMS: Record<
  string,
  {
    kind: FoundationInquiryKind;
    title: string;
    required: string[];
    nameFields: string[];
    emailFields: string[];
    phoneFields: string[];
    summaryFields: string[];
  }
> = {
  'form-school-intake': {
    kind: FoundationInquiryKind.SCHOOL,
    title: 'School visit request',
    required: [
      'institution',
      'county',
      'contact',
      'role',
      'whatsapp',
      'population',
      'timing',
      'dpa',
      'safeguarding',
    ],
    nameFields: ['contact'],
    emailFields: ['email'],
    phoneFields: ['whatsapp'],
    summaryFields: ['institution', 'county'],
  },
  'form-volunteer-intake': {
    kind: FoundationInquiryKind.VOLUNTEER,
    title: 'Clinical volunteer registration',
    required: ['fullName', 'cadre', 'whatsapp', 'email', 'location', 'availability', 'dpa'],
    nameFields: ['fullName'],
    emailFields: ['email'],
    phoneFields: ['whatsapp'],
    summaryFields: ['cadre', 'location'],
  },
  'form-facility-inquiry': {
    kind: FoundationInquiryKind.FACILITY,
    title: 'Facility collaboration inquiry',
    required: [
      'facilityName',
      'location',
      'accreditation',
      'director',
      'classification',
      'chairs',
      'phone',
      'email',
      'dpa',
    ],
    nameFields: ['director', 'facilityName'],
    emailFields: ['email'],
    phoneFields: ['phone'],
    summaryFields: ['facilityName', 'classification'],
  },
  'form-general-contact': {
    kind: FoundationInquiryKind.CONTACT,
    title: 'General contact',
    required: ['fullName', 'email', 'phone', 'category', 'message', 'dpa'],
    nameFields: ['fullName'],
    emailFields: ['email'],
    phoneFields: ['phone'],
    summaryFields: ['category'],
  },
};

const SKIP_KEYS = new Set(['formId', 'destination']);

@Injectable()
export class FoundationInquiriesService {
  private readonly logger = new Logger(FoundationInquiriesService.name);

  constructor(
    private prisma: PrismaService,
    private email: EmailService,
  ) {}

  async create(formId: string, raw: Record<string, unknown>) {
    const spec = FORMS[formId];
    if (!spec) {
      throw new BadRequestException('Unknown form');
    }

    const fields = this.normalize(raw);
    const missing = spec.required.filter((key) => !this.hasValue(fields[key]));
    if (missing.length > 0) {
      throw new BadRequestException(`Missing required fields: ${missing.join(', ')}`);
    }
    if (fields.dpa !== 'on' && fields.dpa !== 'true') {
      throw new BadRequestException('DPA 2019 consent is required.');
    }
    if (
      formId === 'form-volunteer-intake' &&
      !['chv', 'student'].includes(String(fields.cadre || '')) &&
      !this.hasValue(fields.license)
    ) {
      throw new BadRequestException('Missing required fields: license');
    }

    const name = this.first(fields, spec.nameFields);
    const email = this.first(fields, spec.emailFields);
    const phone = this.first(fields, spec.phoneFields);
    const summary = spec.summaryFields
      .map((key) => this.stringify(fields[key]))
      .filter(Boolean)
      .join(' · ');

    const record = await this.prisma.foundationInquiry.create({
      data: {
        kind: spec.kind,
        formId,
        name,
        email,
        phone,
        summary: summary || null,
        payload: fields as Prisma.InputJsonValue,
      },
    });

    void this.notify(spec.title, record.id, fields).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'unknown';
      this.logger.error(`Inquiry email failed for ${record.id}: ${message}`);
    });

    return { ok: true, id: record.id };
  }

  async list(kind?: string, page = 1, limit = 20) {
    const pageNum = Math.max(Number(page) || 1, 1);
    const limitNum = Math.min(Math.max(Number(limit) || 20, 1), 100);
    const where =
      kind && Object.values(FoundationInquiryKind).includes(kind as FoundationInquiryKind)
        ? { kind: kind as FoundationInquiryKind }
        : {};

    const [items, total] = await Promise.all([
      this.prisma.foundationInquiry.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
        select: {
          id: true,
          kind: true,
          formId: true,
          name: true,
          email: true,
          phone: true,
          summary: true,
          createdAt: true,
        },
      }),
      this.prisma.foundationInquiry.count({ where }),
    ]);

    return { items, total, page: pageNum, limit: limitNum };
  }

  async getById(id: string) {
    const record = await this.prisma.foundationInquiry.findUnique({
      where: { id },
    });
    if (!record) {
      throw new NotFoundException('Inquiry not found');
    }
    return record;
  }

  private async notify(
    title: string,
    id: string,
    fields: Record<string, string | string[]>,
  ) {
    const lines = Object.entries(fields)
      .filter(([key]) => !SKIP_KEYS.has(key))
      .map(([key, value]) => `${key}: ${this.stringify(value)}`);

    const text = [
      `A new Dr. Papi Foundation website inquiry was submitted.`,
      ``,
      `Type: ${title}`,
      `Record: ${id}`,
      ``,
      ...lines,
    ].join('\n');

    const sent = await this.email.send(NOTIFY, `[DPF] ${title}`, text);
    if (sent) {
      this.logger.log(`Notified ${NOTIFY.join(', ')} for inquiry ${id}`);
    } else {
      this.logger.error(`Failed to notify operators for inquiry ${id}`);
    }
  }

  private normalize(raw: Record<string, unknown>) {
    const fields: Record<string, string | string[]> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (SKIP_KEYS.has(key) || value == null) continue;
      if (Array.isArray(value)) {
        const items = value.map((item) => String(item).trim()).filter(Boolean);
        if (items.length) fields[key] = items;
        continue;
      }
      if (typeof value === 'boolean') {
        fields[key] = value ? 'on' : '';
        continue;
      }
      const text = String(value).trim();
      if (text) fields[key] = text;
    }
    return fields;
  }

  private hasValue(value: string | string[] | undefined) {
    if (Array.isArray(value)) return value.length > 0;
    return Boolean(value && value !== 'false');
  }

  private first(
    fields: Record<string, string | string[]>,
    keys: string[],
  ): string | null {
    for (const key of keys) {
      const value = this.stringify(fields[key]);
      if (value) return value;
    }
    return null;
  }

  private stringify(value: string | string[] | undefined) {
    if (Array.isArray(value)) return value.join(', ');
    return value?.trim() || '';
  }
}
