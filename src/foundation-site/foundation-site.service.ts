import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
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
  contributingMembers: number;
  approvedFacilities: number;
  counties: number;
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
    contributingMembers: number | null;
    approvedFacilities: number | null;
    counties: number | null;
  };
  clinicOverrides: Record<string, ClinicOverride>;
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
const EMPTY_IMPACT = {
  registeredMembers: null,
  contributingMembers: null,
  approvedFacilities: null,
  counties: null,
};

const DEFAULT_SETTINGS: FoundationSettings = {
  whatsappNumber: null,
  anchorClinicId: null,
  clinicalClassification: null,
  impact: { ...EMPTY_IMPACT },
  clinicOverrides: {},
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
    return this.imageMeta(this.findStemFile(this.dir, FILE_STEM), publicBase, 'founder-photo');
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
    const photo = this.getMeta(publicBase);
    const settings = this.readSettings();
    const clinics = await this.buildClinicCards(publicBase, settings);
    const visible = clinics.filter((clinic) => !clinic.hidden);
    const live = await this.liveImpact(visible.length);
    const impact = this.resolveImpact(live, settings);

    return {
      founderPhotoUrl: photo.url,
      updatedAt: photo.updatedAt,
      whatsappNumber: settings.whatsappNumber,
      clinicalClassification: settings.clinicalClassification,
      clinics: visible,
      impact,
    };
  }

  async getAdminNetwork(publicBase: string) {
    const settings = this.readSettings();
    const clinics = await this.buildClinicCards(publicBase, settings);
    const liveImpact = await this.liveImpact(
      clinics.filter((clinic) => !clinic.hidden).length,
    );
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
    };
  }

  async updateSettings(input: {
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
  }) {
    const current = this.readSettings();
    if (input.whatsappNumber !== undefined) {
      current.whatsappNumber = this.normalizeWhatsApp(input.whatsappNumber);
    }
    if (input.anchorClinicId !== undefined) {
      current.anchorClinicId = await this.resolveAnchorId(input.anchorClinicId);
    }
    if (input.clinicalClassification !== undefined) {
      const text = input.clinicalClassification?.trim() || null;
      current.clinicalClassification = text;
    }
    if (input.impact) {
      current.impact = {
        registeredMembers: this.optionalCount(input.impact.registeredMembers),
        contributingMembers: this.optionalCount(input.impact.contributingMembers),
        approvedFacilities: this.optionalCount(input.impact.approvedFacilities),
        counties: this.optionalCount(input.impact.counties),
      };
    }
    if (input.clinics) {
      for (const row of input.clinics) {
        const id = this.normalizeClinicId(row.id);
        current.clinicOverrides[id] = {
          displayName: row.displayName?.trim() || null,
          location: row.location?.trim() || null,
          hidden: Boolean(row.hidden),
        };
      }
    }
    this.writeSettings(current);
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

    const mikindaniRecord = approved.find((clinic) => this.isMikindani(clinic.name));
    const designated = approved.find((clinic) => clinic.id === settings.anchorClinicId);
    const anchorId = designated?.id || mikindaniRecord?.id || ANCHOR_FALLBACK_ID;

    const cards: FoundationClinicCard[] = approved.map((clinic) =>
      this.toCard(
        {
          id: clinic.id,
          name: clinic.name,
          location: [clinic.physicalLocation, clinic.subCounty].filter(Boolean).join(', '),
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
      if (a.isNamedPartner !== b.isNamedPartner) return a.isNamedPartner ? -1 : 1;
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

  private async liveImpact(visibleFacilities: number): Promise<FoundationImpact> {
    const [registeredMembers, contributingMembers] = await Promise.all([
      this.prisma.member.count(),
      this.prisma.subscription.count({ where: { isActive: true } }),
    ]);
    return {
      registeredMembers,
      contributingMembers,
      approvedFacilities: visibleFacilities,
      counties: 2,
    };
  }

  private resolveImpact(live: FoundationImpact, settings: FoundationSettings): FoundationImpact {
    return {
      registeredMembers: settings.impact.registeredMembers ?? live.registeredMembers,
      contributingMembers: settings.impact.contributingMembers ?? live.contributingMembers,
      approvedFacilities: settings.impact.approvedFacilities ?? live.approvedFacilities,
      counties: settings.impact.counties ?? live.counties,
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
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
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
      throw new BadRequestException('Enter a valid WhatsApp number, including country code.');
    }
    return digits;
  }

  private isMikindani(name: string) {
    return /mikindani/i.test(name);
  }

  private readSettings(): FoundationSettings {
    const path = join(this.dir, SETTINGS_FILE);
    if (!existsSync(path)) return { ...DEFAULT_SETTINGS };
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<FoundationSettings>;
      return {
        whatsappNumber: parsed.whatsappNumber || null,
        anchorClinicId: parsed.anchorClinicId || null,
        clinicalClassification: parsed.clinicalClassification || null,
        impact: {
          registeredMembers: parsed.impact?.registeredMembers ?? null,
          contributingMembers: parsed.impact?.contributingMembers ?? null,
          approvedFacilities: parsed.impact?.approvedFacilities ?? null,
          counties: parsed.impact?.counties ?? null,
        },
        clinicOverrides: parsed.clinicOverrides || {},
      };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  private writeSettings(settings: FoundationSettings) {
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(join(this.dir, SETTINGS_FILE), JSON.stringify(settings, null, 2));
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
