import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_BYTES = 32;
const PREFIX = 'v1';

/**
 * Encrypts WhatsApp instance keys at rest.
 *
 * Instance-scoped FlareSend keys are created at runtime when an operator adds
 * an instance from the dashboard, so they cannot live in the image, and the
 * host's SSM user is read-only. Storing them in Postgres under AES-256-GCM with
 * a master key that only exists in SSM keeps the plaintext out of both the
 * database dump and the repository.
 */
@Injectable()
export class BotInstanceSecretService {
  private readonly logger = new Logger(BotInstanceSecretService.name);
  private readonly key: Buffer | null;

  constructor(configService: ConfigService) {
    const raw = (
      configService.get<string>('BOT_SECRET_ENCRYPTION_KEY') ?? ''
    ).trim();
    this.key = BotInstanceSecretService.parseKey(raw);
    if (!this.key) {
      this.logger.warn(
        'BOT_SECRET_ENCRYPTION_KEY is missing or malformed; instance keys cannot be stored. ' +
          'Generate 32 random bytes and push them through the secrets workflow.',
      );
    }
  }

  private static parseKey(raw: string): Buffer | null {
    if (!raw) return null;
    let buffer: Buffer;
    if (/^[0-9a-f]{64}$/i.test(raw)) {
      buffer = Buffer.from(raw, 'hex');
    } else {
      buffer = Buffer.from(raw, 'base64');
    }
    return buffer.length === KEY_BYTES ? buffer : null;
  }

  isConfigured(): boolean {
    return this.key !== null;
  }

  encrypt(plaintext: string): string {
    if (!this.key) {
      throw new Error('BOT_SECRET_ENCRYPTION_KEY is not configured.');
    }
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return [
      PREFIX,
      iv.toString('base64url'),
      tag.toString('base64url'),
      ciphertext.toString('base64url'),
    ].join('.');
  }

  decrypt(payload: string): string {
    if (!this.key) {
      throw new Error('BOT_SECRET_ENCRYPTION_KEY is not configured.');
    }
    const [version, ivPart, tagPart, ciphertextPart] = (payload ?? '').split(
      '.',
    );
    if (version !== PREFIX || !ivPart || !tagPart || !ciphertextPart) {
      throw new Error('Malformed instance key ciphertext.');
    }
    const decipher = createDecipheriv(
      ALGORITHM,
      this.key,
      Buffer.from(ivPart, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextPart, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }

  /** Stable, non-reversible identifier so an operator can tell keys apart. */
  fingerprint(plaintext: string): string {
    return createHash('sha256').update(plaintext).digest('hex').slice(0, 12);
  }
}
