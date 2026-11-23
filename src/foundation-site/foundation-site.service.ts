import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { FOUNDATION_PLAYBACK_RATES } from './foundation-settings.dto';

export type FounderPhotoMeta = {
  hasPhoto: boolean;
  url: string | null;
  updatedAt: string | null;
  mimeType: string | null;
};

export type FoundationClinicCard = {
  id: string;
  name: string;
  location: string;
  chairs: number | null;
  isAnchor: boolean;
  isNamedPartner: boolean;
  hidden: boolean;
  logoUrl: string | null;
};

export type FoundationImpact = {
  registeredMembers: number;
  peopleReached: number;
  peopleScreened: number;
  treatmentsDone: number;
  totalReferrals: number;
  campsConducted: number;
};

export type FieldImpactTotals = {
  peopleReached: number;
  peopleScreened: number;
  treatmentsDone: number;
};

function impactNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : null;
  }
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.max(0, Math.trunc(numeric)) : null;
  }
  return null;
}

/**
 * Pure aggregation of parsed field documents. Only the three approved,
 * status-filtered submission rows are passed in; the caller owns the query.
 * Legacy `peopleSeen` / `patientCount` values still count as peopleReached.
 */
export function sumFieldImpact(
  submissions: Array<{ extracted?: unknown } | null | undefined>,
): FieldImpactTotals {
  const totals: FieldImpactTotals = {
    peopleReached: 0,
    peopleScreened: 0,
    treatmentsDone: 0,
  };
  for (const submission of submissions) {
    const extracted = submission?.extracted;
    if (!extracted || typeof extracted !== 'object' || Array.isArray(extracted)) {
      continue;
    }
    const source = extracted as Record<string, unknown>;
    totals.peopleReached +=
      impactNumber(source.peopleReached) ??
      impactNumber(source.peopleSeen) ??
      impactNumber(source.patientCount) ??
      0;
    totals.peopleScreened += impactNumber(source.peopleScreened) ?? 0;
    totals.treatmentsDone += impactNumber(source.treatmentsDone) ?? 0;
  }
  return totals;
}

export type FoundationHeroContent = {
  videoUrl: string | null;
  posterUrl: string | null;
  playbackRate: number;
  autoplay: boolean;
  muted: boolean;
  loop: boolean;
};

export type FoundationFounderVideo = {
  videoUrl: string | null;
  posterUrl: string | null;
  caption: string | null;
  playbackRate: number;
  muted: boolean;
};

export type FoundationMediaItem = {
  id: string;
  kind: 'image' | 'video';
  src: string;
  posterUrl: string | null;
  alt: string | null;
  altSw: string | null;
  caption: string | null;
  captionSw: string | null;
  href: string | null;
  playbackRate: number;
};

export type FoundationCopyLocale = {
  eyebrow: string | null;
  h1: string | null;
  subhead: string | null;
  primaryCta: string | null;
  secondaryCta: string | null;
  challengeTitle: string | null;
  pillarsTitle: string | null;
  letterEyebrow: string | null;
  letterTitle: string | null;
  letterBody: string | null;
  letterSummary: string | null;
  involvedTitle: string | null;
  involvedBody: string | null;
};

export type FoundationContentCopy = {
  en: FoundationCopyLocale;
  sw: FoundationCopyLocale;
};

type ClinicOverride = {
  displayName: string | null;
  location: string | null;
  hidden: boolean;
};

type FoundationSettings = {
  whatsappNumber: string | null;
  anchorClinicId: string | null;
  clinicalClassification: string | null;
  impact: {
    registeredMembers: number | null;
    peopleReached: number | null;
    peopleScreened: number | null;
    treatmentsDone: number | null;
    totalReferrals: number | null;
    campsConducted: number | null;
  };
  clinicOverrides: Record<string, ClinicOverride>;
  hero: FoundationHeroContent;
  founderVideo: FoundationFounderVideo;
  mediaItems: FoundationMediaItem[];
  copy: FoundationContentCopy;
};

