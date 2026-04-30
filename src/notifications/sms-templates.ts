export type SmsTemplateKey =
  | 'otp_verification'
  | 'payment_confirmation'
  | 'subscription_renewal_reminder'
  | 'claim_status_update'
  | 'welcome';

export interface SmsTemplateVars {
  [key: string]: string | number;
}

export interface BilingualTemplate {
  en: string;
  sw: string;
}

export type SmsTemplateCatalogue = Record<SmsTemplateKey, BilingualTemplate>;

export const SMS_TEMPLATES: SmsTemplateCatalogue = {
  otp_verification: {
    en: 'Your MenoDAO verification code is {{code}}. Valid for 10 minutes.',
    sw: 'Nambari yako ya uthibitisho wa MenoDAO ni {{code}}. Inatumika kwa dakika 10.',
  },
  payment_confirmation: {
    en: 'Payment of KES {{amount}} received. Your MenoDAO {{tier}} membership is active.',
    sw: 'Malipo ya KES {{amount}} yamepokelewa. Uanachama wako wa MenoDAO {{tier}} umewashwa.',
  },
  subscription_renewal_reminder: {
    en: 'Your MenoDAO subscription renews on {{date}}. Ensure your M-Pesa is ready.',
    sw: 'Usajili wako wa MenoDAO unafanywa upya tarehe {{date}}. Hakikisha M-Pesa yako iko tayari.',
  },
  claim_status_update: {
    en: 'Your MenoDAO claim #{{claimId}} status: {{status}}.',
    sw: 'Hali ya dai lako la MenoDAO #{{claimId}}: {{status}}.',
  },
  welcome: {
    en: 'Welcome to MenoDAO, {{name}}! Your community dental cover is now active.',
    sw: 'Karibu MenoDAO, {{name}}! Bima yako ya meno ya jamii imewashwa.',
  },
};

export class SmsTemplateService {
  render(
    key: SmsTemplateKey,
    preferredLanguage: string | null | undefined,
    vars: SmsTemplateVars,
  ): string {
    const template = SMS_TEMPLATES[key];
    const lang = preferredLanguage === 'sw' ? 'sw' : 'en';

    let text = template[lang];
    if (!text) {
      console.warn(
        `[SMS] Missing Swahili template for key: ${key}, falling back to English`,
      );
      text = template.en;
    }

    // Interpolate variables: replace {{varName}} with values
    return Object.entries(vars).reduce(
      (result, [varKey, value]) =>
        result.replace(new RegExp(`\\{\\{${varKey}\\}\\}`, 'g'), String(value)),
      text,
    );
  }
}
