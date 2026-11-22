import { DateTime } from 'luxon';

export interface ParsedBookingDateTime {
  dateIso?: string;
  timeHHmm?: string;
  rawDate?: string;
  rawTime?: string;
}

const SWAHILI_WEEKDAYS: Record<string, number> = {
  jumatatu: 1,
  jumanne: 2,
  jumatano: 3,
  alhamisi: 4,
  ijumaa: 5,
  jumamosi: 6,
  jumapili: 7,
};

const ENGLISH_WEEKDAYS: Record<string, number> = {
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
  sunday: 7,
};

const SWAHILI_NUMBERS: Record<string, number> = {
  moja: 1,
  mbili: 2,
  tatu: 3,
  nne: 4,
  tano: 5,
  sita: 6,
  saba: 7,
  nane: 8,
  tisa: 9,
  kumi: 10,
};

const SWAHILI_MONTHS: Record<string, number> = {
  januari: 1,
  februari: 2,
  machi: 3,
  aprili: 4,
  mei: 5,
  juni: 6,
  julai: 7,
  agosti: 8,
  septemba: 9,
  oktoba: 10,
  novemba: 11,
  desemba: 12,
};

function parseSwahiliNumberPhrase(phrase: string): number | null {
  const cleaned = phrase
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '');
  if (/^\d+$/.test(cleaned)) return Number(cleaned);
  if (SWAHILI_NUMBERS[cleaned] !== undefined) return SWAHILI_NUMBERS[cleaned];

  const teen = cleaned.match(/^kumi\s+na\s+(.+)$/);
  if (teen && SWAHILI_NUMBERS[teen[1].trim()] !== undefined) {
    return 10 + SWAHILI_NUMBERS[teen[1].trim()];
  }
  return null;
}

function parseTimeToken(token: string): number | null {
  const n = parseSwahiliNumberPhrase(token);
  return n !== null && n >= 0 && n <= 59 ? n : null;
}

function convertSwahiliHour(hour: number, period?: string): number | null {
  if (!Number.isInteger(hour) || hour < 1 || hour > 12) return null;
  const p = (period || '').toLowerCase();

  if (
    p.includes('asubuhi') ||
    p.includes('morning') ||
    p.includes('alfajiri')
  ) {
    return hour <= 6 ? hour + 6 : hour;
  }
  if (
    p.includes('mchana') ||
    p.includes('adhuhuri') ||
    p.includes('alasiri') ||
    p.includes('afternoon')
  ) {
    return hour <= 6 ? hour + 12 : hour + 6;
  }
  if (
    p.includes('jioni') ||
    p.includes('magharibi') ||
    p.includes('machweo') ||
    p.includes('evening')
  ) {
    // "saa mbili jioni" means 8pm, while "saa kumi jioni" means 4pm.
    return hour <= 6 ? hour + 18 : hour + 6;
  }
  if (p.includes('usiku') || p.includes('night')) {
    return hour <= 6 ? hour + 18 : hour - 6;
  }
  // No period: treat 1-6 as morning and 7-12 as afternoon/evening.
  return hour <= 6 ? hour + 6 : hour + 6;
}

