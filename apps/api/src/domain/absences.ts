import { addDays, fromInstant, toInstant, type LocalDate, type Minute } from '@salon/engine';
import { lockStylistDay, PG, pgCode, withTx, type Queryable } from '../db/pool.js';
import type { Ctx } from './context.js';
import { Errors } from './errors.js';

export type AbsenceKind = 'vacation' | 'sick' | 'training' | 'other';

export interface AbsenceDto {
  id: string;
  stylistId: string;
  kind: AbsenceKind;
  note: string | null;
  from: { date: LocalDate; minute: Minute };
  to: { date: LocalDate; minute: Minute };
  startAt: string;
  endAt: string;
}

interface Row {
  id: string;
  stylist_id: string;
  kind: AbsenceKind;
  note: string | null;
  start_at: Date;
  end_at: Date;
}

const toDto = (ctx: Ctx, r: Row): AbsenceDto => {
  const f = fromInstant(r.start_at, ctx.cfg.timeZone);
  let t = fromInstant(r.end_at, ctx.cfg.timeZone);
  if (t.minute === 0) t = { date: addDays(t.date, -1), minute: 1440 }; // "until end of day"
  return { id: r.id, stylistId: r.stylist_id, kind: r.kind, note: r.note, from: f, to: t, startAt: r.start_at.toISOString(), endAt: r.end_at.toISOString() };
};

export async function listAbsences(q: Queryable, ctx: Ctx, from: Date, to: Date): Promise<AbsenceDto[]> {
  const { rows } = await q.query<Row>('SELECT * FROM absence WHERE tenant_id = $3 AND start_at < $2 AND end_at > $1 ORDER BY start_at', [from, to, ctx.tenantId]);
  return rows.map((r) => toDto(ctx, r));
}

export async function createAbsence(
  ctx: Ctx,
  input: { stylistId: string; from: { date: LocalDate; minute: Minute }; to: { date: LocalDate; minute: Minute }; kind: AbsenceKind; note?: string | undefined },
  staffUserId: string,
): Promise<AbsenceDto> {
  const startAt = toInstant(input.from.date, input.from.minute, ctx.cfg.timeZone);
  const endAt =
    input.to.minute === 1440 ? toInstant(addDays(input.to.date, 1), 0, ctx.cfg.timeZone) : toInstant(input.to.date, input.to.minute, ctx.cfg.timeZone);
  if (endAt <= startAt) throw Errors.validation({ to: 'Ende muss nach dem Beginn liegen.' });
  if (endAt.getTime() - startAt.getTime() > 366 * 86_400_000) throw Errors.validation({ to: 'Maximal ein Jahr.' });
  const st = await ctx.db.query('SELECT 1 FROM stylist WHERE tenant_id = $1 AND id = $2', [ctx.tenantId, input.stylistId]);
  if (!st.rowCount) throw Errors.notFound();
  return withTx(ctx.db, async (tx) => {
    for (let d = input.from.date; d <= input.to.date; d = addDays(d, 1)) await lockStylistDay(tx, input.stylistId, d);
    // Absences block whole appointments, including free blocks (A-13).
    const { rows: clash } = await tx.query<{ ref_code: string; start_at: Date }>(
      `SELECT DISTINCT a.ref_code, a.start_at FROM time_block b JOIN appointment a ON a.id = b.appointment_id
        WHERE b.tenant_id = $4 AND b.active AND b.stylist_id = $1 AND tstzrange(b.start_at, b.end_at, '[)') && tstzrange($2, $3, '[)')
        ORDER BY a.start_at`,
      [input.stylistId, startAt, endAt, ctx.tenantId],
    );
    if (clash.length) throw Errors.absenceConflict(clash.map((c) => ({ refCode: c.ref_code, startAt: c.start_at.toISOString() })));
    const ins = await tx.query<Row>(
      `INSERT INTO absence (tenant_id, stylist_id, start_at, end_at, kind, note, created_by) VALUES ($7,$1,$2,$3,$4,$5,$6) RETURNING *`,
      [input.stylistId, startAt, endAt, input.kind, input.note?.trim() || null, staffUserId, ctx.tenantId],
    );
    try {
      await tx.query(
        `INSERT INTO time_block (tenant_id, stylist_id, absence_id, phase_key, kind, start_at, end_at) VALUES ($5, $1, $2, 'absence', 'busy', $3, $4)`,
        [input.stylistId, ins.rows[0]!.id, startAt, endAt, ctx.tenantId],
      );
    } catch (e) {
      if (pgCode(e) === PG.EXCLUSION_VIOLATION) throw Errors.absenceConflict([]);
      throw e;
    }
    return toDto(ctx, ins.rows[0]!);
  });
}

export async function deleteAbsence(ctx: Ctx, id: string): Promise<void> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw Errors.notFound();
  const r = await ctx.db.query('DELETE FROM absence WHERE tenant_id = $1 AND id = $2', [ctx.tenantId, id]);
  if (!r.rowCount) throw Errors.notFound();
}
