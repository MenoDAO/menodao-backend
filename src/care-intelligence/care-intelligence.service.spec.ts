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
