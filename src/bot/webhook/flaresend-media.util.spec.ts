import {
  extractFlaresendAudio,
  extractFlaresendFieldMedia,
} from './flaresend-media.util';

describe('FlareSend media extraction', () => {
  it('detects Baileys-style audio messages', () => {
    const media = extractFlaresendAudio({
      data: {
        from: '254712345678@s.whatsapp.net',
        message: {
          audioMessage: {
            mimetype: 'audio/ogg; codecs=opus',
            url: 'https://cdn.example.org/audio.ogg',
          },
        },
      },
    });
    expect(media).toMatchObject({
      kind: 'AUDIO',
      mimeType: 'audio/ogg; codecs=opus',
    });
  });

  it('detects flat typed audio payloads with a relative download path', () => {
    const media = extractFlaresendAudio({
      data: {
        from: '254712345678@s.whatsapp.net',
        message: {
          type: 'audio',
          directPath: '/media/voice-1',
          mimetype: 'audio/mpeg',
          caption: 'Morning clinic note',
        },
      },
    });
    expect(media).toMatchObject({
      kind: 'AUDIO',
      mimeType: 'audio/mpeg',
      caption: 'Morning clinic note',
    });
  });

  it('detects nested audio payloads', () => {
    const media = extractFlaresendAudio({
      data: {
        from: '254712345678@s.whatsapp.net',
        message: {
          message: {
            audio: { url: 'https://cdn.example.org/voice.ogg' },
          },
        },
      },
    });
    expect(media?.kind).toBe('AUDIO');
  });

  it('detects images and preserves captions for field data', () => {
    const media = extractFlaresendFieldMedia({
      data: {
        from: '254712345678@s.whatsapp.net',
        message: {
          imageMessage: {
            mimetype: 'image/jpeg',
            caption: 'Camp register — 42 attendees',
            url: 'https://cdn.example.org/register.jpg',
          },
        },
      },
    });
    expect(media).toMatchObject({
      kind: 'IMAGE',
      caption: 'Camp register — 42 attendees',
    });
  });

  it('does not mistake text messages for media', () => {
    expect(
      extractFlaresendFieldMedia({
        data: { message: { conversation: 'Hello doctor' } },
      }),
    ).toBeNull();
  });
});
