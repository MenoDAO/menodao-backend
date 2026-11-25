import { BadRequestException } from '@nestjs/common';
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
      findUnique: jest.fn().mockResolvedValue({ id: 'verified' }),
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
    getPackages: jest.fn().mockReturnValue([
      {
        tier: 'SILVER',
        displayName: 'MenoSilver',
        actualMonthlyCharge: 800,
        actualAnnualCharge: 8000,
      },
    ]),
    subscribe: jest.fn().mockResolvedValue(undefined),
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
      'WHATSAPP',
    );
  });

  it('quotes a new Bronze monthly membership and initiates STK only after confirmation', async () => {
    const { service, prisma, subscriptions, contributions, quote } = build();
    const storedQuote = {
      ...quote,
      scope:
        'MEMBERSHIP_JOIN:BRONZE:MONTHLY|BRONZE|MONTHLY|500|new|254712345678',
    };
    prisma.subscription.findUnique.mockResolvedValue(null);
    prisma.botDataAccessSession.upsert.mockResolvedValue(storedQuote);
    prisma.botDataAccessSession.findFirst.mockResolvedValue(storedQuote);
    subscriptions.getPackages.mockReturnValue([
      {
        tier: 'BRONZE',
        displayName: 'MenoBronze',
        actualMonthlyCharge: 500,
        actualAnnualCharge: 5000,
      },
    ]);

    const reply = await service.offer(
      'member',
      'MEMBERSHIP_JOIN:BRONZE:MONTHLY',
      'verified',
      '+254712345678',
    );
    expect(reply).toContain('KES 500');
    expect(reply).toContain('confirm M-Pesa');
    expect(subscriptions.subscribe).not.toHaveBeenCalled();
    expect(contributions.initiatePayment).not.toHaveBeenCalled();

    await expect(service.confirm('member')).resolves.toContain(
      'pending until M-Pesa confirms',
    );
    expect(subscriptions.subscribe).toHaveBeenCalledWith(
      'member',
      'BRONZE',
      'MONTHLY',
    );
    expect(contributions.initiatePayment).toHaveBeenCalledWith(
      'member',
      500,
      'MPESA',
      '254712345678',
      false,
      undefined,
      'MONTHLY',
      { tier: 'BRONZE', amount: 500 },
      'WHATSAPP',
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
      'WHATSAPP',
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

  it('handles common Bronze selections and payer replies without an account summary', async () => {
    const { service, prisma } = build();
    expect(service.detectRequest('I want to pay for Bronze yearly')).toBe(
      'MEMBERSHIP_JOIN:BRONZE:ANNUAL',
    );
    expect(service.detectRequest('Bronze monthly')).toBe(
      'MEMBERSHIP_JOIN:BRONZE:MONTHLY',
    );
    expect(
      service.payerNumberFromMessage('Please send the prompt to 0723 456 789'),
    ).toBe('0723 456 789');
    expect(service.payerNumberFromMessage('0723456789')).toBe('0723456789');
    prisma.botDataAccessSession.findFirst.mockResolvedValue(null);
    await expect(
      service.acceptPayerReply('member', '0723456789'),
    ).resolves.toBeNull();
  });

  it('does not mistake a booking or an unclear choice for membership consent', () => {
    const { service } = build();
    expect(
      service.planFollowUpScope(
        'yes',
        'Would you like me to book a consultation?',
      ),
    ).toBeNull();
    expect(
      service.planFollowUpScope(
        'yes',
        'Bronze monthly or Silver yearly. Which would you like?',
      ),
    ).toBeNull();
    expect(
      service.planFollowUpScope(
        'yearly',
        'MenoBronze is available monthly or yearly. Which works for you?',
      ),
    ).toBe('MEMBERSHIP_JOIN:BRONZE:ANNUAL');
    expect(service.detectRequest('I only want to set up my membership')).toBe(
      'MEMBERSHIP_PAY',
    );
  });

  it('invites an unstarted member to select a plan after verification', async () => {
    const { service, prisma, contributions } = build();
    prisma.subscription.findUnique.mockResolvedValue(null);
    const reply = await service.offer(
      'member',
      'MEMBERSHIP_PAY',
      'verified',
      '+254712345678',
    );
    expect(reply).toContain(
      'make your first payment right here.\n\n*Membership options*',
    );
    expect(reply).toContain(
      '*MenoSilver*\nKES 800 monthly · KES 8,000 yearly\n\nTo choose',
    );
    expect(contributions.initiatePayment).not.toHaveBeenCalled();
  });

  it('tells a paid-up member nothing more is due without opening a quote', async () => {
    const { service, prisma, subscriptions, contributions } = build();
    subscriptions.checkPaymentFrequencyRestriction.mockRejectedValue(
      new BadRequestException('You have already made an annual payment.'),
    );
    await expect(
      service.offer('member', 'MEMBERSHIP_PAY', 'verified', '+254712345678'),
    ).resolves.toContain('Nothing extra is due right now');
    expect(prisma.botDataAccessSession.upsert).not.toHaveBeenCalled();
    expect(contributions.initiatePayment).not.toHaveBeenCalled();
  });

  it('restarts verification when a payer number arrives before a quote', async () => {
    const { service, prisma, contributions } = build();
    prisma.botDataAccessSession.findFirst.mockReset();
    prisma.botDataAccessSession.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ scope: 'MEMBERSHIP_JOIN:BRONZE:MONTHLY' })
      .mockResolvedValueOnce(null);
    const restart = jest
      .fn()
      .mockResolvedValue('Reply with the 6-digit verification code.');

    const reply = await service.acceptPayerReply(
      'member',
      '0723456789',
      restart,
    );

    expect(restart).toHaveBeenCalledWith('MEMBERSHIP_JOIN:BRONZE:MONTHLY');
    expect(reply).toContain('After verification, send the payer number again');
    expect(contributions.initiatePayment).not.toHaveBeenCalled();
  });

  it('refreshes an expired quote using a new confirmation code', async () => {
    const { service, prisma, quote, contributions } = build();
    prisma.botDataAccessSession.upsert.mockResolvedValue({
      ...quote,
      expiresAt: new Date(Date.now() - 1000),
    });

    const reply = await service.offer(
      'member',
      'MEMBERSHIP_PAY',
      'verified',
      '+254712345678',
    );

    expect(reply).toMatch(/confirm M-Pesa [A-F0-9]{6}/);
    expect(prisma.botDataAccessSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'PAYMENT_QUOTED' }),
      }),
    );
    expect(contributions.initiatePayment).not.toHaveBeenCalled();
  });

  it('cannot send an STK prompt if the quote’s SMS verification has expired', async () => {
    const { service, prisma, contributions } = build();
    prisma.botDataAccessSession.findUnique.mockResolvedValue(null);
    await expect(service.confirm('member')).resolves.toContain('verification has expired');
    expect(contributions.initiatePayment).not.toHaveBeenCalled();
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
