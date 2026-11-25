import { ConfigService } from '@nestjs/config';
import { CareIntelligenceService } from './care-intelligence.service';

describe('WhatsApp booking dashboard', () => {
  it('counts linked outcomes, open drafts and repeat attendance within the booking cohort', async () => {
    const prisma = {
      careEvent: {
        findMany: jest.fn().mockResolvedValue([
          { id: '1', metadata: { appointmentId: 'first' } },
          { id: '2', metadata: { appointmentId: 'second' } },
          { id: '3', metadata: { appointmentId: 'third' } },
          { id: '4', metadata: { cancelled: true } },
          { id: '5', metadata: null },
          { id: '6', metadata: null },
        ]),
      },
      appointment: {
        findMany: jest.fn().mockResolvedValue([
          { memberId: 'm1', status: 'ATTENDED', visit: { status: 'DISCHARGED' } },
          { memberId: 'm1', status: 'ATTENDED', visit: { status: 'OPEN' } },
          { memberId: 'm2', status: 'NO_SHOW', visit: null },
        ]),
      },
      botBookingDraft: { count: jest.fn().mockResolvedValue(1) },
    };
    const service = new CareIntelligenceService(
      prisma as never,
      new ConfigService({ BOT_BOOKING_DRAFT_TTL_MINUTES: 30 }),
    );

    const result = await service['whatsappBookingStats'](
      new Date('2026-11-01'),
      new Date('2026-12-01'),
    );

    expect(prisma.appointment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['first', 'second', 'third'] } } }),
    );
    expect(result).toMatchObject({
      started: 6,
      booked: 3,
      attended: 2,
      completedVisits: 1,
      noShows: 1,
      stopped: 1,
      abandoned: 1,
      inProgress: 1,
      conversionRate: 0.5,
      dropOffRate: 2 / 6,
      repeatAttendanceRate: 1,
    });
  });
});

describe('STK membership revenue', () => {
  it('reports confirmed amounts separately and leaves legacy records unattributed', async () => {
    const aggregate = jest.fn()
      .mockResolvedValueOnce({ _sum: { amount: 350 }, _count: { _all: 1 } })
      .mockResolvedValueOnce({ _sum: { amount: 1100 }, _count: { _all: 2 } })
      .mockResolvedValueOnce({ _sum: { amount: 2150 }, _count: { _all: 4 } });
    const prisma = {
      contribution: { aggregate },
      $transaction: jest.fn((queries: Promise<unknown>[]) => Promise.all(queries)),
    };
    const service = new CareIntelligenceService(prisma as never, new ConfigService());
    const from = new Date('2026-11-01');
    const to = new Date('2026-12-01');

    await expect(service['membershipStkRevenue'](from, to)).resolves.toEqual({
      whatsappKes: 350, whatsappPayments: 1,
      webKes: 1100, webPayments: 2,
      unattributedKes: 700, unattributedPayments: 1,
    });
    expect(aggregate).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: expect.objectContaining({
        status: 'COMPLETED', metadata: { path: ['stkSource'], equals: 'WHATSAPP' },
        OR: [
          { confirmedAt: { gte: from, lt: to } },
          { confirmedAt: null, createdAt: { gte: from, lt: to } },
        ],
      }),
    }));
  });
});
