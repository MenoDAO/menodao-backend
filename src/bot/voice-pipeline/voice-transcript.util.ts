/**
 * Lightweight cleanup for speech-to-text transcripts.
 *
 * The goal is not to rewrite what the member said, but to remove obvious
 * filler and normalize common Swahili/English variants so downstream intent
 * classification and booking extraction are more stable.
 */
const FILLER_WORDS = [
  'um',
  'uh',
  'erm',
  'er',
  'ah',
  'eh',
  'aaah',
  'aaa',
  'mmm',
  'hmm',
  'like',
  'you know',
  'basically',
  'actually',
  'so',
  'well',
  'eeh',
  'aisee',
];

const SWAHILI_VARIANTS: Array<[RegExp, string]> = [
  [/\bkeshoo+\b/gi, 'kesho'],
  [/\bsaa\s+(\d+)\s+asubuhi\b/gi, 'saa $1 asubuhi'],
  [/\bsaa\s+(\d+)\s+mchana\b/gi, 'saa $1 mchana'],
  [/\bsaa\s+(\d+)\s+jioni\b/gi, 'saa $1 jioni'],
  [/\bsaa\s+(\d+)\s+usiku\b/gi, 'saa $1 usiku'],
];

export function normalizeVoiceTranscript(input: string): string {
  if (!input) return '';

  let text = input.replace(/\s+/g, ' ').trim();

  for (const [pattern, replacement] of SWAHILI_VARIANTS) {
    text = text.replace(pattern, replacement);
  }

  // Remove filler words while preserving the rest of the sentence.
  const fillerPattern = new RegExp(
    `\\b(${FILLER_WORDS.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`,
    'gi',
  );
  text = text.replace(fillerPattern, ' ');
  text = text.replace(/\s+/g, ' ').trim();

  // Collapse accidental repeated words ("I I want" -> "I want").
  text = text.replace(/\b(\w+)(\s+\1\b)+/gi, '$1');

  return text;
}
