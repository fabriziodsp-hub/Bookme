/** Bridge between persisted time blocks (UTC) and the engine's local-minute model. */
import {
  addDays,
  fromInstant,
  offDuty,
  toInstant,
  type Block,
  type DayOccupancy,
  type Interval,
  type LocalDate,
  type SalonConfig,
  type WorkHours,
} from '@salon/engine';
import type { Queryable } from '../db/pool.js';

export interface BlockRow {
  stylist_id: string;
  appointment_id: string | null;
  absence_id: string | null;
  seq: number;
  phase_key: string;
  kind: 'busy' | 'free';
  start_at: Date;
  end_at: Date;
}

/** Local day [00:00, 24:00) as UTC instants. Midnight always exists in Europe/Berlin. */
export function dayRange(cfg: SalonConfig, date: LocalDate): { from: Date; to: Date } {
  return { from: toInstant(date, 0, cfg.timeZone), to: toInstant(addDays(date, 1), 0, cfg.timeZone) };
}

/** Clamp an instant interval to local minutes of `date`. */
export function toLocalInterval(cfg: SalonConfig, date: LocalDate, start: Date, end: Date): Interval {
  const { from, to } = dayRange(cfg, date);
  const s = start < from ? 0 : fromInstant(start, cfg.timeZone).minute;
  const e = end >= to ? 1440 : fromInstant(end, cfg.timeZone).minute;
  return { start: s, end: e };
}

export function blocksToRows(cfg: SalonConfig, date: LocalDate, blocks: readonly Block[]) {
  return blocks.map((b, seq) => ({
    seq,
    phase_key: b.phase,
    kind: b.kind,
    start_at: toInstant(date, b.start, cfg.timeZone),
    end_at: toInstant(date, b.end, cfg.timeZone),
  }));
}

export function rowsToBlocks(cfg: SalonConfig, rows: readonly Pick<BlockRow, 'phase_key' | 'kind' | 'start_at' | 'end_at'>[]): {
  date: LocalDate;
  blocks: Block[];
} {
  const date = fromInstant(rows[0]!.start_at, cfg.timeZone).date;
  return {
    date,
    blocks: rows.map((r) => {
      const i = toLocalInterval(cfg, date, r.start_at, r.end_at);
      return { phase: r.phase_key, kind: r.kind, start: i.start, end: i.end };
    }),
  };
}

/**
 * Occupancy per stylist for each date in [from, from+days).
 * Only active blocks; free blocks of appointments are ignored (they never conflict).
 */
export async function loadOccupancy(
  q: Queryable,
  ctx: { cfg: SalonConfig; tenantId: string },
  stylistIds: readonly string[],
  fromDate: LocalDate,
  days: number,
  excludeAppointmentId?: string,
): Promise<Map<LocalDate, Map<string, DayOccupancy>>> {
  const { cfg } = ctx;
  const out = new Map<LocalDate, Map<string, DayOccupancy>>();
  for (let i = 0; i < days; i++) {
    const d = addDays(fromDate, i);
    out.set(d, new Map(stylistIds.map((s) => [s, { busy: [], absences: [] }])));
  }
  if (!stylistIds.length) return out;
  const from = dayRange(cfg, fromDate).from;
  const to = dayRange(cfg, addDays(fromDate, days - 1)).to;
  const { rows } = await q.query<BlockRow>(
    `SELECT stylist_id, appointment_id, absence_id, seq, phase_key, kind, start_at, end_at
       FROM time_block
      WHERE tenant_id = $5 AND active AND stylist_id = ANY($1::uuid[])
        AND tstzrange(start_at, end_at, '[)') && tstzrange($2, $3, '[)')
        AND kind = 'busy'
        AND ($4::uuid IS NULL OR appointment_id IS DISTINCT FROM $4::uuid)`,
    [stylistIds, from, to, excludeAppointmentId ?? null, ctx.tenantId],
  );
  for (const r of rows) {
    // A block may span several local days (absences); add it to each.
    let d = fromInstant(r.start_at, cfg.timeZone).date;
    const last = fromInstant(new Date(r.end_at.getTime() - 1), cfg.timeZone).date;
    for (;;) {
      const occ = out.get(d)?.get(r.stylist_id);
      if (occ) {
        const interval = toLocalInterval(cfg, d, r.start_at, r.end_at);
        (r.absence_id ? (occ.absences as Interval[]) : (occ.busy as Interval[])).push(interval);
      }
      if (d >= last) break;
      d = addDays(d, 1);
    }
  }
  // D-071: personal working hours – time outside them counts as absence (also for staff placement).
  const { rows: wh } = await q.query<{ id: string; work_hours: WorkHours | null }>(
    'SELECT id, work_hours FROM stylist WHERE tenant_id = $1 AND id = ANY($2::uuid[]) AND work_hours IS NOT NULL',
    [ctx.tenantId, stylistIds],
  );
  for (const w of wh) {
    for (const [d, m] of out) {
      const occ = m.get(w.id);
      if (occ) (occ.absences as Interval[]).push(...offDuty(cfg, d, w.work_hours));
    }
  }
  return out;
}