type UpdateFoundationSettingsInput = {
  whatsappNumber?: string | null;
  anchorClinicId?: string | null;
  clinicalClassification?: string | null;
  impact?: Partial<FoundationSettings['impact']>;
  clinics?: {
    id: string;
    displayName?: string | null;
    location?: string | null;
    hidden?: boolean;
  }[];
  hero?: Partial<FoundationHeroContent>;
  founderVideo?: Partial<FoundationFounderVideo>;
  mediaItems?: Partial<FoundationMediaItem>[];
  copy?: {
    en?: Partial<FoundationCopyLocale>;
    sw?: Partial<FoundationCopyLocale>;
  };
};

type ImageFile = {
  buffer: Buffer;
  mimeType: string;
  mtime: Date;
  path: string;
};

const ALLOWED: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

const MAX_BYTES = 2 * 1024 * 1024;
const FILE_STEM = 'founder-note';
const ANCHOR_LOGO_STEM = 'anchor-logo';
const ANCHOR_FALLBACK_ID = 'mikindani';
const ANCHOR_FALLBACK_NAME = 'Mikindani Hospital Dental Unit';
const ANCHOR_FALLBACK_LOCATION = 'Mikindani, Mombasa, Kenya';
const SETTINGS_FILE = 'settings.json';
const CONTENT_ROW_ID = 'primary';
const MAX_MEDIA_ITEMS = 12;
const EMPTY_IMPACT = {
  registeredMembers: null,
  peopleReached: null,
  peopleScreened: null,
  treatmentsDone: null,
  totalReferrals: null,
  campsConducted: null,
};

const EMPTY_COPY: FoundationCopyLocale = {
  eyebrow: null,
  h1: null,
  subhead: null,
  primaryCta: null,
  secondaryCta: null,
  challengeTitle: null,
  pillarsTitle: null,
  letterEyebrow: null,
  letterTitle: null,
  letterBody: null,
  letterSummary: null,
  involvedTitle: null,
  involvedBody: null,
};

const DEFAULT_SETTINGS: FoundationSettings = {
  whatsappNumber: null,
  anchorClinicId: null,
  clinicalClassification: null,
  impact: { ...EMPTY_IMPACT },
  clinicOverrides: {},
  hero: {
    videoUrl: null,
    posterUrl: null,
    playbackRate: 1,
    autoplay: true,
    muted: true,
    loop: true,
  },
  founderVideo: {
    videoUrl: null,
    posterUrl: null,
    caption: null,
    playbackRate: 1,
    muted: true,
  },
  mediaItems: [],
  copy: { en: { ...EMPTY_COPY }, sw: { ...EMPTY_COPY } },
};

@Injectable()
export class FoundationSiteService {
  private readonly dir = join(process.cwd(), 'uploads', 'foundation');
  private readonly clinicDir = join(this.dir, 'clinics');

  constructor(
    private config: ConfigService,
    private prisma: PrismaService,
  ) {}

  getMeta(publicBase: string): FounderPhotoMeta {
    return this.imageMeta(
      this.findStemFile(this.dir, FILE_STEM),
      publicBase,
      'founder-photo',
    );
  }

  savePhoto(buffer: Buffer, mimetype: string) {
    this.writeStemImage(this.dir, FILE_STEM, buffer, mimetype);
  }

  removePhoto() {
    if (!this.findStemFile(this.dir, FILE_STEM)) {
      throw new NotFoundException('No founder photo is on file.');
    }
    this.clearStemFiles(this.dir, FILE_STEM);
  }

  readPhoto(): ImageFile {
    const file = this.findStemFile(this.dir, FILE_STEM);
    if (!file) {
      throw new NotFoundException('No founder photo is on file.');
    }
    return file;
  }

