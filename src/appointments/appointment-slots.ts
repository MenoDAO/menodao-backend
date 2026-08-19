export const SLOT_MINUTES = 30;
export const WEEKDAY_START_HOUR = 8;
export const WEEKDAY_END_HOUR = 17;
export const SATURDAY_END_HOUR = 13;
export const MIN_NOTICE_MS = 60 * 60 * 1000;
export const MAX_ADVANCE_DAYS = 60;
export const NO_SHOW_GRACE_MS = 2 * 60 * 60 * 1000;
export const DAY_BEFORE_MIN_MS = 20 * 60 * 60 * 1000;
export const DAY_BEFORE_MAX_MS = 28 * 60 * 60 * 1000;
export const HOUR_BEFORE_MIN_MS = 50 * 60 * 1000;
export const HOUR_BEFORE_MAX_MS = 70 * 60 * 1000;

const EAT = '+03:00';

export function eatDateStart(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00${EAT}`);
}

export function formatEat(date: Date): string {
  return new Intl.DateTimeFormat('en-KE', {
    timeZone: 'Africa/Nairobi',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function overlaps(
  startA: Date,
  durationA: number,
  startB: Date,
  durationB: number,
): boolean {
  const endA = startA.getTime() + durationA * 60_000;
  const endB = startB.getTime() + durationB * 60_000;
  return startA.getTime() < endB && startB.getTime() < endA;
}

export function generateDaySlots(
  dateStr: string,
  operatesOnWeekends: boolean,
): Date[] {
  const start = eatDateStart(dateStr);
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Nairobi',
    weekday: 'short',
  }).format(start);

  if (weekday === 'Sun' && !operatesOnWeekends) return [];
  const endHour =
    weekday === 'Sat' || weekday === 'Sun' ? SATURDAY_END_HOUR : WEEKDAY_END_HOUR;
  if ((weekday === 'Sat' || weekday === 'Sun') && !operatesOnWeekends) return [];

  const slots: Date[] = [];
  for (let hour = WEEKDAY_START_HOUR; hour < endHour; hour++) {
    for (let minute = 0; minute < 60; minute += SLOT_MINUTES) {
      const isoHour = String(hour).padStart(2, '0');
      const isoMinute = String(minute).padStart(2, '0');
      slots.push(new Date(`${dateStr}T${isoHour}:${isoMinute}:00${EAT}`));
    }
  }
  return slots;
}

export function isBookableTime(scheduledAt: Date, now = new Date()): string | null {
  if (scheduledAt.getTime() < now.getTime() + MIN_NOTICE_MS) {
    return 'Appointments need at least one hour of notice.';
  }
  const max = now.getTime() + MAX_ADVANCE_DAYS * 86_400_000;
  if (scheduledAt.getTime() > max) {
    return `Appointments can be booked at most ${MAX_ADVANCE_DAYS} days ahead.`;
  }
  return null;
}

export function inDayBeforeWindow(scheduledAt: Date, now = new Date()): boolean {
  const delta = scheduledAt.getTime() - now.getTime();
  return delta >= DAY_BEFORE_MIN_MS && delta <= DAY_BEFORE_MAX_MS;
}

export function inHourBeforeWindow(scheduledAt: Date, now = new Date()): boolean {
  const delta = scheduledAt.getTime() - now.getTime();
  return delta >= HOUR_BEFORE_MIN_MS && delta <= HOUR_BEFORE_MAX_MS;
}

export function isNoShowDue(scheduledAt: Date, now = new Date()): boolean {
  return now.getTime() - scheduledAt.getTime() >= NO_SHOW_GRACE_MS;
}

export const OPEN_STATUSES = ['BOOKED', 'RESCHEDULED'] as const;
