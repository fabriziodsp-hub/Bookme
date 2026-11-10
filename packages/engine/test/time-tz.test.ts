import fc from 'fast-check';
import { Temporal } from 'temporal-polyfill';
import { describe, expect, it } from 'vitest';
import {
  addDays,
  daysBetween,
  dstTransitions,
  formatHm,
  fromInstant,
  isLocalDate,
  offsetMinutes,
  parseHm,
  startOfWeek,
  toInstant,
  weekdayOf,
  zonedToUtc,
} from '../src/index.js';
import { arbDate } from './fixture.js';

const TZ = 'Europe/Berlin';

describe('time primitives', () => {
  it('parses and formats HH:MM', () => {
    expect(parseHm('08:00')).toBe(480);
    expect(parseHm('23:59')).toBe(1439);
    expect(formatHm(1020)).toBe('17:00');
    expect(formatHm(1440)).toBe('24:00');
    expect(() => parseHm('8:00')).toThrow();
    expect(() => parseHm('24:00')).toThrow();
    expect(() => formatHm(-1)).toThrow();
    expect(() => formatHm(1.5)).toThrow();
  });

  it('validates local dates', () => {
    expect(isLocalDate('2026-02-28')).toBe(true);
    expect(isLocalDate('2026-02-29')).toBe(false);
    expect(isLocalDate('2028-02-29')).toBe(true);
    expect(isLocalDate('2026-13-01')).toBe(false);
    expect(isLocalDate('26-01-01')).toBe(false);
    expect(() => addDays('2026-02-30', 1)).toThrow();
  });

  it('computes weekdays independent of host time zone', () => {
    expect(weekdayOf('2026-10-27')).toBe('tue');
    expect(weekdayOf('2026-11-01')).toBe('sun');
    expect(weekdayOf('2026-10-31')).toBe('sat');
    expect(startOfWeek('2026-11-01')).toBe('2026-10-26');
    expect(startOfWeek('2026-10-26')).toBe('2026-10-26');
  });

  it('addDays/daysBetween are inverse (property)', () => {
    fc.assert(
      fc.property(arbDate, fc.integer({ min: -800, max: 800 }), (d, n) => {
        expect(daysBetween(d, addDays(d, n))).toBe(n);
      }),
    );
  });
});

describe('time zone conversion (Europe/Berlin)', () => {
  it('knows winter and summer offsets', () => {
    expect(offsetMinutes(Date.UTC(2026, 0, 15, 12), TZ)).toBe(60);
    expect(offsetMinutes(Date.UTC(2026, 6, 15, 12), TZ)).toBe(120);
  });

  it('detects the spring gap and the autumn overlap', () => {
    // 2026-03-29: 02:00 → 03:00 ; 2026-10-25: 03:00 → 02:00
    expect(zonedToUtc('2026-03-29', 2 * 60 + 30, TZ)).toMatchObject({ ok: false, reason: 'nonexistent' });
    expect(zonedToUtc('2026-10-25', 2 * 60 + 30, TZ)).toMatchObject({ ok: false, reason: 'ambiguous' });
    expect(() => toInstant('2026-03-29', 150, TZ)).toThrow(/nonexistent/);
    expect(dstTransitions('2026-01-01', 365, TZ).map((t) => t.date)).toEqual(['2026-03-29', '2026-10-25']);
  });

  it('opening hours on the Monday after a switch map to the right UTC instants', () => {
    expect(toInstant('2026-03-30', 480, TZ).toISOString()).toBe('2026-03-30T06:00:00.000Z');
    expect(toInstant('2026-10-26', 480, TZ).toISOString()).toBe('2026-10-26T07:00:00.000Z');
  });

  it('agrees with the Temporal reference implementation for every opening-hour minute (property)', () => {
    fc.assert(
      fc.property(arbDate, fc.integer({ min: 0, max: 1439 }), (date, minute) => {
        const r = zonedToUtc(date, minute, TZ);
        const pdt = Temporal.PlainDateTime.from(`${date}T${formatHm(minute)}`);
        const earlier = pdt.toZonedDateTime(TZ, { disambiguation: 'earlier' });
        const back = earlier.toPlainDateTime();
        const exists = Temporal.PlainDateTime.compare(back, pdt) === 0;
        if (!exists) {
          expect(r).toMatchObject({ ok: false, reason: 'nonexistent' });
          return;
        }
        const later = pdt.toZonedDateTime(TZ, { disambiguation: 'later' });
        if (earlier.epochMilliseconds !== later.epochMilliseconds) {
          expect(r).toMatchObject({ ok: false, reason: 'ambiguous' });
          return;
        }
        expect(r).toEqual({ ok: true, epochMs: earlier.epochMilliseconds });
        expect(fromInstant(earlier.epochMilliseconds, TZ)).toEqual({ date, minute });
      }),
      { numRuns: 2000 },
    );
  });

  it('round-trips instants → wall time → instants outside DST overlaps (property)', () => {
    fc.assert(
      fc.property(fc.integer({ min: Date.UTC(2026, 0, 1), max: Date.UTC(2036, 0, 1) }), (ms) => {
        const t = Math.floor(ms / 60_000) * 60_000;
        const { date, minute } = fromInstant(t, TZ);
        const r = zonedToUtc(date, minute, TZ);
        if (r.ok) expect(r.epochMs).toBe(t);
        else expect(r.candidates).toContain(t);
      }),
      { numRuns: 2000 },
    );
  });
});