  async getPublicSite(publicBase: string) {
    const { settings, updatedAt } = await this.readSettingsRecord();
    const photo = this.getMeta(publicBase);
    const clinics = await this.buildClinicCards(publicBase, settings);
    const visible = clinics.filter((clinic) => !clinic.hidden);
    const live = await this.liveImpact();
    const impact = this.resolveImpact(live, settings);

    return {
      founderPhotoUrl: photo.url,
      updatedAt: photo.updatedAt,
      contentUpdatedAt: updatedAt,
      whatsappNumber: settings.whatsappNumber,
      clinicalClassification: settings.clinicalClassification,
      hero: settings.hero,
      founderVideo: settings.founderVideo,
      mediaItems: settings.mediaItems,
      copy: settings.copy,
      clinics: visible,
      impact,
    };
  }

  async getAdminNetwork(publicBase: string) {
    const { settings, updatedAt } = await this.readSettingsRecord();
    const clinics = await this.buildClinicCards(publicBase, settings);
    const liveImpact = await this.liveImpact();
    return {
      whatsappNumber: settings.whatsappNumber,
      anchorClinicId: settings.anchorClinicId,
      clinicalClassification: settings.clinicalClassification,
      liveImpact,
      publishedImpact: settings.impact,
      impact: this.resolveImpact(liveImpact, settings),
      clinics: clinics.map((clinic) => ({
        ...clinic,
        logo: this.clinicLogoMeta(clinic.id, publicBase),
      })),
      hero: settings.hero,
      founderVideo: settings.founderVideo,
      mediaItems: settings.mediaItems,
      copy: settings.copy,
      contentUpdatedAt: updatedAt,
    };
  }

  async updateSettings(input: UpdateFoundationSettingsInput) {
    const current = await this.readSettings();
    if (input.whatsappNumber !== undefined) {
      current.whatsappNumber = this.normalizeWhatsApp(input.whatsappNumber);
    }
    if (input.anchorClinicId !== undefined) {
      current.anchorClinicId = await this.resolveAnchorId(input.anchorClinicId);
    }
    if (input.clinicalClassification !== undefined) {
      current.clinicalClassification = normalizeText(
        input.clinicalClassification,
        2000,
      );
    }
    if (input.impact) {
      current.impact = {
        registeredMembers: this.optionalCount(input.impact.registeredMembers),
        peopleReached: this.optionalCount(input.impact.peopleReached),
        peopleScreened: this.optionalCount(input.impact.peopleScreened),
        treatmentsDone: this.optionalCount(input.impact.treatmentsDone),
        totalReferrals: this.optionalCount(input.impact.totalReferrals),
        campsConducted: this.optionalCount(input.impact.campsConducted),
      };
    }
    if (input.clinics) {
      for (const row of input.clinics) {
        const id = this.normalizeClinicId(row.id);
        current.clinicOverrides[id] = {
          displayName: normalizeText(row.displayName, 200),
          location: normalizeText(row.location, 300),
          hidden: Boolean(row.hidden),
        };
      }
    }
    if (input.hero !== undefined) {
      current.hero = normalizeHero(input.hero, current.hero);
    }
    if (input.founderVideo !== undefined) {
      current.founderVideo = normalizeFounderVideo(
        input.founderVideo,
        current.founderVideo,
      );
    }
    if (input.mediaItems !== undefined) {
      current.mediaItems = normalizeMediaItems(input.mediaItems);
    }
    if (input.copy !== undefined) {
      current.copy = normalizeCopy(input.copy, current.copy);
    }
    await this.writeSettings(current);
    return current;
  }

  saveClinicLogo(id: string, buffer: Buffer, mimetype: string) {
    const slot = this.logoSlot(id);
    this.writeStemImage(slot.dir, slot.stem, buffer, mimetype);
  }

  removeClinicLogo(id: string) {
    const slot = this.logoSlot(id);
    if (!this.findStemFile(slot.dir, slot.stem)) {
      throw new NotFoundException('No logo is on file for this clinic.');
    }
    this.clearStemFiles(slot.dir, slot.stem);
  }

