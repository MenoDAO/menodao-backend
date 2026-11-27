import { WhatsappMonthlyRenewalJob } from './whatsapp-monthly-renewal.job';

it('claims a reminder once across overlapping runners before sending it', async () => {
  const member = {
    id: 'member',
    phoneNumber: '254712345678',
    preferredLanguage: 'en',
  };
  const prisma = {
    member: {
      findMany: jest.fn().mockResolvedValue([member]),
      updateMany: jest
        .fn()
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 0 }),
    },
  };
  const whatsapp = { sendTextMessage: jest.fn().mockResolvedValue(undefined) };
  const config = { get: jest.fn().mockReturnValue('production') };
  const job = new WhatsappMonthlyRenewalJob(
    prisma as never,
    whatsapp as never,
    config as never,
  );
  await Promise.all([
    job.sendDueReminders(new Date('2026-12-02T06:30:00Z')),
    job.sendDueReminders(new Date('2026-12-03T06:30:00Z')),
  ]);
  expect(whatsapp.sendTextMessage).toHaveBeenCalledTimes(1);
  expect(whatsapp.sendTextMessage).toHaveBeenCalledWith(
    member.phoneNumber,
    expect.stringContaining('Pay Bronze monthly'),
  );
  expect(prisma.member.updateMany).toHaveBeenCalledWith(
    expect.objectContaining({
      data: { whatsappRenewalPeriod: '2026-12' },
    }),
  );
});
