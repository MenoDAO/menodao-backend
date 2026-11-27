import { WhatsappPaymentNoticeService } from './whatsapp-payment-notice.service';

function setup() {
  const prisma = {
    whatsappPaymentNotice: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'failed',
          memberId: 'member',
          kind: 'MEMBERSHIP_FAILED',
          sourceId: 'payment',
          attempts: 0,
        },
        {
          id: 'paid',
          memberId: 'member',
          kind: 'MEMBERSHIP_PAID',
          sourceId: 'another',
          attempts: 0,
        },
      ]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn().mockResolvedValue(undefined),
    },
    member: {
      findUnique: jest
        .fn()
        .mockResolvedValue({
          phoneNumber: '+254700000001',
          whatsappUnsubscribedAt: null,
        }),
    },
    contribution: {
      findUnique: jest.fn().mockResolvedValue({ status: 'FAILED' }),
    },
  };
  const whatsapp = { sendTextMessage: jest.fn().mockResolvedValue(undefined) };
  return {
    prisma,
    whatsapp,
    service: new WhatsappPaymentNoticeService(
      prisma as never,
      whatsapp as never,
    ),
  };
}

it('delivers both verified payment outcomes', async () => {
  const { prisma, whatsapp, service } = setup();
  await service.sendPending();
  expect(whatsapp.sendTextMessage).toHaveBeenNthCalledWith(
    1,
    '+254700000001',
    expect.stringContaining('did not go through'),
  );
  expect(whatsapp.sendTextMessage).toHaveBeenNthCalledWith(
    2,
    '+254700000001',
    expect.stringContaining('was received'),
  );
  expect(prisma.whatsappPaymentNotice.update).toHaveBeenCalledTimes(2);
});

it('does not send after a member opts out', async () => {
  const { prisma, whatsapp, service } = setup();
  prisma.member.findUnique.mockResolvedValue({
    whatsappUnsubscribedAt: new Date(),
  });
  await service.sendPending();
  expect(whatsapp.sendTextMessage).not.toHaveBeenCalled();
  expect(prisma.whatsappPaymentNotice.update).toHaveBeenCalledTimes(2);
});

it('leaves a failed WhatsApp send available for retry', async () => {
  const { prisma, whatsapp, service } = setup();
  whatsapp.sendTextMessage.mockRejectedValueOnce(
    new Error('delivery unavailable'),
  );
  await service.sendPending();
  expect(prisma.whatsappPaymentNotice.update).toHaveBeenCalledTimes(1);
  expect(prisma.whatsappPaymentNotice.update).toHaveBeenCalledWith(
    expect.objectContaining({ where: { id: 'paid' } }),
  );
});
