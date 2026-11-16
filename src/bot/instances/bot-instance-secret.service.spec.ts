import { randomBytes } from 'crypto';
import type { ConfigService } from '@nestjs/config';
import { BotInstanceSecretService } from './bot-instance-secret.service';

function serviceWithKey(key?: string): BotInstanceSecretService {
  const config = {
    get: (name: string) =>
      name === 'BOT_SECRET_ENCRYPTION_KEY' ? key : undefined,
  } as unknown as ConfigService;
  return new BotInstanceSecretService(config);
}

describe('BotInstanceSecretService', () => {
  const key = randomBytes(32).toString('base64');

  it('round-trips a key', () => {
    const svc = serviceWithKey(key);
    const ciphertext = svc.encrypt('instance-key-abcdef123456');
    expect(ciphertext).not.toContain('instance-key');
    expect(svc.decrypt(ciphertext)).toBe('instance-key-abcdef123456');
  });

  it('produces a different ciphertext each time (random IV)', () => {
    const svc = serviceWithKey(key);
    expect(svc.encrypt('same')).not.toBe(svc.encrypt('same'));
  });

  it('rejects a tampered ciphertext', () => {
    const svc = serviceWithKey(key);
    const ciphertext = svc.encrypt('secret');
    const parts = ciphertext.split('.');
    // Flip a character in the ciphertext body.
    parts[3] = parts[3].slice(0, -2) + (parts[3].endsWith('AA') ? 'BB' : 'AA');
    expect(() => svc.decrypt(parts.join('.'))).toThrow();
  });

  it('rejects a malformed payload', () => {
    const svc = serviceWithKey(key);
    expect(() => svc.decrypt('not-a-ciphertext')).toThrow(/Malformed/);
  });

  it('accepts a hex key and refuses a wrong-length key', () => {
    const hexSvc = serviceWithKey(randomBytes(32).toString('hex'));
    expect(hexSvc.isConfigured()).toBe(true);
    expect(hexSvc.decrypt(hexSvc.encrypt('x'))).toBe('x');

    expect(serviceWithKey('too-short').isConfigured()).toBe(false);
    expect(serviceWithKey().isConfigured()).toBe(false);
  });

  it('refuses to encrypt without a configured key', () => {
    const svc = serviceWithKey();
    expect(() => svc.encrypt('x')).toThrow(/not configured/);
  });

  it('fingerprints without revealing the key', () => {
    const svc = serviceWithKey(key);
    const fingerprint = svc.fingerprint('instance-key-abcdef123456');
    expect(fingerprint).toHaveLength(12);
    expect(fingerprint).not.toContain('instance');
  });
});
