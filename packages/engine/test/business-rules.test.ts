/**
 * One test per business rule of the brief, against the real salon config.
 * Naming: "BR-xx" matches docs/traceability.md.
 */
import { describe, expect, it } from 'vitest';
import {
  availableStarts,
  buildBlocks,
  busyMinutes,
  checkPlacement,
  checkSelection,
  EMPTY_DAY,
  findService,
  formatHm,
  offDuty,
  offeredServices,
  totalMinutes,
  workHoursProblems,
  type WorkHours,
  type DayOccupancy,
  type Selection,
} from '../src/index.js';
import { cfg, NOW } from './fixture.js';

const MON = '2026-11-02';
const SAT = '2026-11-07';
const SUN = '2026-11-08';

const sel = (serviceId: string, extra: Partial<Selection> = {}): Selection => ({
  serviceId,
  audience: 'women',
  adult: true,
  ...extra,
});
const blocksOf = (s: Selection, start = 480) => buildBlocks(findService(cfg, s.serviceId)!, s, start);
const shape = (s: Selection) => blocksOf(s).map((b) => `${b.phase}:${b.kind}:${b.end - b.start}`);
const starts = (date: string, s: Selection, occ: DayOccupancy = EMPTY_DAY) =>
  availableStarts({ config: cfg, date, selection: s, now: NOW }, occ).map(formatHm);

describe('BR-01 opening hours', () => {
  it('Mon–Fri 08:00–17:00 with lunch break 12:00–13:00', () => {
    const s = starts(MON, sel('cut', { variant: 'dry' }));
    expect(s[0]).toBe('08:00');
    expect(s).toContain('11:30'); // 11:30–11:50 ends before break
    expect(s).not.toContain('11:45'); // 11:45–12:05 would touch break
    expect(s).not.toContain('12:00');
    expect(s).toContain('13:00');
    expect(s.at(-1)).toBe('16:30'); // 16:30–16:50; 16:45–17:05 is too late
  });
  it('Saturday 08:00–14:00 without break', () => {
    const s = starts(SAT, sel('cut', { variant: 'dry' }));
    expect(s).toContain('12:00');
    expect(s.at(-1)).toBe('13:30');
  });
  it('Sunday closed', () => {
    expect(starts(SUN, sel('cut'))).toEqual([]);
    expect(checkPlacement({ config: cfg, date: SUN, blocks: blocksOf(sel('cut')), occupancy: EMPTY_DAY, mode: 'staff' })).toEqual([
      { code: 'CLOSED' },
    ]);
  });
});

describe('BR-02 no block in the lunch break – not even Einwirkzeit', () => {
  it('rejects colour whose processing time would fall into the break', () => {
    // color_root: 10:45–11:30 work, 11:30–12:00 processing, 12:00–12:30 styling → styling in break
    const b = blocksOf(sel('color_root'), 645);
    const v = checkPlacement({ config: cfg, date: MON, blocks: b, occupancy: EMPTY_DAY, mode: 'staff' });
    expect(v).toContainEqual({ code: 'IN_BREAK', block: 2 });
    // 11:15: work 11:15–12:00, processing 12:00–12:30 → free block in break, also rejected
    const b2 = blocksOf(sel('color_root'), 675);
    expect(checkPlacement({ config: cfg, date: MON, blocks: b2, occupancy: EMPTY_DAY, mode: 'staff' })).toContainEqual({
      code: 'IN_BREAK',
      block: 1,
    });
  });
});

