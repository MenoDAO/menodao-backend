import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../../prisma/prisma.service';
import type { VoicePipelineService } from '../voice-pipeline/voice-pipeline.service';
import type { BotIdentityService } from '../identity/bot-identity.service';
import type { BotOnboardingService } from '../onboarding/bot-onboarding.service';
import type { BotChatService } from '../chat/bot-chat.service';
import type { BotMemberDataService } from '../account/bot-member-data.service';
import type { AdminWhatsappAccessService } from '../admin/admin-whatsapp-access.service';
import type { IWhatsappClient } from '../whatsapp-clients/whatsapp-provider.interface';
import type { WhatsappApiClient } from '../whatsapp-clients/whatsapp-api.client';
import type { FlaresendApiClient } from '../whatsapp-clients/flaresend-api.client';
import type { WaboxappApiClient } from '../whatsapp-clients/waboxapp-api.client';
import { BotGatewayService } from './bot-gateway.service';

interface ReplyParams {
  memberId: string;
  recipientPhone: string;
  messageText: string;
  senderId: string;
}

interface PipelineResult {
  patientMessage: string;
}

function build(env: Record<string, string> = {}) {
  const processTextPipeline = jest.fn<
    Promise<PipelineResult>,
    [string, string, unknown, unknown, string]
  >();
  const config = {
    get: (name: string) => env[name],
  } as unknown as ConfigService;

  const service = new BotGatewayService(
    {} as PrismaService,
    config,
    { processTextPipeline } as unknown as VoicePipelineService,
    {} as BotIdentityService,
    {} as BotOnboardingService,
    {} as BotChatService,
    {} as BotMemberDataService,
    {} as AdminWhatsappAccessService,
    {} as IWhatsappClient,
    {} as WhatsappApiClient,
    {} as FlaresendApiClient,
    {} as WaboxappApiClient,
  );

  const generateReplyText = (
    service as unknown as {
      generateReplyText: (params: ReplyParams) => Promise<string>;
    }
  ).generateReplyText.bind(service) as (params: ReplyParams) => Promise<string>;

  return { generateReplyText, processTextPipeline };
}

const params: ReplyParams = {
  memberId: 'member-1',
  recipientPhone: '254765440035',
  messageText: 'hello',
  senderId: '254765440035',
};

describe('BotGatewayService fallback replies', () => {
  it('answers with a holding message when the AI pipeline fails', async () => {
    const { generateReplyText, processTextPipeline } = build();
    processTextPipeline.mockRejectedValue(
      new Error('got status: 503 Service Unavailable'),
    );

    const reply = await generateReplyText(params);

    expect(reply).toMatch(/temporary problem/i);
    expect(reply).not.toMatch(/503|gemini/i);
  });

  it('answers with a holding message when the pipeline returns nothing', async () => {
    const { generateReplyText, processTextPipeline } = build();
    processTextPipeline.mockResolvedValue({ patientMessage: '   ' });

    await expect(generateReplyText(params)).resolves.toMatch(
      /temporary problem/i,
    );
  });

  it('uses the operator override when one is configured', async () => {
    const { generateReplyText, processTextPipeline } = build({
      BOT_FALLBACK_REPLY: 'Please try again shortly.',
    });
    processTextPipeline.mockRejectedValue(new Error('boom'));

    await expect(generateReplyText(params)).resolves.toBe(
      'Please try again shortly.',
    );
  });

  it('returns the pipeline answer when it works', async () => {
    const { generateReplyText, processTextPipeline } = build();
    processTextPipeline.mockResolvedValue({
      patientMessage: 'Hello, how can I help?',
    });

    await expect(generateReplyText(params)).resolves.toBe(
      'Hello, how can I help?',
    );
  });
});
