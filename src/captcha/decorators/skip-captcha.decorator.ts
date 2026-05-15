import { SetMetadata } from '@nestjs/common';

export const SKIP_CAPTCHA_KEY = 'skipCaptcha';
export const SkipCaptcha = () => SetMetadata(SKIP_CAPTCHA_KEY, true);
