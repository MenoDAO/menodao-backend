import { createHmac } from 'crypto';

/**
 * OTP code hashing helpers (HMAC-SHA256).
 *
 * OTP codes are sent by SMS and must never be stored in plain text. New writes
 * always persist the HMAC hash; verification still accepts legacy plaintext
 * codes (6 digits) so existing in-flight sessions/rows keep working.
 */

function otpHashKey(): Buffer {
  const raw = process.env.OTP_HASH_SECRET ?? process.env.JWT_SECRET ?? 'menodao-otp-hash-secret';
  return createHmac('sha256', raw).digest();
}

export function hashOtpCode(plainText: string): string {
  const key = otpHashKey();
  return createHmac('sha256', key).update(plainText).digest('hex');
}

export function verifyOtpCode(input: string, stored: string): boolean {
  const normalized = (input ?? '').trim();
  const candidate = (stored ?? '').trim();
  // Legacy rows stored the plaintext code (6 digits) before hashing was added.
  if (/^\d{6}$/.test(candidate)) {
    const a = Buffer.from(candidate);
    const b = Buffer.from(normalized);
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
    return diff === 0;
  }
  const key = otpHashKey();
  const actual = createHmac('sha256', key).update(normalized).digest('hex');
  const expected = Buffer.from(candidate);
  const given = Buffer.from(actual);
  if (expected.length !== given.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected[i] ^ given[i];
  return diff === 0;
}
