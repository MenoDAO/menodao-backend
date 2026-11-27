import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import {
  FoundationSiteService,
  sumFieldImpact,
} from './foundation-site.service';

const UPDATED_AT = new Date('2026-11-22T12:00:00.000Z');

function buildService(
  payload: Record<string, unknown>,
  options: {
    fieldSubmissions?: Array<{ extracted?: unknown }>;
    memberCount?: number;
    referralCount?: number | null;
    campCount?: number;
  } = {},
) {
  const prisma = {
    foundationSiteContent: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ payload, updatedAt: UPDATED_AT }),
      upsert: jest.fn(),
    },
    clinic: { findMany: jest.fn().mockResolvedValue([]) },
    clinicOverride: undefined,
    member: {
      count: jest.fn().mockImplementation((args?: { where?: unknown }) =>
        Promise.resolve(
          args?.where ? (options.referralCount ?? 0) : (options.memberCount ?? 0),
        ),
      ),
    },
    camp: {
      count: jest.fn().mockResolvedValue(options.campCount ?? 0),
    },
    fieldSubmission: {
      findMany: jest
        .fn()
        .mockResolvedValue(options.fieldSubmissions ?? []),
    },
  };
  const config = {
    get: jest.fn().mockReturnValue(null),
  } as unknown as ConfigService;
  const service = new FoundationSiteService(
    config,
    prisma as unknown as PrismaService,
  );
  return { service, prisma };
}

