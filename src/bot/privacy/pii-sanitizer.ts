/**
 * PII Sanitizer & Name Privacy Service
 *
 * Implements Workstream 2:
 * 1. Sanitizes user input, transcripts, and conversation history before any LLM call.
 * 2. Replaces known member names with [NAME].
 * 3. Strips phone numbers, email addresses, and self-introduction phrases.
 * 4. Post-processes LLM output to resolve `{{first_name}}` with the member's first name from the DB.
 */

export interface MemberNameDetails {
  fullName?: string | null;
  firstName?: string | null;
}

export class PiiSanitizer {
  // Regex for phone numbers: +254..., 07..., 254..., etc.
  private static readonly PHONE_REGEX =
    /(?:\+?254|0)[17]\d{8}|\b\d{10,12}\b|(?:\+?254|0)?7\d{2}[\s-]?\d{3}[\s-]?\d{3}/g;

  // Regex for email addresses
  private static readonly EMAIL_REGEX =
    /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

  // Self-introduction patterns in English & Swahili
  private static readonly SELF_INTRO_REGEX =
    /\b(?:my name is|i am called|call me|i'm|im|naitwa|jina langu ni|ninaitwa)\s+([A-Za-z]+(?:\s+[A-Za-z]+)?)\b/gi;

  /**
   * Sanitize text bound for the LLM.
   * Strips known member names, self-introductions, phones, and emails.
   */
  public static sanitizeForLlm(
    text: string,
    member?: MemberNameDetails | null,
  ): string {
    if (!text) return '';
    let sanitized = text;

    // 1. Redact known member names
    if (member) {
      const namesToRedact = new Set<string>();
      if (member.fullName?.trim()) {
        namesToRedact.add(member.fullName.trim());
        // Add individual name tokens (if length > 2)
        for (const token of member.fullName.trim().split(/\s+/)) {
          if (token.length > 2) namesToRedact.add(token);
        }
      }
      if (member.firstName?.trim() && member.firstName.trim().length > 2) {
        namesToRedact.add(member.firstName.trim());
      }

      for (const name of namesToRedact) {
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`\\b${escaped}\\b`, 'gi');
        sanitized = sanitized.replace(regex, '[NAME]');
      }
    }

    // 2. Redact self-introductions ("my name is Jane", "naitwa Juma")
    sanitized = sanitized.replace(this.SELF_INTRO_REGEX, (match, capturedName) => {
      return match.replace(capturedName, '[NAME]');
    });

    // 3. Redact phone numbers
    sanitized = sanitized.replace(this.PHONE_REGEX, '[PHONE]');

    // 4. Redact emails
    sanitized = sanitized.replace(this.EMAIL_REGEX, '[EMAIL]');

    return sanitized;
  }

  /**
   * Post-process the LLM reply to inject the member's first name from the DB
   * into the {{first_name}} placeholder.
   */
  public static resolvePlaceholders(
    reply: string,
    firstName?: string | null,
  ): string {
    if (!reply) return '';
    const name = firstName?.trim();

    if (name) {
      // Replace {{first_name}}
      return reply.replace(/\{\{first_name\}\}/gi, name);
    }

    // If no first name is available, clean up placeholder smoothly
    return reply
      .replace(/\{\{first_name\}\},?\s*/gi, '')
      .replace(/\{\{[^}]+\}\}/g, '');
  }
}
