import { Injectable } from '@nestjs/common';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'crypto';
import {
  hashOtpCode,
  verifyOtpCode as verifyOtpCodeHash,
} from '../auth/otp-hash.util';

/**
 * AES-256-GCM encryption for calendar OAuth tokens stored at rest, plus
 * HMAC helpers for OTP code hashing.
 *
 * - The cipher key comes from `CALENDAR_TOKEN_ENCRYPTION_KEY` (preferred) or
 *   falls back to the existing `JWT_SECRET` key material.
 * - Tokens must never sit in plain text in the database; API keys themselves
 *   stay in env only and are never persisted.
 */

export const CIPHER_ALGORITHM = 'aes-256-gcm' as const;
const IV_LENGTH_BYTES = 12;
const AUTH_TAG_LENGTH_BYTES = 16;

function deriveKey(): Buffer {
  const raw =
    process.env.CALENDAR_TOKEN_ENCRYPTION_KEY ??
    process.env.JWT_SECRET ??
    'menodao-calendar-encryption-dev';
  // Two rounds give a stable 32-byte key regardless of env value length.
  return createHash('sha256')
    .update(createHash('sha256').update(raw).digest())
    .digest();
}

function encrypt(plainText: string, key: Buffer): string {
  // GCM nonces must never be reused with the same key.
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(CIPHER_ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH_BYTES,
  });
  const body = Buffer.concat([
    cipher.update(plainText, 'utf8'),
    cipher.final(),
  ]);
  return Buffer.from(
    [
      iv.toString('hex'),
      cipher.getAuthTag().toString('hex'),
      body.toString('hex'),
    ].join(':'),
  ).toString('base64');
}

function decrypt(payload: string, key: Buffer): string {
  const [ivHex, tagHex, bodyHex] = payload.split(':');
  if (!ivHex || !tagHex || !bodyHex) {
    throw new Error('Malformed encrypted calendar payload');
  }
  const decipher = createDecipheriv(
    CIPHER_ALGORITHM,
    key,
    Buffer.from(ivHex, 'hex'),
    { authTagLength: AUTH_TAG_LENGTH_BYTES },
  );
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([
    decipher.update(Buffer.from(bodyHex, 'hex')),
    decipher.final(),
  ]).toString('utf8');
}

/** AES-256-GCM token cipher used by the calendar OAuth layer. */
@Injectable()
export class CalendarTokenCipherService {
  encrypt(plainText: string): string {
    return encrypt(plainText, deriveKey());
  }

  decrypt(payload: string): string {
    return decrypt(payload, deriveKey());
  }

  hash(plainText: string): string {
    return hashOtpCode(plainText);
  }

  verifyOtpCode(input: string, stored: string): boolean {
    return verifyOtpCodeHash(input, stored);
  }
}
