import {
  buildDrPapiSystemPrompt,
  buildIntentClassificationPrompt,
  polishMemberReply,
} from './system-prompts';
import { intentGuidance } from '../intents/intent.types';

describe('Dr. Papi system prompt', () => {
  it('writes Swahili naturally and bans the known "kariba" typo', () => {
    const prompt = buildDrPapiSystemPrompt({
      clinicContext: '',
      insuranceContext: '',
      language: 'sw',
    });

    expect(prompt).toContain('natural, warm, everyday Swahili');
    expect(prompt).toContain('never "kariba"');
    expect(prompt).not.toContain('Kariba');
    expect(prompt).not.toContain('ALWAYS list the options');
    expect(prompt).toContain('Do not send numbered option menus');
    expect(prompt).toContain('For symptoms, be a caring person first');
  });

  it('keeps symptom-only messages out of booking in the classifier', () => {
    const prompt = buildIntentClassificationPrompt('my tooth is sore');

    expect(prompt).toContain('sore');
    expect(prompt).toContain(
      'Never choose BOOKING_SESSION for a symptom-only message.',
    );
    expect(prompt).toContain('Never choose this for a symptom-only message');
  });

  it('guides clinical replies toward one empathetic triage question', () => {
    const guidance = intentGuidance('CLINICAL_INTAKE');

    expect(guidance).toContain('genuine empathy');
    expect(guidance).toContain('one short triage question');
    expect(guidance).toContain('Do not mention booking');
  });
});

describe('polishMemberReply', () => {
  it('corrects "kariba" wherever it appears', () => {
    expect(polishMemberReply('Kariba! Habari')).toBe('Karibu! Habari');
    expect(polishMemberReply('Asante, kariba sana')).toBe(
      'Asante, karibu sana',
    );
  });

  it('normalises line endings without changing the message', () => {
    expect(polishMemberReply('  Habari\r\nKaribu  ')).toBe('Habari\nKaribu');
  });
});
