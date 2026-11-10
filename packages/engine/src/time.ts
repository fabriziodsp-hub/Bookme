/**
 * Calendar primitives in salon-local wall time.
 *
 * The engine reasons in "local date + minute of day" because every business rule
 * (opening hours, break, fixed starts) is defined in wall-clock terms. Conversion
 * to real instants happens only at the boundary (see tz.ts).
 */

/** ISO calendar date without time zone, e.g. "2026-11-03". */
export type LocalDate = string;

/** Minutes since local midnight, 0..1440. */
export type Minute = number;

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const HM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isLocalDate(value: string): value is LocalDate {
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

export function parseLocalDate(date: LocalDate): { year: number; month: number; day: number } {
  if (!isLocalDate(date)) throw new RangeError(`Invalid local date: ${date}`);
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return { year: y, month: m, day: d };
}

/** "HH:MM" → minutes since midnight. */
export function parseHm(hm: string): Minute {
  const m = HM_RE.exec(hm);
  if (!m) throw new RangeError(`Invalid time "${hm}", expected HH:MM`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Minutes since midnight → "HH:MM" (1440 renders as "24:00"). */
export function formatHm(minute: Minute): string {
  if (!Number.isInteger(minute) || minute < 0 || minute > 1440) {
    throw new RangeError(`Minute out of range: ${minute}`);
  }
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function toUtcMidnight(date: LocalDate): number {
  const { year, month, day } = parseLocalDate(date);
  return Date.UTC(year, month - 1, day);
}

function fromUtcMidnight(ms: number): LocalDate {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${String(y).padStart(4, '0')}-${m}-${day}`;
}

/** ISO weekday of a local date (Monday first). Pure arithmetic, independent of the host zone. */
export function weekdayOf(date: LocalDate): Weekday {
  const jsDay = new Date(toUtcMidnight(date)).getUTCDay(); // 0 = Sunday
  return WEEKDAYS[(jsDay + 6) % 7] as Weekday;
}

export function addDays(date: LocalDate, days: number): LocalDate {
  return fromUtcMidnight(toUtcMidnight(date) + days * 86_400_000);
}

export function daysBetween(from: LocalDate, to: LocalDate): number {
  return Math.round((toUtcMidnight(to) - toUtcMidnight(from)) / 86_400_000);
}

/** Monday of the ISO week containing `date`. */
export function startOfWeek(date: LocalDate): LocalDate {
  return addDays(date, -WEEKDAYS.indexOf(weekdayOf(date)));
}

export interface Interval {
  start: Minute;
  end: Minute;
}

/** Half-open overlap test: [a.start, a.end) ∩ [b.start, b.end) ≠ ∅. */
export function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}
