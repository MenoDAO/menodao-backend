import { AppointmentStatus } from '@prisma/client';
import { ConsultationPaymentService } from './consultation-payment.service';

function setup() {
  const appointment = {
    id: 'appointment',
    consultationMethod: 'MPESA',
    consultationCheckoutId: 'checkout',
    consultationReceipt: null,
    status: AppointmentStatus.AWAITING_PAYMENT,
    scheduledAt: new Date(Date.now() + 86_400_000),
    clinic: { name: 'Dental Clinic' },
    member: { phoneNumber: '254712345678', preferredLanguage: 'en' },
  };
  const provider = { verifyStkCallback: jest.fn().mockReturnValue(true) };
  const db = {
    subscription: { findUnique: jest.fn().mockResolvedValue(null) },
    visit: { findFirst: jest.fn().mockResolvedValue(null) },
    appointment: {
      findUnique: jest.fn().mockResolvedValue(appointment),
      findUniqueOrThrow: jest.fn().mockResolvedValue(appointment),
      findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    contribution: { findFirst: jest.fn().mockResolvedValue(null) },
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
  };
  db.$transaction.mockImplementation((run) => run(db));
  const sms = { sendSms: jest.fn() };
  const calendar = { createAppointmentEvent: jest.fn() };
  const service = new ConsultationPaymentService(
    db as never,
    provider as never,
    sms as never,
    calendar as never,
  );
  const payload = {
    CheckoutRequestID: 'checkout',
    ResultCode: '0',
    TransAmount: '500.00',
    TransactionCode: 'RECEIPT',
  };
  return { service, provider, db, sms, calendar, appointment, payload };
}

describe('Consultation payments', () => {
  it('makes cash available only after a completed clinical visit', async () => {
    const { service, db } = setup();
    await expect(service.options('member')).resolves.toEqual({
      covered: false,
      cashAllowed: false,
    });
    expect(db.visit.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { memberId: 'member', status: 'DISCHARGED' },
      }),
    );
    db.visit.findFirst.mockResolvedValue({ id: 'visit' });
    await expect(service.options('member')).resolves.toEqual({
      covered: false,
      cashAllowed: true,
    });
  });

  it('rejects missing proof, a mismatched checkout, and underpayment', async () => {
    const { service, provider, db, payload } = setup();
    provider.verifyStkCallback.mockReturnValueOnce(false);
    await expect(service.settle('booking', 'bad', payload)).resolves.toEqual({
      success: false,
    });
    await expect(
      service.settle('booking', 'proof', {
        ...payload,
        CheckoutRequestID: 'wrong',
      }),
    ).resolves.toEqual({ success: false });
    await expect(
      service.settle('booking', 'proof', { ...payload, TransAmount: '350' }),
    ).resolves.toEqual({ success: false });
    expect(db.appointment.update).not.toHaveBeenCalled();
  });

  it('confirms the held slot once from a matching KES 500 callback', async () => {
    const { service, db, sms, appointment, payload } = setup();
    await expect(service.settle('booking', 'proof', payload)).resolves.toEqual({
      success: true,
    });
    db.appointment.findUniqueOrThrow.mockResolvedValue({
      ...appointment,
      consultationReceipt: 'RECEIPT',
    });
    await expect(service.settle('booking', 'proof', payload)).resolves.toEqual({
      success: true,
    });
    expect(db.appointment.update).toHaveBeenCalledTimes(1);
    expect(db.appointment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'appointment' },
        data: expect.objectContaining({
          status: 'BOOKED',
          consultationReceipt: 'RECEIPT',
        }),
      }),
    );
    expect(sms.sendSms).toHaveBeenCalledTimes(1);
  });

  it('rejects a receipt already used for a membership', async () => {
    const { service, db, payload } = setup();
    db.contribution.findFirst.mockResolvedValue({ id: 'membership' });
    await expect(service.settle('booking', 'proof', payload)).resolves.toEqual({
      success: false,
    });
    expect(db.appointment.update).not.toHaveBeenCalled();
  });
});
