/**
 * Property-based tests (fast-check). Each property states an invariant that must
 * hold for ALL generated inputs, not just hand-picked examples.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  apply,
  availableStarts,
  availableStartsMulti,
  buildBlocks,
  checkPlacement,
  checkSelection,
  emptyLedger,
  findService,
  hoursOn,
  moveTo,
  nextAvailableDate,
  occupancyOf,
  offeredServices,
  resizePhase,
  shiftBlocks,
  snap,
  toInstant,
  totalMinutes,
  type Command,
  type DayOccupancy,
  type LedgerState,
} from '../src/index.js';
import { arbDate, arbSelection, cfg, NOW, TODAY } from './fixture.js';

const STYLISTS = ['s1', 's2', 's3'];

/** Random command stream: bookings at random (valid or invalid) times, reschedules, cancels, absences. */
const arbCommands = fc.array(
  fc.oneof(
    { weight: 6, arbitrary: fc.record({
      type: fc.constant('book' as const),
      id: fc.integer({ min: 1, max: 40 }).map(String),
      stylistId: fc.constantFrom(...STYLISTS),
      date: fc.integer({ min: 0, max: 13 }).map((n) => new Date(Date.UTC(2026, 10, 2) + n * 864e5).toISOString().slice(0, 10)),
      start: fc.integer({ min: 0, max: 130 }).map((n) => 420 + n * 5),
      selection: arbSelection(),
      mode: fc.constantFrom('client' as const, 'staff' as const),
      now: fc.constant(NOW),
    }) },
    { weight: 2, arbitrary: fc.record({ type: fc.constant('cancel' as const), id: fc.integer({ min: 1, max: 40 }).map(String) }) },
    { weight: 1, arbitrary: fc.record({
      type: fc.constant('absence' as const),
      id: fc.integer({ min: 1, max: 10 }).map((n) => `a${n}`),
      stylistId: fc.constantFrom(...STYLISTS),
      date: fc.constant('2026-11-03'),
      interval: fc.integer({ min: 96, max: 200 }).map((n) => ({ start: n * 5, end: n * 5 + 60 })),
    }) },
  ),
  { maxLength: 60 },
);

function run(cmds: Command[]): LedgerState {
  return cmds.reduce((s, c) => apply(cfg, s, c).state, emptyLedger());
}