  readClinicLogo(id: string): ImageFile {
    const slot = this.logoSlot(id);
    const file = this.findStemFile(slot.dir, slot.stem);
    if (!file) {
      throw new NotFoundException('No logo is on file for this clinic.');
    }
    return file;
  }

  publicBaseFromRequest(protocol: string, host?: string): string {
    const configured = this.config.get<string>('PUBLIC_API_URL');
    if (configured) return this.normalizeBase(configured);
    if (host) return this.normalizeBase(`${protocol}://${host}`);
    return 'http://localhost:3000';
  }

  private async buildClinicCards(
    publicBase: string,
    settings: FoundationSettings,
  ): Promise<FoundationClinicCard[]> {
    const approved = await this.prisma.clinic.findMany({
      where: { status: 'APPROVED', parentClinicId: null },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        subCounty: true,
        physicalLocation: true,
        activeDentalChairs: true,
      },
    });

    const mikindaniRecord = approved.find((clinic) =>
      this.isMikindani(clinic.name),
    );
    const designated = approved.find(
      (clinic) => clinic.id === settings.anchorClinicId,
    );
    const anchorId =
      designated?.id || mikindaniRecord?.id || ANCHOR_FALLBACK_ID;

    const cards: FoundationClinicCard[] = approved.map((clinic) =>
      this.toCard(
        {
          id: clinic.id,
          name: clinic.name,
          location: [clinic.physicalLocation, clinic.subCounty]
            .filter(Boolean)
            .join(', '),
          chairs: clinic.activeDentalChairs,
          isNamedPartner: this.isMikindani(clinic.name),
        },
        clinic.id === anchorId,
        publicBase,
        settings.clinicOverrides[clinic.id],
      ),
    );

    if (!mikindaniRecord) {
      cards.unshift(
        this.toCard(
          {
            id: ANCHOR_FALLBACK_ID,
            name: ANCHOR_FALLBACK_NAME,
            location: ANCHOR_FALLBACK_LOCATION,
            chairs: null,
            isNamedPartner: true,
          },
          anchorId === ANCHOR_FALLBACK_ID,
          publicBase,
          settings.clinicOverrides[ANCHOR_FALLBACK_ID],
        ),
      );
    }

