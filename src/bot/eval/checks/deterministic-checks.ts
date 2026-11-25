import { CheckFailure } from '../eval.types';

// ─── 1. Name-Leak Canary Check (Workstream 2) ──────────────────────────────
export function checkNameCanary(
  capturedLlmPayloads: string[],
  canaryName: string,
): CheckFailure[] {
  const failures: CheckFailure[] = [];
  if (!canaryName) return failures;

  const tokens = canaryName
    .split(/\s+/)
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 2);

  for (const payload of capturedLlmPayloads) {
    const lowerPayload = payload.toLowerCase();
    for (const token of tokens) {
      if (lowerPayload.includes(token)) {
        failures.push({
          checkName: 'Name-Leak Canary',
          message: `Canary token "${token}" leaked into LLM payload!`,
          details: { token, payloadSnippet: payload.slice(0, 200) },
        });
      }
    }
  }

  return failures;
}

// ─── 2. Menu-Pattern Detector (Workstream 1) ───────────────────────────────
// Detects unwanted menu patterns like "Reply with 1, 2 or 3", "Reply 1 for..."
const MENU_PATTERNS = [
  /reply\s+with\s+[123]/i,
  /please\s+reply\s+with\s+[123]/i,
  /reply\s+[123]\s+(to|for)/i,
  /jibu\s+(na\s+)?[123]/i,
  /chagua\s+[123]/i,
  /1\.\s+[A-Z].*\n2\.\s+[A-Z].*\n3\.\s+[A-Z]/,
];

export function checkMenuPattern(reply: string): CheckFailure[] {
  const failures: CheckFailure[] = [];
  for (const pattern of MENU_PATTERNS) {
    if (pattern.test(reply)) {
      failures.push({
        checkName: 'Menu-Pattern Detector',
        message: `Reply contains forbidden menu phrasing matching ${pattern}`,
        details: { replySnippet: reply.slice(0, 150) },
      });
      break;
    }
  }
  return failures;
}

// ─── 3. Swahili Lexicon Lint ("Kariba" -> "Karibu") (Workstream 3) ─────────
const BANNED_SWAHILI_TERMS = [/\bkariba\b/i];

export function checkSwahiliLexicon(reply: string): CheckFailure[] {
  const failures: CheckFailure[] = [];
  for (const pattern of BANNED_SWAHILI_TERMS) {
    if (pattern.test(reply)) {
      failures.push({
        checkName: 'Swahili Lexicon Lint',
        message: `Reply contains banned term matching ${pattern} (e.g. "Kariba" typo)`,
        details: { replySnippet: reply.slice(0, 150) },
      });
    }
  }
  return failures;
}

// ─── 4. Placeholder Check (Workstream 2) ───────────────────────────────────
const UNRESOLVED_PLACEHOLDER = /\{\{[^}]+\}\}/g;

export function checkPlaceholderResolution(reply: string): CheckFailure[] {
  const failures: CheckFailure[] = [];
  const matches = reply.match(UNRESOLVED_PLACEHOLDER);
  if (matches && matches.length > 0) {
    failures.push({
      checkName: 'Placeholder Check',
      message: `Reply contains unresolved placeholders: ${matches.join(', ')}`,
      details: { placeholders: matches, replySnippet: reply.slice(0, 150) },
    });
  }
  return failures;
}

// ─── 5. Must Include / Must Not Include Checks ─────────────────────────────
export function checkPhrasingRequirements(
  reply: string,
  mustInclude: string[] = [],
  mustNotInclude: string[] = [],
): CheckFailure[] {
  const failures: CheckFailure[] = [];
  const lowerReply = reply.toLowerCase();

  for (const phrase of mustInclude) {
    if (!lowerReply.includes(phrase.toLowerCase())) {
      failures.push({
        checkName: 'Content Verification (must_include)',
        message: `Reply is missing required phrase "${phrase}"`,
        details: { missing: phrase },
      });
    }
  }

  for (const phrase of mustNotInclude) {
    if (lowerReply.includes(phrase.toLowerCase())) {
      failures.push({
        checkName: 'Content Verification (must_not_include)',
        message: `Reply contains prohibited phrase "${phrase}"`,
        details: { prohibited: phrase },
      });
    }
  }

  return failures;
}