describe('FoundationSiteService content', () => {
  it('publishes DB-backed hero, founder video, media items, and bilingual copy', async () => {
    const { service } = buildService({
      hero: {
        videoUrl: 'https://cdn.example.org/hero.mp4',
        posterUrl: 'https://cdn.example.org/poster.webp',
        playbackRate: 1.5,
        autoplay: true,
        muted: true,
        loop: false,
      },
      founderVideo: {
        videoUrl: 'https://cdn.example.org/founder.mp4',
        posterUrl: null,
        caption: 'Two minutes with Dr. Said',
        playbackRate: 0.75,
        muted: true,
      },
      mediaItems: [
        {
          id: 'clinic',
          kind: 'image',
          src: 'https://cdn.example.org/clinic.webp',
          alt: 'Dental unit',
          caption: 'Clinical base',
        },
        {
          id: 'field',
          kind: 'video',
          src: 'https://cdn.example.org/field.mp4',
          posterUrl: 'https://cdn.example.org/field.webp',
          playbackRate: 2,
        },
      ],
      copy: {
        en: { h1: 'Fresh headline', letterBody: 'Short founder note.' },
        sw: { h1: 'Kichwa kipya' },
      },
    });

    const site = await service.getPublicSite('https://api.example.org');

    expect(site.hero).toMatchObject({
      videoUrl: 'https://cdn.example.org/hero.mp4',
      playbackRate: 1.5,
      loop: false,
    });
    expect(site.founderVideo).toMatchObject({
      videoUrl: 'https://cdn.example.org/founder.mp4',
      playbackRate: 0.75,
    });
    expect(site.mediaItems).toHaveLength(2);
    expect(site.mediaItems[1]).toMatchObject({
      kind: 'video',
      playbackRate: 2,
    });
    expect(site.copy.en.h1).toBe('Fresh headline');
    expect(site.copy.sw.h1).toBe('Kichwa kipya');
    expect(site.contentUpdatedAt).toBe(UPDATED_AT.toISOString());
  });

  it('sanitises media URLs and falls back to a safe playback rate', async () => {
    const { service } = buildService({
      hero: { videoUrl: 'javascript:alert(1)', playbackRate: 99 },
      mediaItems: [
        { id: 'bad', kind: 'image', src: 'file:///etc/passwd' },
        { id: 'good', kind: 'video', src: 'https://cdn.example.org/ok.mp4' },
      ],
    });

    const site = await service.getPublicSite('https://api.example.org');

    expect(site.hero.videoUrl).toBeNull();
    expect(site.hero.playbackRate).toBe(1);
    expect(site.mediaItems).toHaveLength(1);
    expect(site.mediaItems[0].id).toBe('good');
  });

  it('keeps the founder photo URL compatible with the existing snapshot', async () => {
    const { service } = buildService({});
    const site = await service.getPublicSite('https://api.example.org/');
    expect(site.founderPhotoUrl).toBeNull();
    expect(site).toHaveProperty('whatsappNumber');
    expect(site).toHaveProperty('impact');
  });

  it('publishes the six-field impact contract from live data', async () => {
    const { service, prisma } = buildService(
      {},
      {
        memberCount: 120,
        referralCount: 9,
        campCount: 4,
        fieldSubmissions: [
          {
            extracted: {
              peopleReached: 25,
              peopleScreened: 20,
              treatmentsDone: 18,
            },
          },
          {
            extracted: {
              peopleSeen: 12, // legacy alias still counts as peopleReached
              treatmentsDone: 7,
            },
          },
          { extracted: { patientCount: '8', peopleScreened: 3 } },
          { extracted: 'not an object' },
        ],
      },
    );

    const site = await service.getPublicSite('https://api.example.org');

    expect(site.impact).toEqual({
      registeredMembers: 120,
      peopleReached: 45,
      peopleScreened: 23,
      treatmentsDone: 25,
      totalReferrals: 9,
      campsConducted: 4,
    });
    expect(Object.keys(site.impact)).toEqual([
      'registeredMembers',
      'peopleReached',
      'peopleScreened',
      'treatmentsDone',
      'totalReferrals',
      'campsConducted',
    ]);
    expect(prisma.fieldSubmission.findMany).toHaveBeenCalledWith({
      where: { status: { in: ['PARSED', 'PROCESSED'] }, clinicalImage: false, captionRequestedAt: null },
      select: { extracted: true },
    });
    expect(prisma.member.count).toHaveBeenCalledWith({
      where: { referredBy: { not: null } },
    });
  });

  it('applies per-field admin overrides without leaking removed fields', async () => {
    const { service } = buildService(
      {
        impact: {
          peopleReached: 500,
          totalReferrals: 42,
        },
      },
      {
        fieldSubmissions: [
          { extracted: { peopleReached: 3, peopleScreened: 2 } },
        ],
        referralCount: 9,
      },
    );

    const admin = await service.getAdminNetwork('https://api.example.org');
    expect(admin.impact).toEqual({
      registeredMembers: 0,
      peopleReached: 500,
      peopleScreened: 2,
      treatmentsDone: 0,
      totalReferrals: 42,
      campsConducted: 0,
    });
    const contractKeys = [
      'registeredMembers',
      'peopleReached',
      'peopleScreened',
      'treatmentsDone',
      'totalReferrals',
      'campsConducted',
    ];
    expect(Object.keys(admin.publishedImpact)).toEqual(contractKeys);
    expect(Object.keys(admin.liveImpact)).toEqual(contractKeys);
  });

  it('treats a null referral count as zero', async () => {
    const { service } = buildService({}, { referralCount: null });
    const site = await service.getPublicSite('https://api.example.org');
    expect(site.impact.totalReferrals).toBe(0);
  });
});

describe('sumFieldImpact', () => {
  it('ignores non-numeric values and supports legacy aliases', () => {
    expect(
      sumFieldImpact([
        {
          extracted: {
            peopleReached: 'n/a',
            peopleSeen: 6,
            patientCount: 99,
            peopleScreened: 4,
            treatmentsDone: '7',
          },
        },
        { extracted: null },
        { extracted: [] },
        null,
      ]),
    ).toEqual({ peopleReached: 6, peopleScreened: 4, treatmentsDone: 7 });
  });

  it('prefers the current peopleReached key over legacy aliases', () => {
    expect(
      sumFieldImpact([
        {
          extracted: {
            peopleReached: 11,
            peopleSeen: 2,
            patientCount: 3,
          },
        },
      ]).peopleReached,
    ).toBe(11);
  });
});