describe('scheduling invariants', () => {
  it('P1: busy blocks of one stylist never overlap, whatever commands arrive', () => {
    fc.assert(
      fc.property(arbCommands, (cmds) => {
        const state = run(cmds);
        const all = [...state.bookings.values()];
        for (const a of all) for (const b of all) {
          if (a.id >= b.id || a.stylistId !== b.stylistId || a.date !== b.date) continue;
          for (const x of a.blocks) for (const y of b.blocks) {
            if (x.kind === 'busy' && y.kind === 'busy') expect(x.start < y.end && y.start < x.end).toBe(false);
          }
        }
      }),
      { numRuns: 400 },
    );
  });

  it('P2: no stored block lies outside opening hours, in the break, on Sunday, or in an absence', () => {
    fc.assert(
      fc.property(arbCommands, (cmds) => {
        const state = run(cmds);
        for (const b of state.bookings.values()) {
          const h = hoursOn(cfg, b.date);
          expect(h).not.toBeNull();
          for (const blk of b.blocks) {
            expect(blk.start).toBeGreaterThanOrEqual(h!.open);
            expect(blk.end).toBeLessThanOrEqual(h!.close);
            for (const br of h!.breaks) expect(blk.start < br.end && br.start < blk.end).toBe(false);
            for (const a of occupancyOf(state, b.stylistId, b.date).absences) {
              expect(blk.start < a.end && a.start < blk.end).toBe(false);
            }
          }
        }
      }),
      { numRuns: 400 },
    );
  });

  it('P3: minors are never booked into a restricted service', () => {
    fc.assert(
      fc.property(arbCommands, (cmds) => {
        const state = run(cmds);
        for (const b of state.bookings.values()) {
          if (!b.selection.adult) expect(findService(cfg, b.selection.serviceId)!.adultOnly).toBe(false);
        }
      }),
    );
    fc.assert(
      fc.property(fc.constantFrom('women' as const, 'men' as const), (aud) => {
        expect(offeredServices(cfg, aud, false).every((s) => !s.adultOnly)).toBe(true);
      }),
    );
  });

  it('P4: idempotency — applying any command twice equals applying it once', () => {
    fc.assert(
      fc.property(arbCommands, (cmds) => {
        let once = emptyLedger();
        let twice = emptyLedger();
        for (const c of cmds) {
          once = apply(cfg, once, c).state;
          twice = apply(cfg, apply(cfg, twice, c).state, c).state;
        }
        expect([...twice.bookings.entries()]).toEqual([...once.bookings.entries()]);
        expect([...twice.absences.entries()]).toEqual([...once.absences.entries()]);
      }),
      { numRuns: 300 },
    );
  });

  it('P5: slot search is sound and complete w.r.t. checkPlacement', () => {
    fc.assert(
      fc.property(arbDate, arbSelection(), fc.array(fc.integer({ min: 96, max: 200 }), { maxLength: 6 }), (date, sel, busyStarts) => {
        const occ: DayOccupancy = { busy: busyStarts.map((n) => ({ start: n * 5, end: n * 5 + 30 })), absences: [] };
        const now = { date: TODAY, minute: 0 };
        const service = findService(cfg, sel.serviceId)!;
        const got = availableStarts({ config: cfg, date, selection: sel, now }, occ);
        const h = hoursOn(cfg, date);
        const expected: number[] = [];
        if (h) for (let t = h.open; t < h.close; t += cfg.slotStepMinutes) {
          const v = checkPlacement({ config: cfg, date, blocks: buildBlocks(service, sel, t), occupancy: occ, mode: 'client', now, service });
          if (!v.length) expected.push(t);
        }
        expect(got).toEqual(expected);
      }),
      { numRuns: 500 },
    );
  });

  it('P6: DST consistency — every valid slot maps to a unique instant and keeps its duration', () => {
    fc.assert(
      fc.property(arbDate, arbSelection(), (date, sel) => {
        const now = { date: '2026-01-01', minute: 0 };
        const c = { ...cfg, horizonDays: 4000 };
        const service = findService(cfg, sel.serviceId)!;
        for (const t of availableStarts({ config: c, date, selection: sel, now }, { busy: [], absences: [] })) {
          const blocks = buildBlocks(service, sel, t);
          const a = toInstant(date, blocks[0]!.start, cfg.timeZone).getTime();
          const b = toInstant(date, blocks.at(-1)!.end, cfg.timeZone).getTime();
          expect((b - a) / 60_000).toBe(totalMinutes(blocks));
        }
      }),
      { numRuns: 300 },
    );
  });

  it('P7: multi-stylist slots are the union of per-stylist slots', () => {
    fc.assert(
      fc.property(arbCommands, arbSelection(), (cmds, sel) => {
        const state = run(cmds);
        const date = '2026-11-03';
        const q = { config: cfg, date, selection: sel, now: NOW };
        const occ = new Map(STYLISTS.map((s) => [s, occupancyOf(state, s, date)]));
        const multi = availableStartsMulti(q, occ);
        for (const s of STYLISTS) {
          const own = availableStarts(q, occ.get(s)!);
          for (const t of own) expect(multi.find((m) => m.start === t)?.stylistIds).toContain(s);
        }
        expect(multi.map((m) => m.start)).toEqual([...multi.map((m) => m.start)].sort((a, b) => a - b));
      }),
      { numRuns: 200 },
    );
  });

  it('P8: staff edits — shift is invertible, resize keeps contiguity and changes total by delta', () => {
    fc.assert(
      fc.property(arbSelection(), fc.integer({ min: -60, max: 60 }), fc.nat(), (sel, d, idx) => {
        const s = findService(cfg, sel.serviceId)!;
        const blocks = buildBlocks(s, sel, 600);
        expect(shiftBlocks(shiftBlocks(blocks, d), -d)).toEqual(blocks);
        expect(moveTo(blocks, 700)[0]!.start).toBe(700);
        const i = idx % blocks.length;
        const r = resizePhase(blocks, i, d, cfg.minPhaseMinutes);
        if (blocks[i]!.end - blocks[i]!.start + d < cfg.minPhaseMinutes) expect(r).toBeNull();
        else {
          expect(totalMinutes(r!)).toBe(totalMinutes(blocks) + d);
          r!.forEach((b, j) => j && expect(b.start).toBe(r![j - 1]!.end));
        }
        expect(Math.abs(snap(d * 1.3, 5)) % 5).toBe(0);
      }),
    );
  });

  it('P9: slot search is deterministic', () => {
    fc.assert(
      fc.property(arbDate, arbSelection(), (date, sel) => {
        const q = { config: cfg, date, selection: sel, now: NOW };
        expect(availableStarts(q, { busy: [], absences: [] })).toEqual(availableStarts(q, { busy: [], absences: [] }));
      }),
    );
  });
});