    return cards.sort((a, b) => {
      if (a.isAnchor !== b.isAnchor) return a.isAnchor ? -1 : 1;
      if (a.isNamedPartner !== b.isNamedPartner)
        return a.isNamedPartner ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }

  private toCard(
    clinic: {
      id: string;
      name: string;
      location: string;
      chairs: number | null;
      isNamedPartner: boolean;
    },
    isAnchor: boolean,
    publicBase: string,
    override?: ClinicOverride,
  ): FoundationClinicCard {
    return {
      ...clinic,
      name: override?.displayName || clinic.name,
      location: override?.location || clinic.location,
      hidden: Boolean(override?.hidden),
      isAnchor,
      logoUrl: this.clinicLogoMeta(clinic.id, publicBase).url,
    };
  }

  private async liveImpact(): Promise<FoundationImpact> {
    const [registeredMembers, campsConducted, totalReferrals, submissions] =
      await Promise.all([
        this.prisma.member.count(),
        this.prisma.camp.count({ where: { isActive: true } }),
        this.prisma.member.count({
          where: { referredBy: { not: null } },
        }),
        this.prisma.fieldSubmission.findMany({
          where: { status: { in: ['PARSED', 'PROCESSED'] } },
          select: { extracted: true },
        }),
      ]);

    const fieldTotals = sumFieldImpact(submissions);

    return {
      registeredMembers: registeredMembers ?? 0,
      peopleReached: fieldTotals.peopleReached,
      peopleScreened: fieldTotals.peopleScreened,
      treatmentsDone: fieldTotals.treatmentsDone,
      totalReferrals: totalReferrals ?? 0,
      campsConducted: campsConducted ?? 0,
    };
  }

  private resolveImpact(
    live: FoundationImpact,
    settings: FoundationSettings,
  ): FoundationImpact {
    return {
      registeredMembers:
        settings.impact.registeredMembers ?? live.registeredMembers,
      peopleReached: settings.impact.peopleReached ?? live.peopleReached,
      peopleScreened: settings.impact.peopleScreened ?? live.peopleScreened,
      treatmentsDone: settings.impact.treatmentsDone ?? live.treatmentsDone,
      totalReferrals: settings.impact.totalReferrals ?? live.totalReferrals,
      campsConducted: settings.impact.campsConducted ?? live.campsConducted,
    };
  }

  private optionalCount(value: number | null | undefined) {
    if (value == null || Number.isNaN(Number(value))) return null;
    return Math.max(0, Math.trunc(Number(value)));
  }

  private clinicLogoMeta(id: string, publicBase: string): FounderPhotoMeta {
    const slot = this.logoSlot(id);
    return this.imageMeta(
      this.findStemFile(slot.dir, slot.stem),
      publicBase,
      `clinic-logo/${encodeURIComponent(id)}`,
    );
  }

  private logoSlot(id: string) {
    const safe = this.normalizeClinicId(id);
    if (safe === ANCHOR_FALLBACK_ID) {
      return { dir: this.dir, stem: ANCHOR_LOGO_STEM };
    }
    return { dir: this.clinicDir, stem: safe };
  }

  private normalizeClinicId(id: string) {
    const value = String(id || '').trim();
    if (value === ANCHOR_FALLBACK_ID) return value;
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        value,
      )
    ) {
      throw new BadRequestException('Unknown clinic.');
    }
    return value;
  }

  private async resolveAnchorId(id: string | null) {
    if (!id) return null;
    if (id === ANCHOR_FALLBACK_ID) return null;
    const clinic = await this.prisma.clinic.findFirst({
      where: { id, status: 'APPROVED', parentClinicId: null },
      select: { id: true },
    });
    if (!clinic) {
      throw new BadRequestException('Choose an approved clinic as the anchor.');
    }
    return clinic.id;
  }

  private normalizeWhatsApp(value: string | null) {
    if (value == null || !String(value).trim()) return null;
    let digits = String(value).replace(/\D/g, '');
    if (digits.startsWith('0') && digits.length === 10) {
      digits = `254${digits.slice(1)}`;
    } else if (digits.length === 9 && digits.startsWith('7')) {
      digits = `254${digits}`;
    }
    if (digits.length < 10 || digits.length > 15) {
      throw new BadRequestException(
        'Enter a valid WhatsApp number, including country code.',
      );
    }
    return digits;
  }

  private isMikindani(name: string) {
    return /mikindani/i.test(name);
  }

  private async readSettingsRecord(): Promise<{
    settings: FoundationSettings;
    updatedAt: string | null;
  }> {
    try {
      const row = await this.prisma.foundationSiteContent.findUnique({
        where: { id: CONTENT_ROW_ID },
      });
      if (row?.payload) {
        return {
          settings: normalizeSettings(
            row.payload as unknown as Partial<FoundationSettings>,
          ),
          updatedAt: row.updatedAt.toISOString(),
        };
      }
    } catch {
      // Keep serving the last known file snapshot if the table is not ready.
    }
    return { settings: this.readLegacySettings(), updatedAt: null };
  }

  private async readSettings(): Promise<FoundationSettings> {
    return (await this.readSettingsRecord()).settings;
  }

  private async writeSettings(settings: FoundationSettings) {
    // Mirror to the legacy file so a still-running old container sees the same
    // content during a rolling deploy. Postgres is the durable source of truth.
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(
      join(this.dir, SETTINGS_FILE),
      JSON.stringify(settings, null, 2),
    );

    await this.prisma.foundationSiteContent.upsert({
      where: { id: CONTENT_ROW_ID },
      create: {
        id: CONTENT_ROW_ID,
        payload: settings as unknown as Prisma.InputJsonValue,
      },
      update: {
        payload: settings as unknown as Prisma.InputJsonValue,
      },
    });
  }

  private readLegacySettings(): FoundationSettings {
    const path = join(this.dir, SETTINGS_FILE);
    if (!existsSync(path)) return normalizeSettings(DEFAULT_SETTINGS);
    try {
      return normalizeSettings(
        JSON.parse(readFileSync(path, 'utf8')) as Partial<FoundationSettings>,
      );
    } catch {
      return normalizeSettings(DEFAULT_SETTINGS);
    }
  }

  private imageMeta(
    file: ImageFile | null,
    publicBase: string,
    path: string,
  ): FounderPhotoMeta {
    if (!file) {
      return { hasPhoto: false, url: null, updatedAt: null, mimeType: null };
    }
    const updatedAt = file.mtime.toISOString();
    return {
      hasPhoto: true,
      url: `${this.normalizeBase(publicBase)}/public/foundation/${path}?v=${encodeURIComponent(updatedAt)}`,
      updatedAt,
      mimeType: file.mimeType,
    };
  }

  private writeStemImage(
    dir: string,
    stem: string,
    buffer: Buffer,
    mimetype: string,
  ) {
    const ext = ALLOWED[mimetype];
    if (!ext) {
      throw new BadRequestException('Use a JPEG, PNG, or WebP image.');
    }
    if (!buffer?.length) {
      throw new BadRequestException('The uploaded file is empty.');
    }
    if (buffer.length > MAX_BYTES) {
      throw new BadRequestException('Image must be 2 MB or smaller.');
    }
    mkdirSync(dir, { recursive: true });
    this.clearStemFiles(dir, stem);
    writeFileSync(join(dir, `${stem}${ext}`), buffer);
  }

  private findStemFile(dir: string, stem: string): ImageFile | null {
    if (!existsSync(dir)) return null;
    for (const [mimeType, ext] of Object.entries(ALLOWED)) {
      const path = join(dir, `${stem}${ext}`);
      if (!existsSync(path)) continue;
      return {
        path,
        buffer: readFileSync(path),
        mimeType,
        mtime: statSync(path).mtime,
      };
    }
    return null;
  }

  private clearStemFiles(dir: string, stem: string) {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      if (name.startsWith(stem)) {
        unlinkSync(join(dir, name));
      }
    }
  }

  private normalizeBase(url: string) {
    return url.replace(/\/$/, '');
  }
}

