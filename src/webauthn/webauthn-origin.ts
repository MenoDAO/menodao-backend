export type WebAuthnKind = 'staff' | 'admin' | 'member';

const DEFAULT_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:3001',
  'https://menodao.org',
  'https://www.menodao.org',
  'https://app.menodao.org',
  'https://dev.menodao.org',
  'https://menodao.co.ke',
  'https://www.menodao.co.ke',
];

export function allowedWebAuthnOrigins(
  corsOrigins?: string,
  extraOrigins?: string,
): string[] {
  const fromCors = corsOrigins
    ? corsOrigins.split(',').map((o) => o.trim()).filter(Boolean)
    : DEFAULT_ORIGINS;
  const extra = extraOrigins
    ? extraOrigins.split(',').map((o) => o.trim()).filter(Boolean)
    : [];
  return [...new Set([...fromCors, ...extra])];
}

export function resolveWebAuthnRp(
  originHeader: string | undefined,
  allowed: string[],
): { origin: string; rpID: string } {
  if (!originHeader) {
    throw new Error('Missing Origin header');
  }
  let origin: string;
  try {
    origin = new URL(originHeader).origin;
  } catch {
    throw new Error('Invalid Origin header');
  }
  if (!allowed.includes(origin)) {
    throw new Error(`Origin ${origin} is not allowed for device login`);
  }
  return { origin, rpID: new URL(origin).hostname };
}
