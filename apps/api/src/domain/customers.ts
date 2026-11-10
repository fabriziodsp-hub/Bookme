import { fromInstant } from '@salon/engine';
import { withTx, type Queryable } from '../db/pool.js';
import type { Ctx } from './context.js';
import { Errors } from './errors.js';
import { serviceLabel, sha256 } from './util.js';

export interface CustomerSummary {
  id: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
  noShowCount: number;
  appointmentCount: number;
  next: { id: string; date: string; start: number; serviceLabel: string } | null;
  last: { id: string; date: string; start: number; serviceLabel: string; status: string } | null;
}

/**
 * Client list (S-9, D-056): without a search term all clients, otherwise a search by name, e-mail or
 * phone fragment (min. 2 characters). Sorted by name or by next appointment (clients without an
 * upcoming appointment last, by name). Paged with limit/offset; one query (no N+1).
 */
export async function searchCustomers(
  q: Queryable,
  ctx: Ctx,
  term: string,
  opts: { sort?: 'name' | 'next'; limit?: number; offset?: number } = {},
): Promise<{ customers: CustomerSummary[]; hasMore: boolean }> {
  const t = term.trim();
  if (t.length === 1) return { customers: [], hasMore: false };
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
  const offset = Math.max(opts.offset ?? 0, 0);
  const like = `%${t.toLowerCase().replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
  const digits = t.replace(/\D/g, '');
  const order = opts.sort === 'next'
    ? 'n.start_at ASC NULLS LAST, c.last_name, c.first_name, c.id'
    : 'c.last_name, c.first_name, c.id';
  const now = ctx.clock.now();
  const { rows } = await q.query<{
    id: string; first_name: string; last_name: string; phone: string | null; email: string | null; no_shows: number; total: number;
    n_id: string | null; n_start: Date | null; n_service: string | null; n_variant: string | null; n_finish: boolean | null;
    l_id: string | null; l_start: Date | null; l_service: string | null; l_variant: string | null; l_finish: boolean | null; l_status: string | null;
  }>(
    `SELECT c.id, c.first_name, c.last_name, c.phone, c.email, st.no_shows, st.total,
            n.id AS n_id, n.start_at AS n_start, n.service_id AS n_service, n.variant AS n_variant, n.finish AS n_finish,
            l.id AS l_id, l.start_at AS l_start, l.service_id AS l_service, l.variant AS l_variant, l.finish AS l_finish, l.status AS l_status
       FROM customer c
       CROSS JOIN LATERAL (SELECT count(*) FILTER (WHERE a.status = 'no_show')::int AS no_shows, count(*)::int AS total
                             FROM appointment a WHERE a.customer_id = c.id AND a.tenant_id = c.tenant_id) st
       LEFT JOIN LATERAL (SELECT id, start_at, service_id, variant, finish FROM appointment
                           WHERE customer_id = c.id AND tenant_id = c.tenant_id AND start_at >= $5 AND status IN ('requested','discuss','confirmed')
                           ORDER BY start_at LIMIT 1) n ON true
       LEFT JOIN LATERAL (SELECT id, start_at, service_id, variant, finish, status FROM appointment
                           WHERE customer_id = c.id AND tenant_id = c.tenant_id AND start_at < $5
                           ORDER BY start_at DESC LIMIT 1) l ON true
      WHERE c.tenant_id = $4 AND c.anonymized_at IS NULL AND ($1 = '' OR
            lower(c.first_name || ' ' || c.last_name) LIKE $1 OR lower(c.last_name || ' ' || c.first_name) LIKE $1
         OR lower(coalesce(c.email, '')) LIKE $1
         OR ($2 <> '' AND length($2) >= 3 AND regexp_replace(coalesce(c.phone, ''), '\\D', '', 'g') LIKE '%' || $2 || '%'))
      ORDER BY ${order} LIMIT $3 OFFSET $6`,
    [t ? like : '', digits, limit + 1, ctx.tenantId, now, offset],
  );
  const fmt = (id: string, start: Date, service: string, variant: string | null, finish: boolean | null) => {
    const l = fromInstant(start, ctx.cfg.timeZone);
    return { id, date: l.date, start: l.minute, serviceLabel: serviceLabel(ctx.cfg, { serviceId: service, variant: variant ?? undefined, finish: !!finish }) };
  };
  const customers = rows.slice(0, limit).map((r) => ({
    id: r.id, firstName: r.first_name, lastName: r.last_name, phone: r.phone, email: r.email,
    noShowCount: r.no_shows, appointmentCount: r.total,
    next: r.n_id && r.n_start && r.n_service ? fmt(r.n_id, r.n_start, r.n_service, r.n_variant, r.n_finish) : null,
    last: r.l_id && r.l_start && r.l_service ? { ...fmt(r.l_id, r.l_start, r.l_service, r.l_variant, r.l_finish), status: r.l_status ?? '' } : null,
  }));
  return { customers, hasMore: rows.length > limit };
}

/** Art. 15 DSGVO export of everything stored about a customer. */
export async function exportCustomer(q: Queryable, ctx: Ctx, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw Errors.notFound();
  const c = await q.query(
    `SELECT id, first_name, last_name, phone, email, birth_month, birthday_consent_at, marketing_unsubscribed_at, privacy_ack_at, privacy_ack_version,
            health_consent_at, health_notes, created_at, last_seen_at FROM customer WHERE tenant_id = $1 AND id = $2`,
    [ctx.tenantId, id],
  );
  if (!c.rows[0]) throw Errors.notFound();
  const a = await q.query(
    `SELECT id, ref_code, service_id, variant, finish, audience, adult_declared, color_notes, status, age_check_status,
            fee_cents, fee_consent_at, fee_consent_text, fee_status, birthday_discount, start_at, end_at, created_at
       FROM appointment WHERE tenant_id = $1 AND customer_id = $2 ORDER BY start_at`,
    [ctx.tenantId, id],
  );
  const m = await q.query(
    `SELECT o.channel, o.template, o.created_at, o.sent_at FROM outbox_message o JOIN appointment a ON a.id = o.appointment_id
      WHERE a.tenant_id = $1 AND a.customer_id = $2`,
    [ctx.tenantId, id],
  );
  const e = await q.query('SELECT kind, body, created_at FROM customer_entry WHERE tenant_id = $1 AND customer_id = $2 ORDER BY created_at', [ctx.tenantId, id]);
  return { customer: c.rows[0], appointments: a.rows, messages: m.rows, cardEntries: e.rows };
}

/**
 * Art. 17 DSGVO: anonymise. Future booked appointments are cancelled first.
 * Appointment rows stay (without personal data) so the calendar history remains consistent.
 */
export async function anonymizeCustomer(ctx: Ctx, id: string, reason: 'request' | 'retention'): Promise<void> {
  await withTx(ctx.db, async (tx) => {
    const now = ctx.clock.now();
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw Errors.notFound();
    const r = await tx.query('SELECT id FROM customer WHERE tenant_id = $2 AND id = $1 AND anonymized_at IS NULL FOR UPDATE', [id, ctx.tenantId]);
    if (!r.rowCount) throw Errors.notFound();
    const future = await tx.query<{ id: string }>(
      `UPDATE appointment SET status = 'cancelled', cancelled_at = $2, cancel_reason = 'Datenlöschung', version = version + 1
        WHERE customer_id = $1 AND status IN ('requested','discuss','confirmed') AND start_at > $2 RETURNING id`,
      [id, now],
    );
    if (future.rowCount) {
      await tx.query('UPDATE time_block SET active = false WHERE appointment_id = ANY($1::uuid[])', [future.rows.map((x) => x.id)]);
    }
    await tx.query(
      `UPDATE appointment SET color_notes = NULL, internal_note = NULL, manage_token_hash = NULL WHERE customer_id = $1`,
      [id],
    );
    await tx.query(
      `DELETE FROM outbox_message WHERE appointment_id IN (SELECT id FROM appointment WHERE customer_id = $1)`,
      [id],
    );
    await tx.query('DELETE FROM customer_entry WHERE customer_id = $1', [id]);
    await tx.query(
      `UPDATE customer SET first_name = 'Gelöscht', last_name = '', phone = NULL, email = NULL, birth_month = NULL,
              birthday_consent_at = NULL, unsubscribe_token_hash = NULL, health_notes = NULL, health_consent_at = NULL,
              health_consent_by = NULL, anonymized_at = $2 WHERE id = $1`,
      [id, now],
    );
    await tx.query(
      `INSERT INTO appointment_event (tenant_id, appointment_id, actor, type, payload)
       SELECT tenant_id, id, 'system', 'anonymized', $2 FROM appointment WHERE customer_id = $1`,
      [id, JSON.stringify({ reason })],
    );
  });
}

/** Birthday offer opt-out via e-mail link. */
export async function unsubscribe(ctx: Ctx, token: string): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return false;
  const r = await ctx.db.query(
    `UPDATE customer SET marketing_unsubscribed_at = $3, birth_month = NULL, birthday_consent_at = NULL
      WHERE tenant_id = $1 AND unsubscribe_token_hash = $2`,
    [ctx.tenantId, sha256(token), ctx.clock.now()],
  );
  return (r.rowCount ?? 0) > 0;
}

// ---------- client card (staff only) ----------

export interface CustomerEntry {
  id: string;
  kind: 'color' | 'note';
  body: string;
  author: string | null;
  authorId: string | null;
  createdAt: string;
}

export interface CustomerCard {
  customer: {
    id: string;
    firstName: string;
    lastName: string;
    phone: string | null;
    email: string | null;
    createdAt: string;
    privacyAckAt: string | null;
    birthMonth: number | null;
    health: { consentAt: string | null; notes: string | null };
    noShowCount: number;
  };
  appointments: { id: string; date: string; start: number; end: number; serviceLabel: string; status: string; stylist: string; colorNotes: string | null; locked: boolean }[];
  entries: CustomerEntry[];
}

const isUuid = (id: string) => /^[0-9a-f-]{36}$/i.test(id);

/** Everything staff see on the client card: contact, all appointments (past + future), recipes/notes, health data. */
export async function getCustomerCard(q: Queryable, ctx: Ctx, id: string): Promise<CustomerCard> {
  if (!isUuid(id)) throw Errors.notFound();
  const c = await q.query<{
    id: string; first_name: string; last_name: string; phone: string | null; email: string | null; created_at: Date;
    privacy_ack_at: Date | null; birth_month: number | null; health_consent_at: Date | null; health_notes: string | null;
  }>(
    `SELECT id, first_name, last_name, phone, email, created_at, privacy_ack_at, birth_month, health_consent_at, health_notes
       FROM customer WHERE tenant_id = $1 AND id = $2 AND anonymized_at IS NULL`,
    [ctx.tenantId, id],
  );
  const r = c.rows[0];
  if (!r) throw Errors.notFound();
  const a = await q.query<{ id: string; start_at: Date; end_at: Date; status: string; service_id: string; variant: string | null; finish: boolean; stylist: string; color_notes: string | null }>(
    `SELECT a.id, a.start_at, a.end_at, a.status, a.service_id, a.variant, a.finish, s.display_name AS stylist, a.color_notes
       FROM appointment a JOIN stylist s ON s.id = a.stylist_id
      WHERE a.tenant_id = $1 AND a.customer_id = $2 ORDER BY a.start_at DESC`,
    [ctx.tenantId, id],
  );
  const e = await q.query<{ id: string; kind: 'color' | 'note'; body: string; author: string | null; author_id: string | null; created_at: Date }>(
    `SELECT e.id, e.kind, e.body, u.display_name AS author, e.author_id, e.created_at
       FROM customer_entry e LEFT JOIN staff_user u ON u.id = e.author_id
      WHERE e.tenant_id = $1 AND e.customer_id = $2 ORDER BY e.created_at DESC`,
    [ctx.tenantId, id],
  );
  const today = fromInstant(ctx.clock.now(), ctx.cfg.timeZone).date;
  return {
    customer: {
      id: r.id, firstName: r.first_name, lastName: r.last_name, phone: r.phone, email: r.email,
      createdAt: r.created_at.toISOString(),
      privacyAckAt: r.privacy_ack_at?.toISOString() ?? null,
      birthMonth: r.birth_month,
      health: { consentAt: r.health_consent_at?.toISOString() ?? null, notes: r.health_notes },
      noShowCount: a.rows.filter((x) => x.status === 'no_show').length,
    },
    appointments: a.rows.map((x) => {
      const s = fromInstant(x.start_at, ctx.cfg.timeZone);
      const en = fromInstant(x.end_at, ctx.cfg.timeZone);
      return {
        id: x.id, date: s.date, start: s.minute, end: en.minute, status: x.status, stylist: x.stylist, colorNotes: x.color_notes,
        serviceLabel: serviceLabel(ctx.cfg, { serviceId: x.service_id, variant: x.variant ?? undefined, finish: x.finish }),
        locked: s.date < today, // history: cannot be cancelled any more (owner request 2026-11-07)
      };
    }),
    entries: e.rows.map((x) => ({ id: x.id, kind: x.kind, body: x.body, author: x.author, authorId: x.author_id, createdAt: x.created_at.toISOString() })),
  };
}

async function assertCustomer(q: Queryable, ctx: Ctx, id: string) {
  if (!isUuid(id)) throw Errors.notFound();
  const r = await q.query('SELECT 1 FROM customer WHERE tenant_id = $1 AND id = $2 AND anonymized_at IS NULL', [ctx.tenantId, id]);
  if (!r.rowCount) throw Errors.notFound();
}

export async function addCustomerEntry(ctx: Ctx, customerId: string, input: { kind: 'color' | 'note'; body: string }, authorId: string): Promise<void> {
  await assertCustomer(ctx.db, ctx, customerId);
  const body = input.body.trim();
  if (!body) throw Errors.validation({ body: 'Bitte einen Text eingeben.' });
  await ctx.db.query(
    'INSERT INTO customer_entry (tenant_id, customer_id, kind, body, author_id, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$6)',
    [ctx.tenantId, customerId, input.kind, body.slice(0, 2000), authorId, ctx.clock.now()],
  );
}

/** Authors delete their own entries; the owner may delete any. */
export async function deleteCustomerEntry(ctx: Ctx, customerId: string, entryId: string, user: { id: string; role: string }): Promise<void> {
  if (!isUuid(entryId)) throw Errors.notFound();
  const r = await ctx.db.query(
    `DELETE FROM customer_entry WHERE tenant_id = $1 AND customer_id = $2 AND id = $3 AND ($4 = 'owner' OR author_id = $5)`,
    [ctx.tenantId, customerId, entryId, user.role, user.id],
  );
  if (!r.rowCount) throw Errors.forbidden();
}

/**
 * Health data (allergies, intolerances) – special category, Art. 9(2)(a) DSGVO: only with the client's explicit consent,
 * which staff confirm (written consent kept in the salon). Withdrawing the consent deletes the notes.
 */
export async function setCustomerHealth(ctx: Ctx, customerId: string, input: { consent: boolean; notes?: string | null | undefined }, staffId: string): Promise<void> {
  await assertCustomer(ctx.db, ctx, customerId);
  if (!input.consent) {
    await ctx.db.query('UPDATE customer SET health_notes = NULL, health_consent_at = NULL, health_consent_by = NULL WHERE tenant_id = $1 AND id = $2', [ctx.tenantId, customerId]);
    return;
  }
  await ctx.db.query(
    `UPDATE customer SET health_consent_at = COALESCE(health_consent_at, $3), health_consent_by = COALESCE(health_consent_by, $4), health_notes = $5
      WHERE tenant_id = $1 AND id = $2`,
    [ctx.tenantId, customerId, ctx.clock.now(), staffId, input.notes?.trim().slice(0, 2000) || null],
  );
}
