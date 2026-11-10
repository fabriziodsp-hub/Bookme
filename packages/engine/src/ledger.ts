/**
 * In-memory booking ledger: a pure reducer over commands. It is the reference
 * model of what the database must guarantee, and is used by property tests and
 * the demo seed. Commands carry an id, so re-applying the same command is a no-op
 * (idempotency).
 */
import type { SalonConfig } from './config.js';
import { checkPlacement, type DayOccupancy, type Now, type Violation } from './rules.js';
import { buildBlocks, checkSelection, type Block, type Selection, type SelectionViolation } from './services.js';
import type { Interval, LocalDate, Minute } from './time.js';

export interface Booking {
  id: string;
  stylistId: string;
  date: LocalDate;
  selection: Selection;
  blocks: Block[];
}

export interface Absence {
  id: string;
  stylistId: string;
  date: LocalDate;
  interval: Interval;
}

export interface LedgerState {
  readonly bookings: ReadonlyMap<string, Booking>;
  readonly absences: ReadonlyMap<string, Absence>;
}

export const emptyLedger = (): LedgerState => ({ bookings: new Map(), absences: new Map() });

export type Command =
  | { type: 'book'; id: string; stylistId: string; date: LocalDate; start: Minute; selection: Selection; mode: 'client' | 'staff'; now?: Now }
  | { type: 'reschedule'; id: string; date: LocalDate; blocks: Block[] }
  | { type: 'cancel'; id: string }
  | { type: 'absence'; id: string; stylistId: string; date: LocalDate; interval: Interval };

export type Outcome =
  | { ok: true; changed: boolean }
  | { ok: false; selection?: SelectionViolation; violations?: Violation[]; reason?: 'NOT_FOUND' | 'ID_CONFLICT' };

export function occupancyOf(
  state: LedgerState,
  stylistId: string,
  date: LocalDate,
  excludeBookingId?: string,
): DayOccupancy {
  const busy: Interval[] = [];
  for (const b of state.bookings.values()) {
    if (b.stylistId !== stylistId || b.date !== date || b.id === excludeBookingId) continue;
    for (const blk of b.blocks) if (blk.kind === 'busy') busy.push({ start: blk.start, end: blk.end });
  }
  const absences: Interval[] = [];
  for (const a of state.absences.values()) {
    if (a.stylistId === stylistId && a.date === date) absences.push(a.interval);
  }
  return { busy, absences };
}

const sameBlocks = (a: Block[], b: Block[]) =>
  a.length === b.length && a.every((x, i) => x.start === b[i]!.start && x.end === b[i]!.end && x.kind === b[i]!.kind && x.phase === b[i]!.phase);

export function apply(cfg: SalonConfig, state: LedgerState, cmd: Command): { state: LedgerState; outcome: Outcome } {
  const unchanged = (outcome: Outcome) => ({ state, outcome });

  switch (cmd.type) {
    case 'book': {
      const service = cfg.services.find((s) => s.id === cmd.selection.serviceId);
      const selErr = checkSelection(cfg, cmd.selection);
      if (selErr || !service) return unchanged({ ok: false, selection: selErr ?? 'UNKNOWN_SERVICE' });
      const blocks = buildBlocks(service, cmd.selection, cmd.start);
      const existing = state.bookings.get(cmd.id);
      if (existing) {
        const same = existing.date === cmd.date && existing.stylistId === cmd.stylistId && sameBlocks(existing.blocks, blocks);
        return unchanged(same ? { ok: true, changed: false } : { ok: false, reason: 'ID_CONFLICT' });
      }
      const violations = checkPlacement({
        config: cfg,
        date: cmd.date,
        blocks,
        occupancy: occupancyOf(state, cmd.stylistId, cmd.date),
        mode: cmd.mode,
        ...(cmd.now ? { now: cmd.now } : {}),
        service,
      });
      if (violations.length) return unchanged({ ok: false, violations });
      const bookings = new Map(state.bookings);
      bookings.set(cmd.id, { id: cmd.id, stylistId: cmd.stylistId, date: cmd.date, selection: cmd.selection, blocks });
      return { state: { ...state, bookings }, outcome: { ok: true, changed: true } };
    }
    case 'reschedule': {
      const b = state.bookings.get(cmd.id);
      if (!b) return unchanged({ ok: false, reason: 'NOT_FOUND' });
      if (b.date === cmd.date && sameBlocks(b.blocks, cmd.blocks)) return unchanged({ ok: true, changed: false });
      const violations = checkPlacement({
        config: cfg,
        date: cmd.date,
        blocks: cmd.blocks,
        occupancy: occupancyOf(state, b.stylistId, cmd.date, b.id),
        mode: 'staff',
      });
      if (violations.length) return unchanged({ ok: false, violations });
      const bookings = new Map(state.bookings);
      bookings.set(b.id, { ...b, date: cmd.date, blocks: cmd.blocks.map((x) => ({ ...x })) });
      return { state: { ...state, bookings }, outcome: { ok: true, changed: true } };
    }
    case 'cancel': {
      if (!state.bookings.has(cmd.id)) return unchanged({ ok: true, changed: false });
      const bookings = new Map(state.bookings);
      bookings.delete(cmd.id);
      return { state: { ...state, bookings }, outcome: { ok: true, changed: true } };
    }
    case 'absence': {
      if (state.absences.has(cmd.id)) return unchanged({ ok: true, changed: false });
      // An absence may not cover any block (busy or free) of an existing booking (A-13).
      const clash = [...state.bookings.values()].some(
        (b) =>
          b.stylistId === cmd.stylistId &&
          b.date === cmd.date &&
          b.blocks.some((x) => x.start < cmd.interval.end && cmd.interval.start < x.end),
      );
      if (clash) return unchanged({ ok: false, violations: [{ code: 'IN_ABSENCE' }] });
      const absences = new Map(state.absences);
      absences.set(cmd.id, { id: cmd.id, stylistId: cmd.stylistId, date: cmd.date, interval: cmd.interval });
      return { state: { ...state, absences }, outcome: { ok: true, changed: true } };
    }
  }
}