describe('BR-03 service durations', () => {
  it.each([
    // A-01: women 30′ dry / 45′ with wash; men 30′ either way
    [sel('cut', { variant: 'dry' }), ['cut:busy:30']],
    [sel('cut', { variant: 'wash' }), ['cut:busy:45']],
    [sel('cut'), ['cut:busy:45']],
    [sel('cut', { audience: 'men', variant: 'dry' }), ['cut:busy:30']],
    [sel('cut', { audience: 'men', variant: 'wash' }), ['cut:busy:30']],
    [sel('cut', { audience: 'men' }), ['cut:busy:30']],
    [sel('wash_set'), ['wash_set:busy:30']],
    [sel('color_root'), ['color_work:busy:45', 'processing:free:30', 'styling:busy:30']],
    [sel('color_root', { finish: true }), ['color_work:busy:45', 'processing:free:30', 'styling:busy:45']],
    [sel('color_full'), ['color_work:busy:60', 'processing:free:30', 'styling:busy:30']],
    [sel('color_full', { finish: true }), ['color_work:busy:60', 'processing:free:30', 'styling:busy:45']],
    // A-04: Oberkopf & Konturen 45′ / ganzer Kopf 60′ + 30′ cut
    [sel('highlights'), ['highlights_work:busy:60', 'processing:free:30', 'cut:busy:30', 'styling:busy:30']],
    [sel('highlights', { variant: 'partial' }), ['highlights_work:busy:45', 'processing:free:30', 'cut:busy:30', 'styling:busy:30']],
    [sel('highlights', { audience: 'men', variant: 'full', finish: true }), ['highlights_work:busy:60', 'processing:free:30', 'cut:busy:30', 'styling:busy:45']],
    [sel('perm', { audience: 'men' }), ['perm_cut:busy:30', 'perm_rollers:busy:30', 'perm_processing:busy:15', 'perm_rinse:busy:15', 'styling:busy:30']],
    [sel('balayage'), ['balayage:busy:240']],
    [
      sel('perm'),
      ['perm_cut:busy:30', 'perm_rollers:busy:30', 'perm_processing:busy:15', 'perm_rinse:busy:15', 'styling:busy:30'],
    ],
  ])('%o → %o', (s, expected) => {
    expect(shape(s)).toEqual(expected);
  });

  it('Dauerwelle is 120′ consecutive with no free time', () => {
    const b = blocksOf(sel('perm'));
    expect(totalMinutes(b)).toBe(120);
    expect(busyMinutes(b)).toBe(120);
  });

  it('Veredelung exists only on the colour chain', () => {
    expect(checkSelection(cfg, sel('cut', { finish: true }))).toBe('FINISH_NOT_AVAILABLE');
    expect(checkSelection(cfg, sel('perm', { finish: true }))).toBe('FINISH_NOT_AVAILABLE');
    expect(checkSelection(cfg, sel('balayage', { finish: true }))).toBe('FINISH_NOT_AVAILABLE');
    expect(checkSelection(cfg, sel('highlights', { finish: true }))).toBeNull();
  });

  it('Waschen & Legen only for women', () => {
    expect(checkSelection(cfg, sel('wash_set', { audience: 'men' }))).toBe('AUDIENCE_NOT_OFFERED');
  });
});

describe('BR-04 Einwirkzeit frees the stylist', () => {
  it('another client may be served during processing time', () => {
    // Colour 08:00: work 08:00–08:45, processing 08:45–09:15, styling 09:15–09:45
    const busy = blocksOf(sel('color_root')).filter((b) => b.kind === 'busy');
    const occ: DayOccupancy = { busy, absences: [] };
    const s = starts(MON, sel('cut', { variant: 'dry' }), occ);
    expect(s).toContain('08:45'); // 08:45–09:05 inside processing
    expect(s).not.toContain('08:30');
    expect(s).not.toContain('09:00'); // 09:00–09:20 overlaps styling
  });
  it("a new colour's processing may overlap another's busy block", () => {
    // existing cut 08:45–09:30 busy; new colour 08:00 → processing 08:45–09:15 overlaps it: allowed
    const occ: DayOccupancy = { busy: [{ start: 525, end: 555 }], absences: [] };
    expect(starts(MON, sel('color_root'), occ)).toContain('08:00');
  });
});

describe('BR-05 Balayage: 4 h, only 08:00 or 13:00, Saturday only morning', () => {
  it('weekday', () => expect(starts(MON, sel('balayage'))).toEqual(['08:00', '13:00']));
  it('saturday', () => expect(starts(SAT, sel('balayage'))).toEqual(['08:00']));
  it('rejects other starts for clients', () => {
    const v = checkPlacement({
      config: cfg,
      date: MON,
      blocks: blocksOf(sel('balayage'), 540),
      occupancy: EMPTY_DAY,
      mode: 'client',
      now: NOW,
      service: findService(cfg, 'balayage')!,
    });
    expect(v).toContainEqual({ code: 'NOT_ALLOWED_START' });
  });
});

