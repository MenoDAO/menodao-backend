/**
 * First-turn copy for new WhatsApp contacts.
 *
 * Kept separate from the gateway so it can be tested without constructing the
 * whole bot dependency graph. Kept deliberately conversational: no numbered
 * menus and no Swahili typos ("Karibu", never "Kariba").
 */

export const ONBOARDING_WELCOME = {
  en: 'Hi 👋 I’m MenoAI, the dental assistant at Dr. Papi Foundation. What’s going on with your teeth or gums today, or how can I help?',
  sw: 'Karibu 👋 Mimi ni MenoAI, msaidizi wa meno wa Dr. Papi Foundation. Kuna shida gani na meno au ufizi wako leo, au unahitaji msaada gani?',
} as const;

export const ONBOARDING_REPROMPT = {
  en: 'Sorry, could you say that again in your own words?',
  sw: 'Samahani, unaweza kurudia kwa maneno yako mwenyewe?',
} as const;

export function onboardingWelcome(language?: string | null): string {
  return (language ?? '').trim().toLowerCase().startsWith('sw')
    ? ONBOARDING_WELCOME.sw
    : ONBOARDING_WELCOME.en;
}

export function onboardingReprompt(language?: string | null): string {
  return (language ?? '').trim().toLowerCase().startsWith('sw')
    ? ONBOARDING_REPROMPT.sw
    : ONBOARDING_REPROMPT.en;
}
