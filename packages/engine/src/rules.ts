/** Placement rules: may these blocks be placed on this day for this stylist? */
import type { SalonConfig, Service } from './config.js';
import type { Block } from './services.js';
import {
  addDays,
  daysBetween,
  overlaps,
  parseHm,
  weekdayOf,
  type Interval,
  type LocalDate,
  type Minute,
} from './time.js';

/** What is already in a stylist's day, in local minutes. */
export interface DayOccupancy {
  /** Busy blocks of other appointments. Free blocks never conflict. */
  busy: readonly Interval[];
  /** Absences (vacation, sick, …). Block the whole appointment incl. free blocks (A-13). */
  absences: readonly Interval[];
}

export const EMPTY_DAY: DayOccupancy = { busy: [], absences: [] };

export type ViolationCode =
  | 'CLOSED'
  | 'OUTSIDE_HOURS'
  | 'IN_BREAK'
  | 'OVERLAPS_BUSY'
  | 'IN_ABSENCE'
  | 'OFF_GRID'
  | 'NOT_ALLOWED_START'
  | 'IN_PAST'
  | 'LEAD_TIME'
  | 'BEYOND_HORIZON'
  | 'PHASE_TOO_SHORT'
  | 'SMALL_GAP'
  | 'MALFORMED';

export interface Violation {
  code: ViolationCode;
  /** Index of the offending block, if specific to one. */
  block?: number;
}

export interface Now {
  date: LocalDate;
  minute: Minute;
}

export interface PlacementInput {
  config: SalonConfig;
  date: LocalDate;
  blocks: readonly Block[];
  occupancy: DayOccupancy;
  /** client: 15′ grid, lead time, horizon, fixed starts. staff: 5′ grid, may correct the past. */
  mode: 'client' | 'staff';
  /** Required in client mode. */
  now?: Now;
  /** Needed for fixed-start rules (Balayage). */
  service?: Service;
}

export interface DayHours {
  open: Minute;
  close: Minute;
  breaks: Interval[];
}

export function hoursOn(cfg: SalonConfig, date: LocalDate): DayHours | null {
  const h = cfg.weeklyHours[weekdayOf(date)];
  if (!h) return null;
  return {
    open: parseHm(h.open),
    close: parseHm(h.close),
    breaks: h.breaks.map(([s, e]) => ({ start: parseHm(s), end: parseHm(e) })),
  };
}

/** Allowed client start minutes for a fixed-start service on that day, or null if unrestricted. */
export function fixedStartsOn(service: Service | undefined): Minute[] | null {
  return service?.fixedStarts ? service.fixedStarts.map(parseHm) : null;
}

/**
 * Returns all rule violations; empty array = placement allowed.
 * Pure and deterministic: same input → same output.
 */
export function checkPlacement(input: PlacementInput): Violation[] {
  const { config: cfg, date, blocks, occupancy, mode } = input;
  const v: Violation[] = [];
  if (blocks.length === 0) return [{ code: 'MALFORMED' }];

  // Structural: ordered, contiguous, non-empty phases.
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]!;
    if (!Number.isInteger(b.start) || !Number.isInteger(b.end) || b.end <= b.start) {
      return [{ code: 'MALFORMED', block: i }];
    }
    if (i > 0 && blocks[i - 1]!.end !== b.start) return [{ code: 'MALFORMED', block: i }];
    if (mode === 'staff' && b.end - b.start < cfg.minPhaseMinutes) {
      v.push({ code: 'PHASE_TOO_SHORT', block: i });
    }
  }

  const hours = hoursOn(cfg, date);
  if (!hours) return [{ code: 'CLOSED' }];

  const first = blocks[0]!.start;
  const step = mode === 'client' ? cfg.slotStepMinutes : cfg.staffStepMinutes;
  if ((first - hours.open) % step !== 0) v.push({ code: 'OFF_GRID' });
  if (mode === 'staff' && blocks.some((b) => b.start % cfg.staffStepMinutes || b.end % cfg.staffStepMinutes)) {
    v.push({ code: 'OFF_GRID' });
  }

  const enforceFixed = mode === 'client' || cfg.enforceFixedStartsForStaff;
  const fixed = fixedStartsOn(input.service);
  if (enforceFixed && fixed && !fixed.includes(first)) v.push({ code: 'NOT_ALLOWED_START' });

  blocks.forEach((b, i) => {
    if (b.start < hours.open || b.end > hours.close) v.push({ code: 'OUTSIDE_HOURS', block: i });
    // No block – not even Einwirkzeit – may touch the break.
    if (hours.breaks.some((br) => overlaps(b, br))) v.push({ code: 'IN_BREAK', block: i });
    if (occupancy.absences.some((a) => overlaps(b, a))) v.push({ code: 'IN_ABSENCE', block: i });
    if (b.kind === 'busy' && occupancy.busy.some((o) => overlaps(b, o))) {
      v.push({ code: 'OVERLAPS_BUSY', block: i });
    }
  });

  if (mode === 'client') {
    const now = input.now;
    if (!now) throw new Error('checkPlacement: `now` is required in client mode');
    const ahead = daysBetween(now.date, date);
    if (ahead < 0 || (ahead === 0 && first < now.minute)) v.push({ code: 'IN_PAST' });
    else if (ahead === 0 && first < now.minute + cfg.leadTimeMinutes) v.push({ code: 'LEAD_TIME' });
    if (ahead > cfg.horizonDays) v.push({ code: 'BEYOND_HORIZON' });
    // BR-17 (D-068): no unusable hole next to the request. Walls are opening/closing, breaks,
    // absences and busy time of other appointments (their Einwirkzeit is usable, so not a wall).
    const minGap = cfg.minClientGapMinutes;
    if (minGap > 0 && !v.length) {
      const last = blocks[blocks.length - 1]!.end;
      const walls = [...hours.breaks, ...occupancy.absences, ...occupancy.busy];
      const left = Math.max(hours.open, ...walls.filter((w) => w.end <= first).map((w) => w.end));
      const right = Math.min(hours.close, ...walls.filter((w) => w.start >= last).map((w) => w.start));
      const gapBefore = first - left;
      const gapAfter = right - last;
      // A hole that already lies in the past (today) cannot be filled anyway.
      const leftMatters = !(ahead === 0 && left < now.minute + cfg.leadTimeMinutes);
      if ((leftMatters && gapBefore > 0 && gapBefore < minGap) || (gapAfter > 0 && gapAfter < minGap)) v.push({ code: 'SMALL_GAP' });
    }
  }
  return v;
}

/** Last date a client may book, relative to today. */
export function horizonEnd(cfg: SalonConfig, today: LocalDate): LocalDate {
  return addDays(today, cfg.horizonDays);
}