describe('ledger edge cases', () => {
  const book = (id: string, start: number, extra: Partial<Command & { type: 'book' }> = {}): Command => ({
    type: 'book', id, stylistId: 's1', date: '2026-11-03', start, mode: 'staff',
    selection: { serviceId: 'cut', audience: 'men', adult: true, variant: 'dry' }, ...extra,
  } as Command);

  it('rejects reuse of an id with different content', () => {
    const s = apply(cfg, emptyLedger(), book('1', 480)).state;
    expect(apply(cfg, s, book('1', 600)).outcome).toEqual({ ok: false, reason: 'ID_CONFLICT' });
  });
  it('rejects invalid selections', () => {
    const r = apply(cfg, emptyLedger(), book('1', 480, { selection: { serviceId: 'perm', audience: 'women', adult: false } }));
    expect(r.outcome).toMatchObject({ ok: false, selection: 'AGE_RESTRICTED' });
  });
  it('reschedules with validation and ignores itself as a conflict', () => {
    let s = apply(cfg, emptyLedger(), book('1', 480)).state;
    s = apply(cfg, s, book('2', 600)).state;
    const b1 = s.bookings.get('1')!;
    expect(apply(cfg, s, { type: 'reschedule', id: '1', date: b1.date, blocks: shiftBlocks(b1.blocks, 10) }).outcome).toEqual({ ok: true, changed: true });
    expect(apply(cfg, s, { type: 'reschedule', id: '1', date: b1.date, blocks: b1.blocks }).outcome).toEqual({ ok: true, changed: false });
    expect(apply(cfg, s, { type: 'reschedule', id: '1', date: b1.date, blocks: moveTo(b1.blocks, 605) }).outcome).toMatchObject({ ok: false });
    expect(apply(cfg, s, { type: 'reschedule', id: '9', date: b1.date, blocks: b1.blocks }).outcome).toEqual({ ok: false, reason: 'NOT_FOUND' });
  });
  it('rejects an absence over an existing booking', () => {
    const s = apply(cfg, emptyLedger(), book('1', 480)).state;
    const r = apply(cfg, s, { type: 'absence', id: 'a', stylistId: 's1', date: '2026-11-03', interval: { start: 490, end: 600 } });
    expect(r.outcome).toMatchObject({ ok: false });
  });
  it('finds the next available date', () => {
    const r = nextAvailableDate(
      { config: cfg, fromDate: '2026-11-01', selection: { serviceId: 'balayage', audience: 'women', adult: true }, now: NOW },
      () => new Map([['s1', { busy: [], absences: [] }]]),
    );
    expect(r).toEqual({ date: '2026-11-02', start: 480 });
    const none = nextAvailableDate(
      { config: { ...cfg, horizonDays: 3 }, fromDate: TODAY, selection: { serviceId: 'cut', audience: 'men', adult: true }, now: NOW },
      () => new Map([['s1', { busy: [{ start: 0, end: 1440 }], absences: [] }]]),
    );
    expect(none).toBeNull();
    expect(checkSelection(cfg, { serviceId: 'cut', audience: 'men', adult: true })).toBeNull();
  });
});
