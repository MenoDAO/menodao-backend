import * as bookingMessages from './booking.messages';
import {
  ASK_CLINIC,
  ASK_DOCTOR,
  ASK_SERVICE,
  ASK_SERVICE_CHOICE,
} from './booking.messages';

describe('booking messages', () => {
  it('asks for details conversationally instead of showing numbered menus', () => {
    const copy = [ASK_SERVICE, ASK_SERVICE_CHOICE, ASK_CLINIC, ASK_DOCTOR]
      .flatMap((message) => [message.en, message.sw])
      .join('\n');

    expect(copy).not.toMatch(/choose one/i);
    expect(copy).not.toMatch(/reply with the number/i);
    expect(copy).not.toMatch(/\bnamba\b/i);
    expect(copy).not.toMatch(/^\s*\d+\./m);
  });

  it('uses natural Swahili phrasing', () => {
    expect(ASK_SERVICE_CHOICE.sw).toContain('Huduma zilizopo ni');
    expect(ASK_DOCTOR.sw).toContain('Unaweza pia kunitajia jina lake tu.');
  });

  it('uses ordinary punctuation instead of dashes', () => {
    const copy = Object.values(bookingMessages)
      .flatMap((value) =>
        value && typeof value === 'object' && 'en' in value && 'sw' in value
          ? [String(value.en), String(value.sw)]
          : [],
      )
      .join('\n');

    expect(copy).not.toContain('—');
    expect(copy).not.toContain('–');
  });
});