function normalizeText(value: unknown, max: number): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;
  return text.slice(0, max);
}

function normalizeMediaUrl(value: unknown, max = 2000): string | null {
  const text = normalizeText(value, max);
  if (!text) return null;
  try {
    const parsed = new URL(text);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
      return null;
    return text;
  } catch {
    return null;
  }
}

function normalizeRate(value: unknown, fallback = 1): number {
  const rate = Number(value);
  return FOUNDATION_PLAYBACK_RATES.includes(
    rate as (typeof FOUNDATION_PLAYBACK_RATES)[number],
  )
    ? rate
    : fallback;
}

function normalizeHero(
  input: Partial<FoundationHeroContent> | null | undefined,
  fallback: FoundationHeroContent,
): FoundationHeroContent {
  return {
    videoUrl:
      input?.videoUrl !== undefined
        ? normalizeMediaUrl(input.videoUrl)
        : fallback.videoUrl,
    posterUrl:
      input?.posterUrl !== undefined
        ? normalizeMediaUrl(input.posterUrl)
        : fallback.posterUrl,
    playbackRate:
      input?.playbackRate !== undefined
        ? normalizeRate(input.playbackRate, fallback.playbackRate)
        : fallback.playbackRate,
    autoplay:
      input?.autoplay !== undefined
        ? Boolean(input.autoplay)
        : fallback.autoplay,
    muted: input?.muted !== undefined ? Boolean(input.muted) : fallback.muted,
    loop: input?.loop !== undefined ? Boolean(input.loop) : fallback.loop,
  };
}

