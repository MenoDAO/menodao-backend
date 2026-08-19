import {
  generateDaySlots,
  inDayBeforeWindow,
  inHourBeforeWindow,
  isBookableTime,
  isNoShowDue,
  isOnClinicGrid,
  overlaps,
} from './appointment-slots';

describe('appointment-slots', () => {
  it('does not offer Sunday slots when the clinic is closed weekends', () => {
    expect(generateDaySlots('2026-08-23', false)).toEqual([]);
  });

  it('offers Saturday morning slots when the clinic operates weekends', () => {
    const slots = generateDaySlots('2026-08-22', true);
    expect(slots.length).toBeGreaterThan(0);
    expect(slots[0].toISOString()).toContain('2026-08-22');
  });

  it('detects overlapping 30-minute visits', () => {
    const a = new Date('2026-08-20T10:00:00+03:00');
    const b = new Date('2026-08-20T10:15:00+03:00');
    const c = new Date('2026-08-20T10:30:00+03:00');
    expect(overlaps(a, 30, b, 30)).toBe(true);
    expect(overlaps(a, 30, c, 30)).toBe(false);
  });

  it('rejects times with less than one hour notice', () => {
    const now = new Date('2026-08-20T10:00:00+03:00');
    const tooSoon = new Date('2026-08-20T10:30:00+03:00');
    expect(isBookableTime(tooSoon, now)).toMatch(/one hour/i);
  });

  it('opens the day-before reminder around 24 hours out, not earlier', () => {
    const appt = new Date('2026-08-21T10:00:00+03:00');
    expect(inDayBeforeWindow(appt, new Date('2026-08-20T10:00:00+03:00'))).toBe(
      true,
    );
    expect(inDayBeforeWindow(appt, new Date('2026-08-20T05:00:00+03:00'))).toBe(
      false,
    );
    expect(inHourBeforeWindow(appt, new Date('2026-08-21T09:00:00+03:00'))).toBe(
      true,
    );
    expect(inHourBeforeWindow(appt, new Date('2026-08-21T07:00:00+03:00'))).toBe(
      false,
    );
  });

  it('marks no-show only after the 2-hour grace', () => {
    const appt = new Date('2026-08-20T10:00:00+03:00');
    expect(isNoShowDue(appt, new Date('2026-08-20T11:00:00+03:00'))).toBe(false);
    expect(isNoShowDue(appt, new Date('2026-08-20T12:00:00+03:00'))).toBe(true);
  });

  it('rejects bookings more than 60 days ahead', () => {
    const now = new Date('2026-08-20T10:00:00+03:00');
    const tooFar = new Date('2026-10-20T10:00:00+03:00');
    expect(isBookableTime(tooFar, now)).toMatch(/60 days/i);
  });

  it('offers weekday slots from 08:00 to 16:30 EAT', () => {
    const slots = generateDaySlots('2026-08-20', false);
    expect(slots[0].toISOString()).toBe('2026-08-20T05:00:00.000Z');
    expect(slots[slots.length - 1].toISOString()).toBe('2026-08-20T13:30:00.000Z');
  });

  it('only accepts times that sit on the clinic grid', () => {
    expect(isOnClinicGrid(new Date('2026-08-20T10:00:00+03:00'), false)).toBe(true);
    expect(isOnClinicGrid(new Date('2026-08-20T10:07:00+03:00'), false)).toBe(false);
    expect(isOnClinicGrid(new Date('2026-08-23T10:00:00+03:00'), false)).toBe(false);
  });
});
