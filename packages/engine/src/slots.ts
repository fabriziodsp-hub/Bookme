/** Slot search for clients. */
import type { SalonConfig } from './config.js';
import { checkPlacement, hoursOn, type DayOccupancy, type Now } from './rules.js';
import { buildBlocks, checkSelection, type Selection } from './services.js';
import { addDays, daysBetween, type LocalDate, type Minute } from './time.js';

export interface SlotQuery {
  config: SalonConfig;
  date: LocalDate;
  selection: Selection;
  now: Now;
}

/** Valid client start minutes for one stylist on one day, ascending. */
export function availableStarts(q: SlotQuery, occupancy: DayOccupancy): Minute[] {
  const { config: cfg, date, selection, now } = q;
  if (checkSelection(cfg, selection)) return [];
  const hours = hoursOn(cfg, date);
  if (!hours) return [];
  const service = cfg.services.find((s) => s.id === selection.serviceId)!;
  const out: Minute[] = [];
  for (let t = hours.open; t < hours.close; t += cfg.slotStepMinutes) {
    const blocks = buildBlocks(service, selection, t);
    if (blocks.at(-1)!.end > hours.close) break; // later starts only end later
    const v = checkPlacement({ config: cfg, date, blocks, occupancy, mode: 'client', now, service });
    if (v.length === 0) out.push(t);
  }
  return out;
}

export interface MultiSlot {
  start: Minute;
  /** Stylists who can take this slot, in the order given. */
  stylistIds: string[];
}

/** Slots across N stylists. A slot is listed when at least one stylist is available. */
export function availableStartsMulti(
  q: SlotQuery,
  occupancyByStylist: ReadonlyMap<string, DayOccupancy>,
): MultiSlot[] {
  const byStart = new Map<Minute, string[]>();
  for (const [id, occ] of occupancyByStylist) {
    for (const t of availableStarts(q, occ)) {
      const list = byStart.get(t) ?? [];
      list.push(id);
      byStart.set(t, list);
    }
  }
  return [...byStart.entries()]
    .sort(([a], [b]) => a - b)
    .map(([start, stylistIds]) => ({ start, stylistIds }));
}

/**
 * First date ≥ fromDate (within the horizon) with at least one slot.
 * `occupancyFor` lets the caller load data lazily per date.
 */
export function nextAvailableDate(
  q: Omit<SlotQuery, 'date'> & { fromDate: LocalDate },
  occupancyFor: (date: LocalDate) => ReadonlyMap<string, DayOccupancy>,
): { date: LocalDate; start: Minute } | null {
  const last = q.config.horizonDays;
  const startOffset = Math.max(0, daysBetween(q.now.date, q.fromDate));
  for (let i = startOffset; i <= last; i++) {
    const date = addDays(q.now.date, i);
    const slots = availableStartsMulti({ ...q, date }, occupancyFor(date));
    if (slots.length) return { date, start: slots[0]!.start };
  }
  return null;
}
