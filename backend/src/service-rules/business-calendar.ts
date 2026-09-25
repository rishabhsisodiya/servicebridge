import type { FieldError } from '../core/http/app.exception';

/** One opening window on a weekday. Several per day are allowed (e.g. around lunch). */
export interface OpeningWindow {
  /** 0 = Sunday … 6 = Saturday */
  day: number;
  /** "HH:MM", 24-hour */
  open: string;
  close: string;
}

export interface Holiday {
  /** "YYYY-MM-DD" in the company time zone */
  date: string;
  name: string;
}

export interface CalendarRules {
  alwaysOpen: boolean;
  hours: OpeningWindow[];
  holidays: Holiday[];
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$|^24:00$/;
const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
export const MAX_HOLIDAYS = 100;

const toMinutes = (time: string) => {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
};

/** Field errors for a calendar; empty when it is valid. */
export function calendarProblems(rules: CalendarRules): FieldError[] {
  const problems: FieldError[] = [];
  if (!rules.alwaysOpen) {
    if (!rules.hours.length) {
      problems.push({
        field: 'hours',
        message: 'Add at least one opening window, or choose 24×7.',
      });
    }
    rules.hours.forEach((w, i) => {
      if (!Number.isInteger(w.day) || w.day < 0 || w.day > 6) {
        problems.push({ field: `hours.${i}.day`, message: 'Choose a day of the week.' });
      } else if (!TIME.test(w.open) || !TIME.test(w.close)) {
        problems.push({ field: `hours.${i}`, message: 'Use 24-hour times, e.g. 09:00.' });
      } else if (toMinutes(w.open) >= toMinutes(w.close)) {
        problems.push({ field: `hours.${i}`, message: 'Closing time must be after opening time.' });
      }
    });
    if (!problems.length) {
      for (let day = 0; day < 7; day++) {
        const windows = rules.hours
          .filter((w) => w.day === day)
          .sort((a, b) => toMinutes(a.open) - toMinutes(b.open));
        for (let i = 1; i < windows.length; i++) {
          if (toMinutes(windows[i].open) < toMinutes(windows[i - 1].close)) {
            problems.push({ field: 'hours', message: 'Opening windows on the same day overlap.' });
            break;
          }
        }
      }
    }
  }
  if (rules.holidays.length > MAX_HOLIDAYS) {
    problems.push({ field: 'holidays', message: `Add at most ${MAX_HOLIDAYS} holidays.` });
  }
  const seen = new Set<string>();
  rules.holidays.forEach((h, i) => {
    if (!DATE.test(h.date) || Number.isNaN(Date.parse(`${h.date}T00:00:00Z`))) {
      problems.push({ field: `holidays.${i}.date`, message: 'Use a date like 2026-10-02.' });
    } else if (seen.has(h.date)) {
      problems.push({ field: `holidays.${i}.date`, message: 'This date is listed twice.' });
    }
    seen.add(h.date);
    if (!h.name.trim() || h.name.length > 80) {
      problems.push({
        field: `holidays.${i}.name`,
        message: 'Name the holiday (up to 80 characters).',
      });
    }
  });
  return problems;
}

interface LocalDay {
  year: number;
  month: number;
  day: number;
  weekday: number;
  minute: number;
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function localParts(date: Date, timeZone: string): LocalDay {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    weekday: WEEKDAYS[parts.weekday],
    minute: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

/** Milliseconds the zone is ahead of UTC at `date`. */
function zoneOffset(date: Date, timeZone: string): number {
  const p = localParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, 0, p.minute);
  return asUtc - Math.floor(date.getTime() / 60_000) * 60_000;
}

/** The instant a local wall-clock time happens in `timeZone`. */
function fromLocal(year: number, month: number, day: number, minute: number, timeZone: string) {
  const guess = Date.UTC(year, month - 1, day, 0, minute);
  let result = guess - zoneOffset(new Date(guess), timeZone);
  // A second pass settles times close to a daylight-saving change.
  result = guess - zoneOffset(new Date(result), timeZone);
  return new Date(result);
}

const isoDate = (d: LocalDay) =>
  `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;

/**
 * The moment `minutes` of open time have passed after `start`.
 * Used for SLA due times: the clock only runs while the calendar is open.
 */
export function addBusinessMinutes(
  start: Date,
  minutes: number,
  rules: CalendarRules,
  timeZone: string,
): Date {
  if (rules.alwaysOpen || minutes <= 0) return new Date(start.getTime() + minutes * 60_000);
  const holidays = new Set(rules.holidays.map((h) => h.date));
  let remaining = minutes;
  let cursor = localParts(start, timeZone);
  let fromMinute = cursor.minute;

  // Two years is far beyond any SLA; it only guards against a calendar with no open time.
  for (let i = 0; i < 732; i++) {
    if (!holidays.has(isoDate(cursor))) {
      const windows = rules.hours
        .filter((w) => w.day === cursor.weekday)
        .map((w) => [toMinutes(w.open), toMinutes(w.close)] as const)
        .sort((a, b) => a[0] - b[0]);
      for (const [open, close] of windows) {
        const from = Math.max(open, fromMinute);
        if (from >= close) continue;
        if (remaining <= close - from) {
          return fromLocal(cursor.year, cursor.month, cursor.day, from + remaining, timeZone);
        }
        remaining -= close - from;
      }
    }
    // Midday UTC on the next calendar day avoids any zone-offset edge.
    const next = new Date(Date.UTC(cursor.year, cursor.month - 1, cursor.day + 1, 12));
    cursor = { ...localParts(next, 'UTC'), minute: 0 };
    fromMinute = 0;
  }
  throw new Error('Calendar has no open time');
}

/** Open minutes between `from` and `to` (0 when `to` is not after `from`). Used when an SLA clock pauses. */
export function businessMinutesBetween(
  from: Date,
  to: Date,
  rules: CalendarRules,
  timeZone: string,
): number {
  if (to <= from) return 0;
  if (rules.alwaysOpen) return Math.floor((to.getTime() - from.getTime()) / 60_000);
  const holidays = new Set(rules.holidays.map((h) => h.date));
  const end = localParts(to, timeZone);
  const endDate = isoDate(end);
  let cursor = localParts(from, timeZone);
  let fromMinute = cursor.minute;
  let total = 0;

  for (let i = 0; i < 732; i++) {
    const date = isoDate(cursor);
    const lastDay = date === endDate;
    const toMinute = lastDay ? end.minute : 24 * 60;
    if (!holidays.has(date)) {
      for (const w of rules.hours.filter((h) => h.day === cursor.weekday)) {
        total += Math.max(
          0,
          Math.min(toMinutes(w.close), toMinute) - Math.max(toMinutes(w.open), fromMinute),
        );
      }
    }
    if (lastDay) return total;
    const next = new Date(Date.UTC(cursor.year, cursor.month - 1, cursor.day + 1, 12));
    cursor = { ...localParts(next, 'UTC'), minute: 0 };
    fromMinute = 0;
  }
  return total;
}