describe('BR-06 minors', () => {
  it('only cut and Waschen & Legen are offered to minors', () => {
    expect(offeredServices(cfg, 'women', false).map((s) => s.id)).toEqual(['cut', 'wash_set', 'cut_senior', 'cut_kids']);
    expect(offeredServices(cfg, 'men', false).map((s) => s.id)).toEqual(['cut', 'cut_senior', 'cut_kids']);
  });
  it.each(['color_root', 'color_full', 'highlights', 'balayage', 'perm'])('%s rejected for minors', (id) => {
    expect(checkSelection(cfg, sel(id, { adult: false }))).toBe('AGE_RESTRICTED');
    expect(starts(MON, sel(id, { adult: false }))).toEqual([]);
  });
});

describe('BR-07 slot grid and lead time', () => {
  it('client slots are on a 15′ grid', () => {
    expect(starts(MON, sel('cut')).every((t) => Number(t.slice(3)) % 15 === 0)).toBe(true);
  });
  it('staff may use a 5′ grid, clients may not', () => {
    const b = blocksOf(sel('cut', { variant: 'dry' }), 485);
    expect(checkPlacement({ config: cfg, date: MON, blocks: b, occupancy: EMPTY_DAY, mode: 'staff' })).toEqual([]);
    expect(checkPlacement({ config: cfg, date: MON, blocks: b, occupancy: EMPTY_DAY, mode: 'client', now: NOW })).toContainEqual({
      code: 'OFF_GRID',
    });
  });
  it('same day: at least 30′ ahead, never in the past; horizon 364 days', () => {
    const now = { date: MON, minute: 9 * 60 + 10 };
    const s = availableStarts({ config: cfg, date: MON, selection: sel('cut', { variant: 'dry' }), now }, EMPTY_DAY).map(formatHm);
    expect(s[0]).toBe('09:45');
    expect(availableStarts({ config: cfg, date: '2026-11-01', selection: sel('cut'), now }, EMPTY_DAY)).toEqual([]);
    expect(availableStarts({ config: cfg, date: '2027-11-02', selection: sel('cut'), now }, EMPTY_DAY)).toEqual([]);
    expect(availableStarts({ config: cfg, date: '2027-10-30', selection: sel('cut'), now }, EMPTY_DAY).length).toBeGreaterThan(0);
  });
  it('client mode requires `now`', () => {
    expect(() =>
      checkPlacement({ config: cfg, date: MON, blocks: blocksOf(sel('cut')), occupancy: EMPTY_DAY, mode: 'client' }),
    ).toThrow();
  });
});

describe('BR-08 absences block the whole appointment', () => {
  it('free blocks may not overlap an absence', () => {
    const occ: DayOccupancy = { busy: [], absences: [{ start: 525, end: 540 }] };
    const v = checkPlacement({ config: cfg, date: MON, blocks: blocksOf(sel('color_root')), occupancy: occ, mode: 'staff' });
    expect(v).toContainEqual({ code: 'IN_ABSENCE', block: 1 });
  });
});

describe('structural checks', () => {
  it('rejects empty, gapped and inverted block lists', () => {
    const base = { config: cfg, date: MON, occupancy: EMPTY_DAY, mode: 'staff' as const };
    expect(checkPlacement({ ...base, blocks: [] })).toEqual([{ code: 'MALFORMED' }]);
    expect(
      checkPlacement({
        ...base,
        blocks: [
          { start: 480, end: 500, kind: 'busy', phase: 'a' },
          { start: 505, end: 520, kind: 'busy', phase: 'b' },
        ],
      }),
    ).toEqual([{ code: 'MALFORMED', block: 1 }]);
    expect(checkPlacement({ ...base, blocks: [{ start: 500, end: 480, kind: 'busy', phase: 'a' }] })).toEqual([
      { code: 'MALFORMED', block: 0 },
    ]);
  });
  it('flags phases shorter than the minimum in staff mode', () => {
    const v = checkPlacement({
      config: cfg,
      date: MON,
      occupancy: EMPTY_DAY,
      mode: 'staff',
      blocks: [{ start: 480, end: 482, kind: 'busy', phase: 'a' }],
    });
    expect(v.map((x) => x.code)).toEqual(expect.arrayContaining(['PHASE_TOO_SHORT', 'OFF_GRID']));
  });
  it('unknown services produce no slots', () => {
    expect(checkSelection(cfg, sel('nope'))).toBe('UNKNOWN_SERVICE');
    expect(checkSelection(cfg, sel('cut', { variant: 'xx' }))).toBe('INVALID_VARIANT');
    expect(starts(MON, sel('nope'))).toEqual([]);
  });
});

