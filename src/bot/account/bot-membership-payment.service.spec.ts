import { BotMembershipPaymentService } from './bot-membership-payment.service';

function build() {
  const quote = {
    id: 'membership-quote:verified',
    memberId: 'member',
    scope: 'MEMBERSHIP_PAY|SILVER|ANNUAL|8000|subscription|254712345678',
    status: 'PAYMENT_QUOTED',
    expiresAt: new Date(Date.now() + 60_000),
  };
  const prisma = {
    subscription: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'subscription',
        tier: 'SILVER',
        paymentFrequency: 'ANNUAL',
        isActive: true,
      }),
    },
    botDataAccessSession: {
      upsert: jest.fn().mockResolvedValue(quote),
      findFirst: jest.fn().mockResolvedValue(quote),
      updateMany: jest
        .fn()
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValue({ count: 0 }),
    },
    contribution: { findFirst: jest.fn().mockResolvedValue(null) },
  };
  const subscriptions = {
    getPackages: jest
      .fn()
      .mockReturnValue([{ tier: 'SILVER', actualAnnualCharge: 8000 }]),
    checkPaymentFrequencyRestriction: jest.fn().mockResolvedValue(undefined),
  };
  const contributions = {
    initiatePayment: jest.fn().mockResolvedValue({ status: 'PENDING' }),
  };
  const service = new BotMembershipPaymentService(
    prisma as never,
    subscriptions as never,
    contributions as never,
  );
  return { service, prisma, subscriptions, contributions, quote };
}

describe('BotMembershipPaymentService', () => {
  it('quotes the configured billing period and submits a quote only once', async () => {
    const { service, contributions } = build();
    await expect(
      service.offer('member', 'MEMBERSHIP_PAY', 'verified', '+254712345678'),
    ).resolves.toContain('KES 8,000');
    expect(contributions.initiatePayment).not.toHaveBeenCalled();

    await Promise.all([service.confirm('member'), service.confirm('member')]);

    expect(contributions.initiatePayment).toHaveBeenCalledTimes(1);
    expect(contributions.initiatePayment).toHaveBeenCalledWith(
      'member',
      8000,
      'MPESA',
      '254712345678',
      false,
      undefined,
      'ANNUAL',
      { tier: 'SILVER', amount: 8000 },
    );
  });

  it('requires fresh confirmation for another payer while crediting the same member', async () => {
    const { service, prisma, contributions, quote } = build();
    const update = prisma.botDataAccessSession.updateMany;
    update.mockReset();
    update.mockResolvedValue({ count: 1 });

    const reply = await service.changePayer('member', '01 2345 6789');
    expect(reply).toContain('KES 8,000');
    expect(reply).toContain('ending in 6789');
    expect(reply).not.toContain('0123456789');
    const code = /confirm M-Pesa ([A-F0-9]{6})/.exec(reply)?.[1];
    expect(code).toBeDefined();
    const updateData = update.mock.calls[0][0] as { data: { scope: string } };
    prisma.botDataAccessSession.findFirst.mockResolvedValue({
      ...quote,
      ...updateData.data,
    });
    await expect(service.confirm('member')).resolves.toContain(
      'exact confirmation phrase',
    );
    expect(contributions.initiatePayment).not.toHaveBeenCalled();

    await expect(service.confirm('member', code)).resolves.toContain(
      'ending in 6789',
    );
    expect(contributions.initiatePayment).toHaveBeenCalledWith(
      'member',
      8000,
      'MPESA',
      '254123456789',
      false,
      undefined,
      'ANNUAL',
      { tier: 'SILVER', amount: 8000 },
    );
  });

  it('rejects non-Kenyan and fixed-line payer numbers', async () => {
    const { service, prisma } = build();
    for (const phone of ['+14155550123', '0201234567', '123456']) {
      await expect(service.changePayer('member', phone)).resolves.toContain(
        'valid Kenyan mobile number',
      );
    }
    expect(prisma.botDataAccessSession.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a changed price before initiating payment', async () => {
    const { service, subscriptions, contributions } = build();
    subscriptions.getPackages.mockReturnValue([
      { tier: 'SILVER', actualAnnualCharge: 9000 },
    ]);

    await expect(service.confirm('member')).resolves.toContain('price changed');
    expect(contributions.initiatePayment).not.toHaveBeenCalled();
  });
});