function parseSwahiliTime(text: string): { time?: string; raw?: string } {
  const lower = text.toLowerCase();

  // Standard numeric times: 10:30, 10.30, 10 30.
  const numeric = lower.match(/\b(\d{1,2})[:. ](\d{2})\s*(am|pm)?\b/);
  if (numeric) {
    let hour = Number(numeric[1]);
    const minute = Number(numeric[2]);
    const meridiem = numeric[3];
    if (meridiem === 'pm' && hour < 12) hour += 12;
    if (meridiem === 'am' && hour === 12) hour = 0;
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      return {
        time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
        raw: numeric[0].trim(),
      };
    }
  }

  // "4pm", "4 pm", "4am".
  const meridiemOnly = lower.match(/\b(\d{1,2})\s*(am|pm)\b/);
  if (meridiemOnly) {
    let hour = Number(meridiemOnly[1]);
    const meridiem = meridiemOnly[2];
    if (meridiem === 'pm' && hour < 12) hour += 12;
    if (meridiem === 'am' && hour === 12) hour = 0;
    if (hour >= 0 && hour <= 23) {
      return {
        time: `${String(hour).padStart(2, '0')}:00`,
        raw: meridiemOnly[0].trim(),
      };
    }
  }

  // "saa mbili jioni", "saa 4 asubuhi", "saa kumi na mbili jioni".
  const saaMatch = lower.match(
    /\bsaa\s+([a-z0-9 ]+?)(?=\s+(?:asubuhi|mchana|adhuhuri|alasiri|jioni|magharibi|machweo|usiku|morning|afternoon|evening|night|am|pm)\b|$)/i,
  );
  if (saaMatch) {
    const periodMatch = lower.match(
      /\bsaa\s+[a-z0-9 ]+?\s+(asubuhi|mchana|adhuhuri|alasiri|jioni|magharibi|machweo|usiku|morning|afternoon|evening|night|am|pm)\b/i,
    );
    const period = periodMatch?.[1];
    const saaPhrase = saaMatch[1].trim();
    const [hourPhrase, ...minuteParts] = saaPhrase.split(/\s+na\s+/i);
    const hour = parseSwahiliNumberPhrase(hourPhrase);
    if (hour !== null) {
      const convertedHour = convertSwahiliHour(hour, period);
      if (convertedHour !== null) {
        let minute = 0;
        const minutePhrase = minuteParts.join(' ').trim();
        if (minutePhrase === 'nusu' || minutePhrase === 'half') minute = 30;
        else if (minutePhrase === 'robo') minute = 15;
        else if (
          minutePhrase === 'robo tatu' ||
          minutePhrase === 'three quarters'
        )
          minute = 45;
        else if (minutePhrase) {
          const parsedMinute = parseTimeToken(minutePhrase);
          if (parsedMinute !== null) minute = parsedMinute;
        }
        const normalizedHour = ((convertedHour % 24) + 24) % 24;
        return {
          time: `${String(normalizedHour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
          raw: saaMatch[0].trim() + (period ? ` ${period}` : ''),
        };
      }
    }
  }

  // "saa 4" with no period and no minutes.
  const bareSaa = lower.match(/\bsaa\s+(\d{1,2})\b/);
  if (bareSaa) {
    const hour = convertSwahiliHour(Number(bareSaa[1]), undefined);
    if (hour !== null) {
      const normalizedHour = ((hour % 24) + 24) % 24;
      return {
        time: `${String(normalizedHour).padStart(2, '0')}:00`,
        raw: bareSaa[0].trim(),
      };
    }
  }

  return {};
}

function parseEnglishSwahiliDate(text: string, now: DateTime): DateTime | null {
  const lower = text.toLowerCase();

  if (/\bleo\b|\btoday\b/.test(lower)) return now.startOf('day');
  if (/\bkesho\b|\btomorrow\b/.test(lower))
    return now.plus({ days: 1 }).startOf('day');
  if (/\bjana\b|\byesterday\b/.test(lower))
    return now.minus({ days: 1 }).startOf('day');

  const nextWeek = /\bwiki ijayo\b|\bnext week\b/.test(lower);

  const allWeekdays = { ...SWAHILI_WEEKDAYS, ...ENGLISH_WEEKDAYS };
  for (const [name, weekday] of Object.entries(allWeekdays)) {
    const regex = new RegExp(`\\b${name}\\b`, 'i');
    if (!regex.test(text)) continue;

    let candidate = now.startOf('day');
    let guard = 0;
    while (guard < 15) {
      if (
        candidate.weekday === weekday &&
        !(nextWeek && candidate <= now.startOf('day'))
      ) {
        break;
      }
      candidate = candidate.plus({ days: 1 });
      guard += 1;
    }
    if (nextWeek && candidate <= now.startOf('day').plus({ days: 6 })) {
      candidate = candidate.plus({ days: 7 });
    }
    return candidate;
  }

  return null;
}

export function parseBookingDateTime(
  text: string,
  now: DateTime,
  timezone = 'Africa/Nairobi',
): ParsedBookingDateTime {
  const result: ParsedBookingDateTime = {};
  const lower = text.toLowerCase();

  // ISO date.
  const isoMatch = text.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (isoMatch) {
    const candidate = DateTime.fromISO(
      `${isoMatch[1]}-${isoMatch[2].padStart(2, '0')}-${isoMatch[3].padStart(2, '0')}`,
      { zone: timezone },
    );
    if (candidate.isValid) {
      result.dateIso = candidate.toISODate()!;
      result.rawDate = isoMatch[0];
    }
  }

  // DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY.
  if (!result.dateIso) {
    const dmy = text.match(/\b(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?\b/);
    if (dmy) {
      const day = Number(dmy[1]);
      const month = Number(dmy[2]);
      let year = dmy[3] ? Number(dmy[3]) : now.year;
      if (year < 100) year += 2000;
      const candidate = DateTime.fromObject(
        { day, month, year },
        { zone: timezone },
      );
      if (candidate.isValid) {
        const adjusted =
          !dmy[3] && candidate < now.startOf('day')
            ? candidate.plus({ months: 1 })
            : candidate;
        result.dateIso = adjusted.toISODate()!;
        result.rawDate = dmy[0];
      }
    }
  }

  // Month-name dates, including Swahili month names.
  if (!result.dateIso) {
    const monthNames = Object.keys(SWAHILI_MONTHS).join('|');
    const swahiliMonthMatch = lower.match(
      new RegExp(`\\b(\\d{1,2})\\s+(${monthNames})(?:\\s+(\\d{4}))?\\b`, 'i'),
    );
    if (swahiliMonthMatch) {
      const day = Number(swahiliMonthMatch[1]);
      const month = SWAHILI_MONTHS[swahiliMonthMatch[2].toLowerCase()];
      const year = swahiliMonthMatch[3]
        ? Number(swahiliMonthMatch[3])
        : now.year;
      const candidate = DateTime.fromObject(
        { day, month, year },
        { zone: timezone },
      );
      if (candidate.isValid) {
        const adjusted =
          !swahiliMonthMatch[3] && candidate < now.startOf('day')
            ? candidate.plus({ months: 1 })
            : candidate;
        result.dateIso = adjusted.toISODate()!;
        result.rawDate = swahiliMonthMatch[0];
      }
    }
  }

  // "tarehe 5" / "date 5" / "on 5".
  if (!result.dateIso) {
    const dayOnly = lower.match(/\b(?:tarehe|date|on)\s+(\d{1,2})\b/);
    if (dayOnly) {
      const day = Number(dayOnly[1]);
      let candidate = now.set({ day }).startOf('day');
      if (candidate < now.startOf('day'))
        candidate = candidate.plus({ months: 1 });
      if (candidate.isValid) {
        result.dateIso = candidate.toISODate()!;
        result.rawDate = dayOnly[0];
      }
    }
  }

  if (!result.dateIso) {
    const relativeOrWeekday = parseEnglishSwahiliDate(text, now);
    if (relativeOrWeekday) {
      result.dateIso = relativeOrWeekday.toISODate()!;
      result.rawDate = relativeOrWeekday.toISODate()!;
    }
  }

  const timeResult = parseSwahiliTime(text);
  if (timeResult.time) {
    result.timeHHmm = timeResult.time;
    result.rawTime = timeResult.raw;
  }

  return result;
}
