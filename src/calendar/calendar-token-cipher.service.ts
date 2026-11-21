import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, createHmac } from 'crypto';
import { hashOtpCode, verifyOtpCode as verifyOtpCodeHash } from '../auth/otp-hash.util';

/**
 * AES-256-GCM encryption for calendar OAuth tokens stored at rest, plus
 * HMAC helpers for OTP code hashing.
 *
 * - The cipher key comes from `CALENDAR_TOKEN_ENCRYPTION_KEY` (preferred) or
 *   falls back to the existing `JWT_SECRET` key material.
 * - Tokens must never sit in plain text in the database; API keys themselves
 *   stay in env only and are never persisted.
 * - OTP verification accepts legacy plaintext 6-digit codes once (rows written
 *   before hashing) and compares new codes via HMAC-SHA256.
 */

export const CIPHER_ALGORITHM: 'aes-256-gcm' = 'aes-256-gcm';
const IV_LENGTH_BYTES: number = 12;

function deriveKey(): Buffer {
  const raw =
    process.env.CALENDAR_TOKEN_ENCRYPTION_KEY ??
    process.env.JWT_SECRET ??
    'menodao-calendar-encryption-dev';
  const digest = createHash('sha256').update(raw).digest();
  // 32 bytes for aes-256-gcm.
  return createHash('sha256').update(digest).digest();
}

function hmacKey(): Buffer {
  return createHash('sha256').update(deriveKey()).digest();
}

export function encryptSecret(plainText: string): string {
  const key = deriveKey();
  const iv = Buffer.alloc(12);
  const cipher = createCipheriv(CIPHER_ALGORITHM, key, iv, { authTagLength: 16 });
  const encrypted = Buffer.concat([
    cipher.update(plainText, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  const ivHex = Buffer.from(iv).toString('hex');
  const tagHex = Buffer.from(authTag).toString('hex');
  const bodyHex = Buffer.from(encrypted).toString('hex');
  return Buffer.from(`${ivHex}:${tagHex}:${bodyHex}`).toString('base64');
}

export function decryptSecret(payload: string): string {
  const [ivHex, tagHex, bodyHex] = payload.split(':');
  if (!ivHex || !tagHex || !bodyHex) {
    throw new Error('Malformed encrypted calendar payload');
  }
  const key = deriveKey();
  const cipher = createDecipheriv(CIPHER_ALGORITHM, key, Buffer.from(ivHex, 'hex'), { authTagLength: 16 });
  cipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  const body = Buffer.from(bodyHex, 'hex');
  const decrypted = Buffer.concat([cipher.update(body), cipher.final()]);
  return decrypted.toString('utf8');
}

export function hashSecret(plainText: string): string {
  const key = hmacKey();
  return createHmac('sha256', key).update(plainText).digest('hex');
}

export function verifyOtpCode(input: string, stored: string): boolean {
  const normalized = input.trim();
  // Legacy rows stored the plaintext code (6 digits) before hashing was added.
  if (/^\d{6}$/.test(stored)) {
    const a = Buffer.from(stored);
    const b = Buffer.from(normalized);
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
    return diff === 0;
  }
  const actual = hashSecret(normalized);
  const expected = Buffer.from(stored);
  const given = Buffer.from(actual);
  if (expected.length !== given.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected[i] ^ given[i];
  return diff === 0;
}

/**
 * AES-256-GCM token cipher used by the calendar OAuth layer.
 */
@Injectable()
export class CalendarTokenCipherService {
  encrypt(plainText: string): string {
    const key = deriveKey();
    const iv = Buffer.alloc(12);
    const cipher = createCipheriv(CIPHER_ALGORITHM, key, iv, { authTagLength: 16 });
    const encrypted = Buffer.concat([
      cipher.update(plainText, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    const ivHex = Buffer.from(iv).toString('hex');
    const tagHex = Buffer.from(authTag).toString('hex');
    const bodyHex = Buffer.from(encrypted).toString('hex');
    return Buffer.from(`${ivHex}:${tagHex}:${bodyHex}`).toString('base64');
  }

  decrypt(payload: string): string {
    const [ivHex, tagHex, bodyHex] = payload.split(':');
    if (!ivHex || !tagHex || !bodyHex) {
      throw new Error('Malformed encrypted calendar payload');
    }
    const key = deriveKey();
    const cipher = createDecipheriv(CIPHER_ALGORITHM, key, Buffer.from(ivHex, 'hex'), { authTagLength: 16 });
    cipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    const body = Buffer.from(bodyHex, 'hex');
    const decrypted = Buffer.concat([cipher.update(body), cipher.final()]);
    return decrypted.toString('utf8');
  }

  hash(plainText: string): string {
    return hashOtpCode(plainText);
  }

  verifyOtpCode(input: string, stored: string): boolean {
    return verifyOtpCodeHash(input, stored);
  }
}
