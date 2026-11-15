import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';

export const BOT_ONBOARDING_STEPS = [
  'WELCOME',
  'INTEREST',
  'INTAKE',
  'MENU',
  'COMPLETE',
] as const;

export type BotOnboardingStep = (typeof BOT_ONBOARDING_STEPS)[number];

export interface BotOnboardingSessionRecord {
  id: string;
  memberId: string;
  step: string;
  language: string;
  payload: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class BotOnboardingService {
  private readonly logger = new Logger(BotOnboardingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async getSession(
    memberId: string,
  ): Promise<BotOnboardingSessionRecord | null> {
    return this.prisma.botOnboardingSession.findUnique({
      where: { memberId },
    });
  }

  async start(memberId: string, language = 'en') {
    const existing = await this.getSession(memberId);
    if (existing) {
      return existing;
    }
    const created = await this.prisma.botOnboardingSession.create({
      data: {
        memberId,
        step: 'WELCOME',
        language,
        payload: '{}',
        status: 'IN_PROGRESS',
      },
    });
    this.logger.log(
      `Bot onboarding started for member ${memberId} (step=WELCOME)`,
    );
    return created;
  }

  async setStep(
    memberId: string,
    step: string,
    payload: Record<string, unknown> = {},
  ) {
    const session = await this.getSession(memberId);
    if (!session) {
      return null;
    }
    return this.prisma.botOnboardingSession.update({
      where: { memberId },
      data: {
        step,
        payload: JSON.stringify(payload ?? {}),
        status: 'IN_PROGRESS',
        updatedAt: new Date(),
      },
    });
  }

  async complete(memberId: string) {
    const session = await this.getSession(memberId);
    if (!session) {
      return null;
    }
    return this.prisma.botOnboardingSession.update({
      where: { memberId },
      data: { step: 'MENU', status: 'COMPLETED', updatedAt: new Date() },
    });
  }
}
