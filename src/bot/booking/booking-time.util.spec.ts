import {
  BookingConfig,
  validateSlot,
  snapToSlot,
  daySlots,
  toScheduledAt,
} from './booking-time.util';
import { DateTime } from 'luxon';

const cfg: BookingConfig = {
  timezone: 'Africa/Nairobi',
  openDays: [1, 2, 3, 4, 5, 6],
  openTime: '08:00',
  closeTime: '17:00',
  slotMinutes: 30,
  draftTtlMinutes: 30,
};

describe('BookingTimeUtil (ported from menobot)', () => {
  it('accepts a future slot inside opening hours on an open day', () => {
    const now = DateTime.fromISO('2026-11-08T07:00:00', { zone: cfg.timezone });
    expect(validateSlot('2026-11-09', '10:00', now, cfg)).toBe('OK');
  });

  it('rejects past slots', () => {
    const now = DateTime.fromISO('2026-11-08T12:00:00', { zone: cfg.timezone });
    expect(validateSlot('2026-11-08', '10:00', now, cfg)).toBe('PAST');
  });

  it('rejects off-boundary times and snaps to the grid', () => {
    const now = DateTime.fromISO('2026-11-08T07:00:00', { zone: cfg.timezone });
    expect(validateSlot('2026-11-09', '10:15', now, cfg)).toBe(
      'NOT_ON_SLOT_BOUNDARY',
    );
    expect(snapToSlot('10:15', cfg)).toBe('10:00');
  });

  it('produces UTC dates from Nairobi local time', () => {
    const utc = toScheduledAt('2026-11-09', '10:00', cfg);
    // Nairobi is UTC+3, so 10:00 local = 07:00 UTC
    expect(utc.toISOString()).toBe('2026-11-09T07:00:00.000Z');
  });

  it('lists 18 half-hour slots in an 08:00–17:00 day', () => {
    expect(daySlots(cfg)).toHaveLength(18);
    expect(daySlots(cfg)[0]).toBe('08:00');
    expect(daySlots(cfg)[17]).toBe('16:30');
  });
});