function normalizeFounderVideo(
  input: Partial<FoundationFounderVideo> | null | undefined,
  fallback: FoundationFounderVideo,
): FoundationFounderVideo {
  return {
    videoUrl:
      input?.videoUrl !== undefined
        ? normalizeMediaUrl(input.videoUrl)
        : fallback.videoUrl,
    posterUrl:
      input?.posterUrl !== undefined
        ? normalizeMediaUrl(input.posterUrl)
        : fallback.posterUrl,
    caption:
      input?.caption !== undefined
        ? normalizeText(input.caption, 160)
        : fallback.caption,
    playbackRate:
      input?.playbackRate !== undefined
        ? normalizeRate(input.playbackRate, fallback.playbackRate)
        : fallback.playbackRate,
    muted: input?.muted !== undefined ? Boolean(input.muted) : fallback.muted,
  };
}

function normalizeMediaItems(
  input: Partial<FoundationMediaItem>[] | null | undefined,
): FoundationMediaItem[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  return input
    .slice(0, MAX_MEDIA_ITEMS)
    .map((item, index) => {
      const src = normalizeMediaUrl(item.src);
      if (!src) return null;
      let id = normalizeText(item.id, 60) || `media-${index + 1}`;
      if (seen.has(id)) id = `${id}-${index + 1}`;
      seen.add(id);
      return {
        id,
        kind: item.kind === 'video' ? 'video' : 'image',
        src,
        posterUrl: normalizeMediaUrl(item.posterUrl),
        alt: normalizeText(item.alt, 240),
        altSw: normalizeText(item.altSw, 240),
        caption: normalizeText(item.caption, 240),
        captionSw: normalizeText(item.captionSw, 240),
        href: normalizeMediaUrl(item.href),
        playbackRate: normalizeRate(item.playbackRate),
      } satisfies FoundationMediaItem;
    })
    .filter((item): item is FoundationMediaItem => item !== null);
}

function normalizeCopyLocale(
  input: Partial<FoundationCopyLocale> | null | undefined,
  fallback: FoundationCopyLocale,
): FoundationCopyLocale {
  const result = { ...fallback };
  if (!input) return result;
  for (const key of Object.keys(EMPTY_COPY) as (keyof FoundationCopyLocale)[]) {
    if (input[key] !== undefined) {
      result[key] = normalizeText(
        input[key],
        key === 'letterBody' ? 1600 : key === 'letterSummary' ? 600 : 500,
      );
    }
  }
  return result;
}

function normalizeCopy(
  input:
    | {
        en?: Partial<FoundationCopyLocale>;
        sw?: Partial<FoundationCopyLocale>;
      }
    | null
    | undefined,
  fallback: FoundationContentCopy,
): FoundationContentCopy {
  return {
    en: normalizeCopyLocale(input?.en, fallback.en),
    sw: normalizeCopyLocale(input?.sw, fallback.sw),
  };
}

function normalizeSettings(
  input: Partial<FoundationSettings>,
): FoundationSettings {
  return {
    whatsappNumber: input.whatsappNumber || null,
    anchorClinicId: input.anchorClinicId || null,
    clinicalClassification: input.clinicalClassification || null,
    impact: {
      registeredMembers: input.impact?.registeredMembers ?? null,
      peopleReached: input.impact?.peopleReached ?? null,
      peopleScreened: input.impact?.peopleScreened ?? null,
      treatmentsDone: input.impact?.treatmentsDone ?? null,
      totalReferrals: input.impact?.totalReferrals ?? null,
      campsConducted: input.impact?.campsConducted ?? null,
    },
    clinicOverrides: input.clinicOverrides || {},
    hero: normalizeHero(input.hero, DEFAULT_SETTINGS.hero),
    founderVideo: normalizeFounderVideo(
      input.founderVideo,
      DEFAULT_SETTINGS.founderVideo,
    ),
    mediaItems: normalizeMediaItems(input.mediaItems),
    copy: normalizeCopy(input.copy, DEFAULT_SETTINGS.copy),
  };
}
