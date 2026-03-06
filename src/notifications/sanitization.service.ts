import { Injectable } from '@nestjs/common';

/**
 * Service responsible for detecting and sanitizing sensitive content in notification messages.
 * Protects sensitive information like passwords, OTPs, PINs, and verification codes
 * before storing messages in the database.
 */
@Injectable()
export class SanitizationService {
  private readonly sensitivePatterns: RegExp[];

  constructor() {
    // Define regex patterns for sensitive content (case-insensitive)
    this.sensitivePatterns = [
      /password/i,
      /otp|one-time password/i,
      /\bpin\b|pin code/i,
      /verification code|code.*\d{4,}/i,
    ];
  }

  /**
   * Check if a message contains sensitive content patterns.
   * @param message - The message to check
   * @returns true if sensitive content is detected, false otherwise
   */
  containsSensitiveContent(message: string): boolean {
    return this.sensitivePatterns.some((pattern) => pattern.test(message));
  }

  /**
   * Sanitize a message by replacing it with "[PROTECTED]" if it contains sensitive content.
   * @param message - The message to sanitize
   * @returns "[PROTECTED]" if sensitive content is detected, otherwise the original message
   */
  sanitizeMessage(message: string): string {
    if (this.containsSensitiveContent(message)) {
      return '[PROTECTED]';
    }
    return message;
  }
}
