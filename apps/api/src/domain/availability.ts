import {
  addDays,
  availableStartsMulti,
  checkSelection,
  daysBetween,
  hoursOn,
  type Interval,
  type LocalDate,
  type Minute,
  type Selection,
} from '@salon/engine';
import { salonNow } from '../clock.js';
import type { Queryable } from '../db/pool.js';
import { activeStylists } from './appointments.js';
import type { Ctx } from './context.js';
import { Errors } from './errors.js';
import { loadOccupancy } from './occupancy.js';

export interface DayAvailability {
  date: LocalDate;
  open: boolean;
  hours: { open: Minute; close: Minute; breaks: Interval[] } | null;
  slots: { start: Minute; stylistIds: string[] }[];
  /** Anonymous busy time ("belegt") – only when one stylist works (A-10). */
  busy: Interval[];
}

function assertSelection(ctx: Ctx, sel: Selection) {
  const e = checkSelection(ctx.cfg, sel);
  if (e === 'AGE_RESTRICTED') throw Errors.ageRestricted();
  if (e) throw Errors.invalidSelection(e);
}

export async function availability(
  q: Queryable,
  ctx: Ctx,
  sel: Selection | null,
  from: LocalDate,
  days: number,
  opts: { stylistId?: string; excludeAppointmentId?: string } = {},
): Promise<DayAvailability[]> {
  if (sel) assertSelection(ctx, sel);
  const stylists = (await activeStylists(q, ctx.tenantId)).filter((s) => !opts.stylistId || s.id === opts.stylistId);
  const ids = stylists.map((s) => s.id);
  const occ = await loadOccupancy(q, ctx, ids, from, days, opts.excludeAppointmentId);
  const now = salonNow(ctx.clock, ctx.cfg.timeZone);
  const out: DayAvailability[] = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(from, i);
    const hours = hoursOn(ctx.cfg, date);
    const byStylist = occ.get(date)!;
    const slots = sel && hours ? availableStartsMulti({ config: ctx.cfg, date, selection: sel, now }, byStylist) : [];
    const single = ids.length === 1 ? byStylist.get(ids[0]!)! : null;
    out.push({
      date,
      open: !!hours,
      hours,
      slots,
      busy: single ? mergeIntervals([...single.busy, ...single.absences]) : [],
    });
  }
  return out;
}

export function mergeIntervals(list: Interval[]): Interval[] {
  const s = [...list].sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const i of s) {
    const last = out.at(-1);
    if (last && i.start <= last.end) last.end = Math.max(last.end, i.end);
    else out.push({ ...i });
  }
  return out;
}

/** Days of a month window that have at least one slot (dots in the month picker). */
export async function daysWithSlots(q: Queryable, ctx: Ctx, sel: Selection, from: LocalDate, days: number, stylistId?: string) {
  const res = await availability(q, ctx, sel, from, days, stylistId ? { stylistId } : {});
  return res.filter((d) => d.slots.length).map((d) => d.date);
}

export async function nextFree(
  q: Queryable,
  ctx: Ctx,
  sel: Selection,
  fromDate: LocalDate,
  stylistId?: string,
  excludeAppointmentId?: string,
): Promise<{ date: LocalDate; start: Minute } | null> {
  assertSelection(ctx, sel);
  const now = salonNow(ctx.clock, ctx.cfg.timeZone);
  const stylists = (await activeStylists(q, ctx.tenantId)).filter((s) => !stylistId || s.id === stylistId).map((s) => s.id);
  const end = addDays(now.date, ctx.cfg.horizonDays);
  const CHUNK = 28; // load occupancy in 4-week chunks to keep the query count low
  for (let d = daysBetween(now.date, fromDate) > 0 ? fromDate : now.date; d <= end; d = addDays(d, CHUNK)) {
    const occ = await loadOccupancy(q, ctx, stylists, d, CHUNK, excludeAppointmentId);
    for (let i = 0; i < CHUNK; i++) {
      const date = addDays(d, i);
      if (date > end) return null;
      const slots = availableStartsMulti({ config: ctx.cfg, date, selection: sel, now }, occ.get(date)!);
      if (slots.length) return { date, start: slots[0]!.start };
    }
  }
  return null;
}
