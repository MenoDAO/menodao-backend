import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateFoundationSettingsDto } from './foundation-settings.dto';

describe('UpdateFoundationSettingsDto', () => {
  it('accepts configured media and bilingual copy', async () => {
    const dto = plainToInstance(UpdateFoundationSettingsDto, {
      hero: {
        videoUrl: 'https://cdn.example.org/hero.mp4',
        posterUrl: 'https://cdn.example.org/poster.webp',
        playbackRate: 1.5,
        autoplay: false,
      },
      founderVideo: {
        videoUrl: 'https://youtube.com/watch?v=abc',
        playbackRate: 0.5,
      },
      mediaItems: [
        {
          id: 'clinic-1',
          kind: 'image',
          src: 'https://cdn.example.org/clinic.webp',
          alt: 'Clinic',
          captionSw: 'Kliniki',
        },
      ],
      copy: { en: { h1: 'A fresh headline' }, sw: { h1: 'Kichwa kipya' } },
    });

    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects non-http media URLs and unsupported speeds', async () => {
    const dto = plainToInstance(UpdateFoundationSettingsDto, {
      hero: { videoUrl: 'javascript:alert(1)', playbackRate: 7 },
      mediaItems: [{ id: 'bad', kind: 'image', src: 'file:///tmp/x.mp4' }],
    });

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });
});
