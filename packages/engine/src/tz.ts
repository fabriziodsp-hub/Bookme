/**
 * Conversion between salon wall time and UTC instants using the IANA database
 * shipped with the JS runtime (Intl). No third-party dependency.
 *
 * DST handling:
 * - A wall time that does not exist (spring forward gap) → `nonexistent`.
 * - A wall time that occurs twice (fall back overlap) → `ambiguous`.
 * The salon config validator rejects opening hours that would hit either case.
 */
import { addDays, parseLocalDate, type LocalDate, type Minute } from './time.js';

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

interface WallParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function wallParts(epochMs: number, timeZone: string): WallParts {
  const out: Record<string, number> = {};
  for (const p of formatter(timeZone).formatToParts(new Date(epochMs))) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return {
    year: out.year!,
    month: out.month!,
    day: out.day!,
    hour: out.hour!,
    minute: out.minute!,
    second: out.second!,
  };
}

/** UTC offset of `timeZone` at `epochMs`, in minutes (Berlin: +60 winter, +120 summer). */
export function offsetMinutes(epochMs: number, timeZone: string): number {
  const p = wallParts(epochMs, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const truncated = Math.floor(epochMs / 1000) * 1000;
  return Math.round((asUtc - truncated) / 60_000);
}

export type ZonedResult =
  | { ok: true; epochMs: number }
  | { ok: false; reason: 'nonexistent' | 'ambiguous'; candidates: number[] };

/** All instants whose wall time in `timeZone` equals (date, minute). */
export function wallTimeCandidates(date: LocalDate, minute: Minute, timeZone: string): number[] {
  const { year, month, day } = parseLocalDate(date);
  const naive = Date.UTC(year, month - 1, day, 0, minute);
  const offsets = new Set([
    offsetMinutes(naive - 14 * 3_600_000, timeZone),
    offsetMinutes(naive, timeZone),
    offsetMinutes(naive + 14 * 3_600_000, timeZone),
  ]);
  const found = new Set<number>();
  for (const off of offsets) {
    const t = naive - off * 60_000;
    if (offsetMinutes(t, timeZone) === off) found.add(t);
  }
  return [...found].sort((a, b) => a - b);
}

export function zonedToUtc(date: LocalDate, minute: Minute, timeZone: string): ZonedResult {
  const c = wallTimeCandidates(date, minute, timeZone);
  if (c.length === 1) return { ok: true, epochMs: c[0]! };
  return { ok: false, reason: c.length === 0 ? 'nonexistent' : 'ambiguous', candidates: c };
}

/** Strict conversion: throws on DST gaps/overlaps. Use for persisted appointment times. */
export function toInstant(date: LocalDate, minute: Minute, timeZone: string): Date {
  const r = zonedToUtc(date, minute, timeZone);
  if (!r.ok) throw new RangeError(`${date} ${minute}min is ${r.reason} in ${timeZone}`);
  return new Date(r.epochMs);
}

/** UTC instant → salon wall time. Minutes are floored. */
export function fromInstant(instant: Date | number, timeZone: string): { date: LocalDate; minute: Minute } {
  const p = wallParts(typeof instant === 'number' ? instant : instant.getTime(), timeZone);
  const date = `${String(p.year).padStart(4, '0')}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
  return { date, minute: p.hour * 60 + p.minute };
}

/**
 * Local dates in [from, from+days) on which the UTC offset changes, with the local
 * window [startMinute, endMinute) of wall times affected (gap or overlap).
 */
export function dstTransitions(
  from: LocalDate,
  days: number,
  timeZone: string,
): { date: LocalDate; startMinute: Minute; endMinute: Minute }[] {
  const out: { date: LocalDate; startMinute: Minute; endMinute: Minute }[] = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(from, i);
    const { year, month, day } = parseLocalDate(date);
    const dayStart = Date.UTC(year, month - 1, day) - 14 * 3_600_000;
    const before = offsetMinutes(dayStart, timeZone);
    const after = offsetMinutes(dayStart + 48 * 3_600_000, timeZone);
    if (before === after) continue;
    // Find the minutes of this local date that are not uniquely representable.
    let start = -1;
    let end = -1;
    for (let m = 0; m < 1440; m += 15) {
      if (wallTimeCandidates(date, m, timeZone).length !== 1) {
        if (start < 0) start = m;
        end = m + 15;
      }
    }
    if (start >= 0) out.push({ date, startMinute: start, endMinute: end });
  }
  return out;
}
