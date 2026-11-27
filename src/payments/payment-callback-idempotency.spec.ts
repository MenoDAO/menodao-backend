import { createHmac } from 'node:crypto';
import { SasaPayService } from '../sasapay/sasapay.service';
import { ConfigService } from '@nestjs/config';
import { PaymentCallbackData, PaymentService } from './payment.service';

function build() {
  const contribution = {
    id: 'contribution',
    memberId: 'beneficiary',
    amount: 350,
    status: 'PENDING',
    checkoutRequestId: 'provider-checkout',
    merchantRequestId: 'provider-merchant',
    paymentRef: 'menodao_reference',
    createdAt: new Date(),
    metadata: {
      stkSource: 'WHATSAPP',
      purchasedTier: 'BRONZE',
      purchasedMonthlyAmount: 350,
      purchasedAnnualCap: 6000,
      paymentFrequency: 'MONTHLY',
    },
  };
  const subscription = {
    id: 'subscription',
    tier: 'SILVER',
    isActive: false,
    member: { phoneNumber: '+254712345678', preferredLanguage: 'en' },
  };
  const callback: PaymentCallbackData = {
    CheckoutRequestID: 'provider-checkout',
    MerchantRequestID: 'provider-merchant',
    ResultCode: '0',
    Amount: 350,
    MpesaReceiptNumber: 'RECEIPT',
    PhoneNumber: '254711111111',
  };
  const prisma = {
    contribution: {
      findMany: jest.fn().mockImplementation(() => [{ ...contribution }]),
      findFirst: jest.fn().mockResolvedValue(null),
      updateMany: jest.fn().mockImplementation(({ data }) => {
        contribution.status = data.status;
        return { count: 1 };
      }),
      update: jest.fn(),
    },
    appointment: { findFirst: jest.fn().mockResolvedValue(null) },
    subscription: {
      findUnique: jest.fn().mockResolvedValue(subscription),
      update: jest
        .fn()
        .mockResolvedValue({ ...subscription, tier: 'BRONZE', isActive: true }),
    },
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation((run) => run(prisma));
  const sms = { sendSms: jest.fn().mockResolvedValue(undefined) };
  const referrals = {
    creditCommission: jest.fn().mockResolvedValue(undefined),
  };
  const proof = { reference: 'menodao_reference', token: 'callback-token' };
  const provider = { verifyStkCallback: jest.fn().mockReturnValue(true) };
  const notices = { enqueue: jest.fn().mockResolvedValue(undefined) };
  const service = new PaymentService(
    new ConfigService(),
    prisma as never,
    provider as never,
    sms as never,
    referrals as never,
    undefined,
    notices as never,
  );
  return {
    service,
    prisma,
    contribution,
    callback,
    sms,
    referrals,
    notices,
    provider,
    proof,
  };
}

describe('SasaPay settlement', () => {
  it('queues the failed payment update inside settlement', async () => {
    const { service, prisma, callback, proof, notices } = build();
    await expect(
      service.processCallback({ ...callback, ResultCode: 'SP01002' }, proof),
    ).resolves.toMatchObject({ success: true });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(notices.enqueue).toHaveBeenCalledWith(
      prisma,
      'beneficiary',
      'contribution',
      'MEMBERSHIP_FAILED',
    );
  });

  it('credits the original beneficiary and quoted tier exactly once, even with a different payer phone', async () => {
    const { service, prisma, callback, sms, referrals, proof, notices } =
      build();

    await expect(
      service.processCallback(callback, proof),
    ).resolves.toMatchObject({
      success: true,
      contributionId: 'contribution',
    });
    await expect(service.processCallback(callback, proof)).resolves.toEqual({
      success: true,
      message: 'Payment already processed',
    });
    await service.processCallback({ ...callback, ResultCode: '1032' }, proof);

    expect(prisma.contribution.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.contribution.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'COMPLETED',
          confirmedAt: expect.any(Date),
          metadata: expect.objectContaining({ stkSource: 'WHATSAPP' }),
        }),
      }),
    );
    expect(prisma.subscription.update).toHaveBeenCalledTimes(1);
    expect(prisma.subscription.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { memberId: 'beneficiary' },
        data: expect.objectContaining({
          tier: 'BRONZE',
          isActive: true,
          annualCapLimit: 6000,
        }),
      }),
    );
    expect(referrals.creditCommission).toHaveBeenCalledTimes(1);
    expect(notices.enqueue).toHaveBeenCalledTimes(1);
    expect(notices.enqueue).toHaveBeenCalledWith(
      prisma,
      'beneficiary',
      'contribution',
      'MEMBERSHIP_PAID',
    );
    expect(sms.sendSms).toHaveBeenCalledWith(
      '+254712345678',
      expect.stringContaining('MenoBronze'),
    );
  });

  it('rejects unidentified callbacks and amount mismatches', async () => {
    const { service, prisma, callback, proof } = build();
    await expect(
      service.processCallback({ ...callback, Amount: 100 }, proof),
    ).resolves.toMatchObject({ success: false });
    await expect(
      service.processCallback(
        { ...callback, CheckoutRequestID: 'different' },
        proof,
      ),
    ).resolves.toMatchObject({ success: false });
    await expect(
      service.processCallback({ ResultCode: '0', Amount: 350 }),
    ).resolves.toMatchObject({ success: false });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.contribution.findMany).toHaveBeenCalledTimes(2);
  });

  it('keeps a new STK contribution pending if callback proof is missing or invalid', async () => {
    const { service, prisma, callback, provider, proof } = build();
    await expect(service.processCallback(callback)).resolves.toMatchObject({
      success: false,
    });
    provider.verifyStkCallback.mockReturnValue(false);
    await expect(
      service.processCallback(callback, proof),
    ).resolves.toMatchObject({ success: false });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('requires proof even for a contribution without source metadata', async () => {
    const { service, prisma, contribution, callback } = build();
    prisma.contribution.findMany.mockResolvedValue([
      { ...contribution, metadata: null },
    ]);
    await expect(service.processCallback(callback)).resolves.toMatchObject({
      success: false,
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('retries a signed callback that precedes saving the provider checkout ID', async () => {
    const { service, prisma, contribution, callback, proof } = build();
    prisma.contribution.findMany.mockResolvedValue([
      { ...contribution, checkoutRequestId: null },
    ]);
    await expect(
      service.processCallback(callback, proof),
    ).resolves.toMatchObject({
      success: false,
      retryable: true,
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects conflicting outcomes and reused receipts', async () => {
    const { service, prisma, callback, proof } = build();
    await expect(
      service.processCallback({ ...callback, Paid: false }, proof),
    ).resolves.toMatchObject({
      success: false,
      message: 'Conflicting payment result',
    });
    prisma.contribution.findFirst.mockResolvedValueOnce({
      id: 'other-payment',
    });
    await expect(
      service.processCallback(callback, proof),
    ).resolves.toMatchObject({
      success: false,
      message: 'Payment receipt already used',
    });
    expect(prisma.contribution.updateMany).not.toHaveBeenCalled();
    expect(prisma.subscription.update).not.toHaveBeenCalled();
  });

  it('does not let an older payment replace a newer settled membership', async () => {
    const { service, prisma, callback, proof } = build();
    prisma.contribution.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'newer' });
    await expect(
      service.processCallback(callback, proof),
    ).resolves.toMatchObject({
      success: true,
    });
    expect(prisma.subscription.update).not.toHaveBeenCalled();
  });
});

describe('SasaPay checkout callback proof', () => {
  it('authenticates only the exact signed merchant reference', () => {
    const secret = 'test-secret';
    const service = new SasaPayService(
      new ConfigService({ SASAPAY_CLIENT_SECRET: secret }),
    );
    const reference = 'menodao_test';
    const token = createHmac('sha256', secret)
      .update(`menodao-stk-callback:${reference}`)
      .digest('hex');

    expect(service.verifyStkCallback(reference, token)).toBe(true);
    expect(service.verifyStkCallback('menodao_another', token)).toBe(false);
    expect(service.verifyStkCallback(reference, 'bad-token')).toBe(false);
  });
});
