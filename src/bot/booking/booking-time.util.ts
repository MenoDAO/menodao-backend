/**
 * booking-time.util.ts
 *
 * Pure timezone-safe helpers for the booking flow.
 * Uses Luxon for all date/time math so we never rely on server-local time.
 * No I/O — all DB calls live in BookingService.
 */
import { DateTime, Info } from 'luxon';

// ── Config defaults ─────────────────────────────────────────────────────────
export const DEFAULT_TZ = 'Africa/Nairobi';
export const DEFAULT_OPEN_DAYS = [1, 2, 3, 4, 5, 6]; // Mon–Sat
export const DEFAULT_OPEN_TIME = '08:00';
export const DEFAULT_CLOSE_TIME = '17:00';
export const DEFAULT_SLOT_MINUTES = 30;

export interface BookingConfig {
  timezone: string;
  openDays: number[]; // ISO weekday numbers 1=Mon … 7=Sun
  openTime: string; // 'HH:mm'
  closeTime: string; // 'HH:mm'
  slotMinutes: number;
  draftTtlMinutes: number;
}

export type SlotValidationResult =
  | 'OK'
  | 'PAST'
  | 'CLOSED_DAY'
  | 'OUTSIDE_HOURS'
  | 'NOT_ON_SLOT_BOUNDARY';

// ── Date anchors ─────────────────────────────────────────────────────────────

/**
 * Returns the current moment in the booking timezone.
 */
export function nairobiNow(cfg: BookingConfig): DateTime {
  return DateTime.now().setZone(cfg.timezone);
}

export interface DateAnchors {
  todayIso: string; // YYYY-MM-DD in booking TZ
  dayName: string; // e.g. "Sunday"
  currentTime: string; // HH:mm in booking TZ
  tomorrowIso: string; // YYYY-MM-DD in booking TZ
  nextWeekIso: string; // YYYY-MM-DD in booking TZ
}

/**
 * Returns human-readable date anchors for prompt injection.
 */
export function anchors(cfg: BookingConfig): DateAnchors {
  const now = nairobiNow(cfg);
  return {
    todayIso: now.toISODate()!,
    dayName: now.weekdayLong!, // e.g. "Sunday"
    currentTime: now.toFormat('HH:mm'),
    tomorrowIso: now.plus({ days: 1 }).toISODate()!,
    nextWeekIso: now.plus({ weeks: 1 }).startOf('week').toISODate()!,
  };
}

// ── Conversion ───────────────────────────────────────────────────────────────

/**
 * Combines a Nairobi date string (YYYY-MM-DD) and 24h time (HH:mm) into a UTC
 * JS Date, suitable for Prisma's DateTime field (stored as UTC).
 */
export function toScheduledAt(
  dateIso: string,
  timeHHmm: string,
  cfg: BookingConfig,
): Date {
  const [hour, minute] = timeHHmm.split(':').map(Number);
  const dt = DateTime.fromISO(dateIso, { zone: cfg.timezone }).set({
    hour,
    minute,
    second: 0,
    millisecond: 0,
  });
  return dt.toUTC().toJSDate();
}

// ── Validation ───────────────────────────────────────────────────────────────

/**
 * Validates a candidate slot against opening hours / working days.
 * @param dateIso  YYYY-MM-DD (in booking timezone)
 * @param timeHHmm HH:mm 24h (in booking timezone)
 * @param now      Current moment in booking timezone (pass nairobiNow() so it's
 *                 easy to stub in tests)
 */
export function validateSlot(
  dateIso: string,
  timeHHmm: string,
  now: DateTime,
  cfg: BookingConfig,
): SlotValidationResult {
  const [hour, minute] = timeHHmm.split(':').map(Number);
  const candidate = DateTime.fromISO(dateIso, { zone: cfg.timezone }).set({
    hour,
    minute,
    second: 0,
    millisecond: 0,
  });

  // 1. Past?
  if (candidate <= now) return 'PAST';

  // 2. Closed day?
  const weekday = candidate.weekday; // 1=Mon, 7=Sun
  if (!cfg.openDays.includes(weekday)) return 'CLOSED_DAY';

  // 3. Outside opening hours?
  const [openH, openM] = cfg.openTime.split(':').map(Number);
  const [closeH, closeM] = cfg.closeTime.split(':').map(Number);
  const slotEndMinutes = hour * 60 + minute + cfg.slotMinutes;
  const openMinutes = openH * 60 + openM;
  const closeMinutes = closeH * 60 + closeM;
  if (hour * 60 + minute < openMinutes || slotEndMinutes > closeMinutes) {
    return 'OUTSIDE_HOURS';
  }

  // 4. On a slot boundary?
  const minutesSinceOpen = hour * 60 + minute - openMinutes;
  if (minutesSinceOpen % cfg.slotMinutes !== 0) {
    return 'NOT_ON_SLOT_BOUNDARY';
  }

  return 'OK';
}

// ── Slot-snapping helper ─────────────────────────────────────────────────────

/**
 * Given a 24h time like "10:15", snaps it to the nearest earlier slot boundary.
 * Useful for friendly error messages showing what valid times look like.
 */
export function snapToSlot(timeHHmm: string, cfg: BookingConfig): string {
  const [h, m] = timeHHmm.split(':').map(Number);
  const [openH, openM] = cfg.openTime.split(':').map(Number);
  const openMinutes = openH * 60 + openM;
  const totalMinutes = h * 60 + m;
  const sinceOpen = totalMinutes - openMinutes;
  const snapped =
    openMinutes + Math.floor(sinceOpen / cfg.slotMinutes) * cfg.slotMinutes;
  const sh = Math.floor(snapped / 60);
  const sm = snapped % 60;
  return `${String(sh).padStart(2, '0')}:${String(sm).padStart(2, '0')}`;
}

/**
 * Lists all valid slot times for a given day (strings "HH:mm").
 */
export function daySlots(cfg: BookingConfig): string[] {
  const [openH, openM] = cfg.openTime.split(':').map(Number);
  const [closeH, closeM] = cfg.closeTime.split(':').map(Number);
  const openMinutes = openH * 60 + openM;
  const closeMinutes = closeH * 60 + closeM;
  const slots: string[] = [];
  for (
    let m = openMinutes;
    m + cfg.slotMinutes <= closeMinutes;
    m += cfg.slotMinutes
  ) {
    const h = Math.floor(m / 60);
    const min = m % 60;
    slots.push(`${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`);
  }
  return slots;
}

/**
 * Human-readable day names for the open days.
 */
export function openDayNames(cfg: BookingConfig): string {
  return cfg.openDays.map((d) => Info.weekdays('long')[d - 1]).join(', ');
}
