import {
  ONBOARDING_REPROMPT,
  ONBOARDING_WELCOME,
  onboardingReprompt,
  onboardingWelcome,
} from './onboarding.messages';

describe('onboarding messages', () => {
  it('welcomes people without a numbered menu or a Swahili typo', () => {
    for (const message of Object.values(ONBOARDING_WELCOME)) {
      expect(message).not.toMatch(/Reply with a number|1️⃣|choose one/i);
      expect(message).not.toContain('Kariba');
      expect(message).toMatch(/\?$/);
    }
  });

  it('uses correct Swahili for Swahili-preferring members', () => {
    expect(onboardingWelcome('sw')).toBe(ONBOARDING_WELCOME.sw);
    expect(onboardingWelcome('en')).toBe(ONBOARDING_WELCOME.en);
    expect(ONBOARDING_WELCOME.sw).toContain('Karibu');
    expect(ONBOARDING_REPROMPT.sw).toContain('Samahani');
    expect(onboardingReprompt('sw')).toBe(ONBOARDING_REPROMPT.sw);
  });
});
