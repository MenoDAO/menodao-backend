import { BotMembershipPaymentService } from '../account/bot-membership-payment.service';
import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../../prisma/prisma.service';
import type { VoicePipelineService } from '../voice-pipeline/voice-pipeline.service';
import type { BotIdentityService } from '../identity/bot-identity.service';
import type { BotChatService } from '../chat/bot-chat.service';
import type { BotMemberDataService } from '../account/bot-member-data.service';
import type { AdminWhatsappAccessService } from '../admin/admin-whatsapp-access.service';
import type { IWhatsappClient } from '../whatsapp-clients/whatsapp-provider.interface';
import type { WhatsappApiClient } from '../whatsapp-clients/whatsapp-api.client';
import type { FlaresendApiClient } from '../whatsapp-clients/flaresend-api.client';
import type { WaboxappApiClient } from '../whatsapp-clients/waboxapp-api.client';
import { BotGatewayService, isWhatsappStopRequest } from './bot-gateway.service';

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

  const member = {
    id: 'guest', phoneNumber: '+254712345678', isVerified: false, preferredLanguage: null,
  };
  const voucher = { verifyPublic: jest.fn().mockResolvedValue({ valid: true }), redeemByCode: jest.fn().mockResolvedValue({ status: 'REDEEMED' }) };
  const sendTextMessage = jest.fn().mockResolvedValue(undefined);
  const latestSentReply = jest.fn().mockResolvedValue(null);
  const handleRequest = jest.fn().mockResolvedValue('I sent a 6-digit verification code by SMS.');
  const membershipPayments = new BotMembershipPaymentService({} as never, {} as never, {} as never);
  jest.spyOn(membershipPayments, 'acceptPayerReply').mockResolvedValue(null);
  const pendingPaymentVerificationReply = jest.fn().mockResolvedValue(null);
  jest.spyOn(membershipPayments, 'paymentPromptReply').mockResolvedValue(null);
  const service = new BotGatewayService(
    {} as PrismaService,
    config,
    { processTextPipeline } as unknown as VoicePipelineService,
    { resolveMember: jest.fn().mockResolvedValue(member) } as unknown as BotIdentityService,
    {
      recordInbound: jest.fn().mockResolvedValue(undefined),
      recordOutbound: jest.fn().mockResolvedValue(undefined),
      latestSentReply,
    } as unknown as BotChatService,
    { detectScope: jest.fn().mockReturnValue(null), handleRequest, pendingPaymentVerificationReply } as unknown as BotMemberDataService,
    membershipPayments,
    { findAdminBySender: jest.fn().mockResolvedValue(null) } as unknown as AdminWhatsappAccessService,
    {} as never,
    voucher as never,
    { sendTextMessage, markMessageAsRead: jest.fn() } as unknown as IWhatsappClient,
    {} as WhatsappApiClient,
    {} as FlaresendApiClient,
    {} as WaboxappApiClient,
  );

  const generateReplyText = (
    service as unknown as {
      generateReplyText: (params: ReplyParams) => Promise<string>;
    }
  ).generateReplyText.bind(service) as (params: ReplyParams) => Promise<string>;

  return { membershipPayments, generateReplyText, processTextPipeline, service, sendTextMessage, voucher, latestSentReply, handleRequest, pendingPaymentVerificationReply };
}

const params: ReplyParams = {
  memberId: 'member-1',
  recipientPhone: '254765440035',
  messageText: 'hello',
  senderId: '254765440035',
};

