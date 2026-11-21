import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { FoundationSiteService } from './foundation-site.service';

const UPDATED_AT = new Date('2026-11-22T12:00:00.000Z');

function buildService(payload: Record<string, unknown>) {
  const prisma = {
    foundationSiteContent: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ payload, updatedAt: UPDATED_AT }),
      upsert: jest.fn(),
    },
    clinic: { findMany: jest.fn().mockResolvedValue([]) },
    clinicOverride: undefined,
    member: { count: jest.fn().mockResolvedValue(0) },
    subscription: { count: jest.fn().mockResolvedValue(0) },
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
});
