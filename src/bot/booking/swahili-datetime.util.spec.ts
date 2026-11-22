import { DateTime } from 'luxon';
import { parseBookingDateTime } from './swahili-datetime.util';

describe('parseBookingDateTime', () => {
  const now = DateTime.fromISO('2026-11-23T09:00:00', { zone: 'Africa/Nairobi' });

  it('parses saa mbili jioni as 20:00', () => {
    expect(parseBookingDateTime('nataka kuja saa mbili jioni', now, 'Africa/Nairobi').timeHHmm).toBe('20:00');
  });

  it('parses saa nne asubuhi as 10:00', () => {
    expect(parseBookingDateTime('saa nne asubuhi', now, 'Africa/Nairobi').timeHHmm).toBe('10:00');
  });

  it('parses saa mbili usiku as 20:00 and saa saba usiku as 01:00', () => {
    expect(parseBookingDateTime('saa mbili usiku', now, 'Africa/Nairobi').timeHHmm).toBe('20:00');
    expect(parseBookingDateTime('saa saba usiku', now, 'Africa/Nairobi').timeHHmm).toBe('01:00');
  });

  it('parses kesho', () => {
    expect(parseBookingDateTime('kesho saa tatu asubuhi', now, 'Africa/Nairobi').dateIso).toBe('2026-11-24');
    expect(parseBookingDateTime('kesho saa tatu asubuhi', now, 'Africa/Nairobi').timeHHmm).toBe('09:00');
  });

  it('parses numeric and am/pm', () => {
    expect(parseBookingDateTime('tomorrow 2:30 pm', now, 'Africa/Nairobi').timeHHmm).toBe('14:30');
  });
});