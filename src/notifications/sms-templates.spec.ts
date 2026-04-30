import * as fc from 'fast-check';
import {
  SmsTemplateService,
  SMS_TEMPLATES,
  SmsTemplateKey,
} from './sms-templates';

describe('SmsTemplateService', () => {
  const service = new SmsTemplateService();
  const templateKeys = Object.keys(SMS_TEMPLATES) as SmsTemplateKey[];

  // Feature: performance-and-i18n-improvements, Property 3: SMS template language selection
  it('Property 3: renders sw template when preferredLanguage is sw, en otherwise', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...templateKeys),
        fc.oneof(
          fc.constant('sw'),
          fc.constant('en'),
          fc.constant(null),
          fc.constant(undefined),
          fc.string(),
        ),
        (key, lang) => {
          const result = service.render(key, lang, {});
          // With empty vars, render returns the raw template string unchanged
          const expected =
            lang === 'sw' ? SMS_TEMPLATES[key].sw : SMS_TEMPLATES[key].en;
          return result === expected;
        },
      ),
    );
  });

  // Feature: performance-and-i18n-improvements, Property 4: SMS template catalogue completeness
  it('Property 4: all template keys have non-empty en and sw variants', () => {
    fc.assert(
      fc.property(fc.constantFrom(...templateKeys), (key) => {
        const template = SMS_TEMPLATES[key];
        return (
          typeof template.en === 'string' &&
          template.en.length > 0 &&
          typeof template.sw === 'string' &&
          template.sw.length > 0
        );
      }),
    );
  });
});