describe('BR-17 no unusable gaps for client requests (D-068)', () => {
  const cut30 = sel('cut', { variant: 'dry' }); // 30′
  const senior = sel('cut_senior'); // 20′
  const TUE = '2026-11-03';
  const place = (mode: 'client' | 'staff', start: number, config = cfg) =>
    checkPlacement({ config, date: TUE, blocks: blocksOf(senior, start), occupancy: EMPTY_DAY, mode, now: NOW, service: findService(cfg, 'cut_senior')! }).map((x) => x.code);

  it('rejects a request that leaves a 10′ hole after another appointment; 0′ and ≥ 15′ are fine', () => {
    const occ: DayOccupancy = { busy: [{ start: 600, end: 620 }], absences: [] }; // 10:00–10:20 placed by staff
    const s = starts(TUE, cut30, occ);
    expect(s).not.toContain('10:30'); // 10′ hole after 10:20
    expect(s).toContain('10:45'); // 25′ – usable
    expect(s).toContain('09:30'); // ends exactly at 10:00
    expect(s).toContain('09:15'); // leaves 09:45–10:00 = 15′: still usable
  });

  it('rejects a request ending 10′ before the lunch break; staff may still place it there', () => {
    expect(place('client', 690)).toContain('SMALL_GAP'); // 11:30–11:50, break at 12:00
    expect(place('client', 675)).toEqual([]); // 11:15–11:35 leaves 25′ before the break
    expect(place('staff', 690)).toEqual([]);
  });

  it('can be switched off (0)', () => {
    expect(place('client', 690, { ...cfg, minClientGapMinutes: 0 })).toEqual([]);
  });
});

describe('BR-18 personal working hours (D-071)', () => {
  const TUE = '2026-11-03'; // salon 08:00–17:00, break 12:00–13:00
  const work: WorkHours = { tue: { open: '09:00', close: '15:00', breaks: [] }, wed: null };
  it('time outside the personal hours is off duty; a day off blocks the whole salon day', () => {
    expect(offDuty(cfg, TUE, work)).toEqual([{ start: 480, end: 540 }, { start: 900, end: 1020 }]);
    expect(offDuty(cfg, '2026-11-04', work)).toEqual([{ start: 480, end: 1020 }]);
    expect(offDuty(cfg, '2026-11-05', work)).toEqual([]); // Thursday not set → salon hours
    expect(offDuty(cfg, TUE, null)).toEqual([]);
  });
  it('off duty counts like an absence: no client slots there', () => {
    const occ: DayOccupancy = { busy: [], absences: offDuty(cfg, TUE, work) };
    const s = starts(TUE, sel('cut', { variant: 'dry' }), occ);
    expect(s[0]).toBe('09:00');
    expect(s).not.toContain('14:45'); // would end 15:15
    expect(s.at(-1)).toBe('14:30');
  });
  it('plans must stay inside the opening hours', () => {
    expect(workHoursProblems(cfg, work)).toEqual([]);
    expect(workHoursProblems(cfg, { tue: { open: '07:00', close: '15:00', breaks: [] } })[0]).toMatch(/Öffnungszeiten/);
    expect(workHoursProblems(cfg, { sun: { open: '09:00', close: '12:00', breaks: [] } })[0]).toMatch(/geschlossen/);
    expect(workHoursProblems(cfg, { tue: { open: '10:00', close: '09:00', breaks: [] } })[0]).toMatch(/vor dem Ende/);
  });
});
