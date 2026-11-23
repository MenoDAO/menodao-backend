import { PiiSanitizer } from './pii-sanitizer';

describe('PiiSanitizer (Workstream 2: Name Privacy)', () => {
  it('redacts known member full name and first name tokens', () => {
    const input = 'Hello, this is Jane Wanjiku asking about my appointment.';
    const result = PiiSanitizer.sanitizeForLlm(input, {
      fullName: 'Jane Wanjiku',
      firstName: 'Jane',
    });
    expect(result).not.toContain('Jane');
    expect(result).not.toContain('Wanjiku');
    expect(result).toContain('[NAME]');
  });

  it('redacts canary names completely (Canary Test)', () => {
    const canary = 'Zxqvelo Mbugua';
    const input = `My name is ${canary} and I want a cleaning.`;
    const result = PiiSanitizer.sanitizeForLlm(input, {
      fullName: canary,
      firstName: 'Zxqvelo',
    });
    expect(result).not.toContain('Zxqvelo');
    expect(result).not.toContain('Mbugua');
    expect(result).toContain('[NAME]');
  });

  it('redacts self-introductions in English and Swahili', () => {
    const en = 'Hello doctor, my name is Peter and I have pain.';
    expect(PiiSanitizer.sanitizeForLlm(en)).toContain('my name is [NAME]');
    expect(PiiSanitizer.sanitizeForLlm(en)).not.toContain('Peter');

    const sw = 'Habari, naitwa Omari na jino linaniuma.';
    expect(PiiSanitizer.sanitizeForLlm(sw)).toContain('naitwa [NAME]');
    expect(PiiSanitizer.sanitizeForLlm(sw)).not.toContain('Omari');
  });

  it('redacts phone numbers and emails', () => {
    const input = 'Call me on 0712345678 or test@example.com';
    const result = PiiSanitizer.sanitizeForLlm(input);
    expect(result).toContain('[PHONE]');
    expect(result).toContain('[EMAIL]');
    expect(result).not.toContain('0712345678');
    expect(result).not.toContain('test@example.com');
  });

  it('resolves {{first_name}} placeholder smoothly', () => {
    const reply = 'Karibu {{first_name}}! How can I help you today?';
    const resolved = PiiSanitizer.resolvePlaceholders(reply, 'Halima');
    expect(resolved).toBe('Karibu Halima! How can I help you today?');
  });

  it('cleans up {{first_name}} gracefully if first name is missing', () => {
    const reply = 'Hello {{first_name}}! How can I help you today?';
    const resolved = PiiSanitizer.resolvePlaceholders(reply, null);
    expect(resolved).toBe('Hello How can I help you today?');
    expect(resolved).not.toContain('{{first_name}}');
  });
});