describe('BotGatewayService fallback replies', () => {
  it.each(['stop', 'Stop sending me this.', 'please stop texting me', 'Don’t contact me again'])(
    'recognises %s as an unsubscribe request',
    (text) => expect(isWhatsappStopRequest(text)).toBe(true),
  );

  it.each(['Can I stop the pain?', 'stop my booking', 'how do I stop notifications?'])(
    'does not unsubscribe on an unrelated request: %s',
    (text) => expect(isWhatsappStopRequest(text)).toBe(false),
  );

  it.each(['pay', 'proceed', 'confirm'])('uses the current payment quote when the member replies %s', async (message) => {
    const { service, latestSentReply, membershipPayments } = build();
    latestSentReply.mockResolvedValue('Reply *pay*, *proceed*, or *confirm*.\n\nQuote reference: A1B2C3');
    const confirm = jest.spyOn(membershipPayments, 'confirm').mockResolvedValue('Prompt sent.');
    await (service as any).handleUserTextMessage({
      senderId: '254712345678', fallbackPhone: '254712345678', messageId: 'message', messageText: message,
    });
    expect(confirm).toHaveBeenCalledWith(expect.any(String), 'A1B2C3', expect.any(Function));
  });

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


describe('first message from a new WhatsApp number', () => {
  it('answers the patient’s first concern without a signup menu', async () => {
    const { service, processTextPipeline, sendTextMessage } = build();
    processTextPipeline.mockResolvedValue({ patientMessage: 'How long has it been sore?' });

    await service['handleUserTextMessage']({
      senderId: '254712345678',
      fallbackPhone: '254712345678',
      messageId: 'first-message',
      messageText: 'My tooth has been sore',
    });

    expect(processTextPipeline).toHaveBeenCalledWith(
      'My tooth has been sore', '+254712345678', undefined, undefined, '254712345678',
    );
    expect(sendTextMessage).toHaveBeenCalledWith('+254712345678', 'How long has it been sore?');
  });
});

describe('voucher intent', () => {
  it.each(['is this voucher valid? SMILE-F6S22', 'SMILE-F6S22', 'can I redeem SMILE-F6S22?'])(
    'checks without redeeming for %s', async (messageText) => {
      const { service, voucher, sendTextMessage } = build();
      await service['handleVoucherMessage']({
        member: { id: 'm', phoneNumber: '+254712345678' },
        recipientPhone: '+254712345678', messageText,
        chatContext: { memberId: 'm', contactId: 'm' },
      });
      expect(voucher.verifyPublic).toHaveBeenCalledWith('SMILE-F6S22');
      expect(voucher.redeemByCode).not.toHaveBeenCalled();
      expect(sendTextMessage).toHaveBeenCalledWith('+254712345678', expect.stringContaining('valid and unused'));
    },
  );
});

describe('membership acceptance', () => {
  it('routes yes after the delivered Bronze monthly offer directly to verification', async () => {
    const { service, latestSentReply, handleRequest, processTextPipeline, sendTextMessage } = build();
    latestSentReply.mockResolvedValue('Would you like to go ahead and start your Bronze monthly membership right here in our chat?');

    await service['handleUserTextMessage']({
      senderId: '254712345678', fallbackPhone: '254712345678',
      messageId: 'accept-plan', messageText: 'yes',
    });

    expect(handleRequest).toHaveBeenCalledWith(
      { id: 'guest', phoneNumber: '+254712345678' }, 'MEMBERSHIP_JOIN:BRONZE:MONTHLY',
    );
    expect(processTextPipeline).not.toHaveBeenCalled();
    expect(sendTextMessage).toHaveBeenCalledWith('+254712345678', expect.stringContaining('verification code'));
  });
});

describe('payment verification is handled before conversational replies', () => {
  it.each(['no code has arrived', 'yes'])('keeps %s in pending verification', async (messageText) => {
    const { service, pendingPaymentVerificationReply, processTextPipeline, sendTextMessage } = build();
    pendingPaymentVerificationReply.mockResolvedValue('I’m still waiting for the SMS code. No M-Pesa prompt has been sent.');
    await service['handleUserTextMessage']({
      senderId: '254712345678', fallbackPhone: '254712345678',
      messageId: 'pending-payment', messageText,
    });
    expect(processTextPipeline).not.toHaveBeenCalled();
    expect(sendTextMessage).toHaveBeenCalledWith('+254712345678', expect.stringContaining('No M-Pesa prompt has been sent'));
  });
});
