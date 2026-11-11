/**
 * Appointment use cases. Every write runs in one transaction:
 *   advisory lock (stylist+day) → engine rules → insert/update → exclusion constraint (final guard)
 *   → audit event → outbox message.
 * Every query is scoped to ctx.tenantId.
 */
import {
  birthdayDiscountEligible,
  buildBlocks,
  feeAmountCents,
  rescheduleNeedsReconfirmation,
  totalMinutes,
  canChangeOnline,
  checkPlacement,
  checkSelection,
  feeDue,
  findService,
  fromInstant,
  requestExpiresAt,
  type Block,
  type LocalDate,
  type Minute,
  type Selection,
  type Violation,
} from '@salon/engine';
import { salonNow } from '../clock.js';
import { lockStylistDay, PG, pgCode, withTx, type Queryable, type Tx } from '../db/pool.js';
import { dropPendingReminders, enqueue } from '../messages/outbox.js';
import type { Template } from '../messages/templates.js';
import { salonUrl, type Ctx } from './context.js';
import { AppError, Errors } from './errors.js';
import { blocksToRows, loadOccupancy, rowsToBlocks } from './occupancy.js';
import { listPrices, priceFor } from './prices.js';
import { randomUUID } from 'node:crypto';
import { manageTokenFor, newRefCode, normalizePhone, serviceLabel, sha256, unsubscribeTokenFor } from './util.js';

export type Actor = 'customer' | 'system' | `staff:${string}`;
export type Status = 'requested' | 'discuss' | 'confirmed' | 'declined' | 'expired' | 'completed' | 'no_show' | 'cancelled';
export type AgeCheckStatus = 'not_required' | 'open' | 'requested' | 'verified' | 'not_verified' | 'not_presented';
export type FeeStatus = 'none' | 'due' | 'paid' | 'waived';

/** States whose blocks reserve time. */
export const ACTIVE: readonly Status[] = ['requested', 'discuss', 'confirmed', 'completed', 'no_show'];
/** States the client can still change/cancel. */
const OPEN: readonly Status[] = ['requested', 'discuss', 'confirmed'];

/** Version of the fee consent text stored with each consent (proof). */
export const FEE_CONSENT_VERSION = 'fee-v1';
/** Version of the privacy notice text (Datenschutzhinweise) the client acknowledged. */
export const PRIVACY_NOTICE_VERSION = 'privacy-v2-2026-11';

export function feeConsentText(amountCents: number, hours: number): string {
  const euro = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 0 }).format(amountCents / 100);
  return (
    `Ich akzeptiere eine Ausfallgebühr von ${euro}, wenn ich den Termin später als ${hours} Stunden vorher absage ` +
    `oder nicht erscheine. Der Nachweis, dass kein oder ein geringerer Schaden entstanden ist, bleibt mir unbenommen.`
  );
}

export interface CustomerInput {
  firstName: string;
  lastName: string;
  phone?: string | undefined;
  email?: string | undefined;
  /** 1–12, only with birthday consent; adults only. */
  birthMonth?: number | undefined;
}

export interface AppointmentRow {
  id: string;
  tenant_id: string;
  ref_code: string;
  stylist_id: string;
  customer_id: string;
  service_id: string;
  audience: 'women' | 'men';
  variant: string | null;
  finish: boolean;
  adult_declared: boolean;
  color_notes: string | null;
  internal_note: string | null;
  status: Status;
  source: 'online' | 'staff';
  age_check_status: AgeCheckStatus;
  age_check_at: Date | null;
  fee_cents: number | null;
  fee_late_cancel_hours: number | null;
  fee_consent_at: Date | null;
  fee_status: FeeStatus;
  birthday_discount: boolean;
  price_cents_snapshot: number | null;
  price_is_from: boolean;
  expires_at: Date | null;
  client_note: string | null;
  client_note_draft: string | null;
  needs_reassign: boolean;
  cancel_reason: string | null;
  start_at: Date;
  end_at: Date;
  version: number;
  created_at: Date;
  first_name: string;
  last_name: string;
  phone: string | null;
  email: string | null;
}

export interface AppointmentDto {
  id: string;
  refCode: string;
  stylistId: string;
  date: LocalDate;
  start: Minute;
  end: Minute;
  blocks: Block[];
  status: Status;
  source: 'online' | 'staff';
  serviceId: string;
  serviceLabel: string;
  variant: string | null;
  finish: boolean;
  audience: 'women' | 'men';
  adultDeclared: boolean;
  colorNotes: string | null;
  internalNote: string | null;
  ageCheck: { status: AgeCheckStatus; at: string | null };
  fee: { cents: number; status: FeeStatus; consentAt: string | null } | null;
  price: { cents: number; isFrom: boolean; birthdayDiscount: boolean } | null;
  expiresAt: string | null;
  /** Note from the salon to the client (sent with the decision, shown on the booking page). */
  clientNote: string | null;
  clientNoteDraft: string | null;
  needsReassign: boolean;
  version: number;
  createdAt: string;
  customer: { id: string; firstName: string; lastName: string; phone: string | null; email: string | null; noShowCount: number };
}

const SELECT_APPOINTMENT = `
  SELECT a.*, c.first_name, c.last_name, c.phone, c.email
    FROM appointment a JOIN customer c ON c.id = a.customer_id`;

// ---------- helpers ----------

export function selectionOf(r: Pick<AppointmentRow, 'service_id' | 'audience' | 'adult_declared' | 'variant' | 'finish'>): Selection {
  return { serviceId: r.service_id, audience: r.audience, adult: r.adult_declared, variant: r.variant ?? undefined, finish: r.finish || undefined };
}

async function blocksOf(q: Queryable, ctx: Ctx, ids: string[]) {
  const { rows } = await q.query<{ appointment_id: string; phase_key: string; kind: 'busy' | 'free'; start_at: Date; end_at: Date }>(
    `SELECT appointment_id, phase_key, kind, start_at, end_at FROM time_block
      WHERE tenant_id = $1 AND appointment_id = ANY($2::uuid[]) ORDER BY appointment_id, seq`,
    [ctx.tenantId, ids],
  );
  const grouped = new Map<string, typeof rows>();
  for (const r of rows) grouped.set(r.appointment_id, [...(grouped.get(r.appointment_id) ?? []), r]);
  return new Map([...grouped].map(([id, list]) => [id, rowsToBlocks(ctx.cfg, list)]));
}

export async function toDtos(q: Queryable, ctx: Ctx, rows: AppointmentRow[]): Promise<AppointmentDto[]> {
  if (!rows.length) return [];
  const blocks = await blocksOf(q, ctx, rows.map((r) => r.id));
  const { rows: ns } = await q.query<{ customer_id: string; n: number }>(
    `SELECT customer_id, count(*) AS n FROM appointment
      WHERE tenant_id = $1 AND status = 'no_show' AND customer_id = ANY($2::uuid[]) GROUP BY customer_id`,
    [ctx.tenantId, [...new Set(rows.map((r) => r.customer_id))]],
  );
  const noShows = new Map(ns.map((r) => [r.customer_id, r.n]));
  return rows.map((r) => {
    const local = fromInstant(r.start_at, ctx.cfg.timeZone);
    const b = blocks.get(r.id) ?? { date: local.date, blocks: [] };
    return {
      id: r.id,
      refCode: r.ref_code,
      stylistId: r.stylist_id,
      date: b.date,
      start: b.blocks[0]?.start ?? local.minute,
      end: b.blocks.at(-1)?.end ?? fromInstant(r.end_at, ctx.cfg.timeZone).minute,
      blocks: b.blocks,
      status: r.status,
      source: r.source,
      serviceId: r.service_id,
      serviceLabel: serviceLabel(ctx.cfg, selectionOf(r)),
      variant: r.variant,
      finish: r.finish,
      audience: r.audience,
      adultDeclared: r.adult_declared,
      colorNotes: r.color_notes,
      internalNote: r.internal_note,
      ageCheck: { status: r.age_check_status, at: r.age_check_at?.toISOString() ?? null },
      fee: r.fee_cents ? { cents: r.fee_cents, status: r.fee_status, consentAt: r.fee_consent_at?.toISOString() ?? null } : null,
      price: r.price_cents_snapshot !== null ? { cents: r.price_cents_snapshot, isFrom: r.price_is_from, birthdayDiscount: r.birthday_discount } : null,
      expiresAt: r.expires_at?.toISOString() ?? null,
      clientNote: r.client_note,
      clientNoteDraft: r.client_note_draft,
      needsReassign: r.needs_reassign,
      version: r.version,
      createdAt: r.created_at.toISOString(),
      customer: { id: r.customer_id, firstName: r.first_name, lastName: r.last_name, phone: r.phone, email: r.email, noShowCount: noShows.get(r.customer_id) ?? 0 },
    };
  });
}

async function event(tx: Tx, ctx: Ctx, appointmentId: string, actor: Actor, type: string, payload: unknown = {}) {
  await tx.query('INSERT INTO appointment_event (tenant_id, appointment_id, actor, type, payload) VALUES ($1, $2, $3, $4, $5)', [
    ctx.tenantId,
    appointmentId,
    actor,
    type,
    JSON.stringify(payload),
  ]);
}

function cleanCustomer(input: CustomerInput, adult: boolean) {
  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  const email = input.email?.trim().toLowerCase() || null;
  const phoneRaw = input.phone?.trim() || null;
  const fieldErrors: Record<string, string> = {};
  if (!firstName) fieldErrors.firstName = 'Bitte Vornamen angeben.';
  if (!lastName) fieldErrors.lastName = 'Bitte Nachnamen angeben.';
  const phone = phoneRaw ? normalizePhone(phoneRaw) : null;
  if (phoneRaw && !phone) fieldErrors.phone = 'Bitte eine gültige Telefonnummer angeben.';
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fieldErrors.email = 'Bitte eine gültige E-Mail-Adresse angeben.';
  if (!phoneRaw && !email) fieldErrors.contact = 'Bitte Telefon oder E-Mail angeben.';
  const bm = input.birthMonth;
  if (bm !== undefined && (!Number.isInteger(bm) || bm < 1 || bm > 12)) fieldErrors.birthMonth = 'Ungültiger Monat.';
  if (Object.keys(fieldErrors).length) throw Errors.validation({ fieldErrors });
  // Birthday offer only for adults (no marketing consent from minors).
  return { firstName, lastName, email, phone, birthMonth: adult ? (bm ?? null) : null };
}

/** A client card of this salon (staff picked it in the search, D-064). */
async function existingCustomer(tx: Tx, ctx: Ctx, id: string): Promise<ReturnType<typeof cleanCustomer>> {
  const { rows } = await tx.query<{ first_name: string; last_name: string; email: string | null; phone: string | null; birth_month: number | null }>(
    'SELECT first_name, last_name, email, phone, birth_month FROM customer WHERE tenant_id = $1 AND id = $2 AND anonymized_at IS NULL FOR UPDATE',
    [ctx.tenantId, id],
  );
  const r = rows[0];
  if (!r) throw Errors.notFound();
  return { firstName: r.first_name, lastName: r.last_name, email: r.email, phone: r.phone, birthMonth: r.birth_month };
}

/** Re-use a customer of this salon when e-mail or phone and last name match. */
async function upsertCustomer(tx: Tx, ctx: Ctx, c: ReturnType<typeof cleanCustomer>, now: Date): Promise<{ id: string; birthMonth: number | null }> {
  const { rows } = await tx.query<{ id: string; birth_month: number | null }>(
    `SELECT id, birth_month FROM customer
      WHERE tenant_id = $1 AND anonymized_at IS NULL AND lower(last_name) = lower($2)
        AND ((email IS NOT NULL AND email = $3) OR (phone IS NOT NULL AND phone = $4))
      ORDER BY last_seen_at DESC LIMIT 1 FOR UPDATE`,
    [ctx.tenantId, c.lastName, c.email, c.phone],
  );
  const consentAt = c.birthMonth ? now : null;
  if (rows[0]) {
    await tx.query(
      `UPDATE customer SET first_name = $2, email = COALESCE($3, email), phone = COALESCE($4, phone), last_seen_at = $5,
              birth_month = COALESCE($6, birth_month), birthday_consent_at = COALESCE($7, birthday_consent_at),
              marketing_unsubscribed_at = CASE WHEN $6::smallint IS NOT NULL THEN NULL ELSE marketing_unsubscribed_at END
        WHERE id = $1`,
      [rows[0].id, c.firstName, c.email, c.phone, now, c.birthMonth, consentAt],
    );
    return { id: rows[0].id, birthMonth: c.birthMonth ?? rows[0].birth_month };
  }
  const id = randomUUID();
  const ins = await tx.query<{ id: string }>(
    `INSERT INTO customer (id, tenant_id, first_name, last_name, email, phone, birth_month, birthday_consent_at, unsubscribe_token_hash, created_at, last_seen_at)
     VALUES ($10, $1, $2, $3, $4, $5, $6, $7, $8, $9, $9) RETURNING id`,
    [ctx.tenantId, c.firstName, c.lastName, c.email, c.phone, c.birthMonth, consentAt, sha256(unsubscribeTokenFor(ctx.secret, id)), now, id],
  );
  return { id: ins.rows[0]!.id, birthMonth: c.birthMonth };
}

async function insertBlocks(tx: Tx, ctx: Ctx, stylistId: string, appointmentId: string, date: LocalDate, blocks: readonly Block[]) {
  for (const r of blocksToRows(ctx.cfg, date, blocks)) {
    await tx.query(
      `INSERT INTO time_block (tenant_id, stylist_id, appointment_id, seq, phase_key, kind, start_at, end_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [ctx.tenantId, stylistId, appointmentId, r.seq, r.phase_key, r.kind, r.start_at, r.end_at],
    );
  }
}

/** Translate a DB exclusion violation into the user-facing "slot taken" error. */
async function guardOverlap<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (pgCode(e) === PG.EXCLUSION_VIOLATION) throw Errors.slotTaken();
    throw e;
  }
}

const isConflictOnly = (v: Violation[]) => v.every((x) => x.code === 'OVERLAPS_BUSY' || x.code === 'IN_ABSENCE');

export async function activeStylists(q: Queryable, tenantId: string): Promise<{ id: string; displayName: string; color: string }[]> {
  const { rows } = await q.query<{ id: string; display_name: string; color: string }>(
    'SELECT id, display_name, color FROM stylist WHERE tenant_id = $1 AND active ORDER BY sort_order, display_name',
    [tenantId],
  );
  return rows.map((r) => ({ id: r.id, displayName: r.display_name, color: r.color }));
}

async function redeemedYears(q: Queryable, ctx: Ctx, customerId: string, exceptAppointment?: string): Promise<number[]> {
  const { rows } = await q.query<{ year: number }>(
    'SELECT year FROM birthday_redemption WHERE tenant_id = $1 AND customer_id = $2 AND appointment_id IS DISTINCT FROM $3',
    [ctx.tenantId, customerId, exceptAppointment ?? null],
  );
  return rows.map((r) => r.year);
}

type NotifyRow = Pick<AppointmentRow, 'id' | 'ref_code' | 'start_at' | 'end_at' | 'version' | 'service_id' | 'variant' | 'finish'> &
  Partial<Pick<AppointmentRow, 'price_cents_snapshot' | 'price_is_from' | 'birthday_discount' | 'fee_cents' | 'client_note'>>;

export async function notify(
  tx: Tx,
  ctx: Ctx,
  template: Exclude<Template, 'staff_digest' | 'birthday'>,
  a: NotifyRow,
  cust: { firstName: string; lastName: string; email: string | null; phone: string | null },
) {
  // Links only in messages about a still-open appointment. The token is derived (HMAC), never stored in clear.
  const withLink = ['request_received', 'confirmation', 'discuss', 'changed', 'reminder'].includes(template);
  const token = withLink ? manageTokenFor(ctx.secret, a.id) : null;
  const s = fromInstant(a.start_at, ctx.cfg.timeZone);
  const e = fromInstant(a.end_at, ctx.cfg.timeZone);
  await enqueue(tx, ctx, {
    appointmentId: a.id,
    template,
    to: { email: cust.email, phone: cust.phone },
    startAt: a.start_at,
    endAt: a.end_at,
    version: a.version,
    msg: {
      firstName: cust.firstName,
      lastName: cust.lastName,
      date: s.date,
      start: s.minute,
      end: e.minute,
      serviceLabel: serviceLabel(ctx.cfg, { serviceId: a.service_id, variant: a.variant ?? undefined, finish: a.finish }),
      refCode: a.ref_code,
      manageUrl: token ? salonUrl(ctx, `/termin/${token}`) : null,
      restricted: !!findService(ctx.cfg, a.service_id)?.adultOnly,
      price: a.price_cents_snapshot != null ? { cents: a.price_cents_snapshot, isFrom: !!a.price_is_from, birthdayPercent: a.birthday_discount ? ctx.cfg.birthdayDiscount.percent : 0 } : null,
      fee: a.fee_cents ?? null,
      reason: a.client_note ?? null,
    },
  });
}

// ---------- create ----------

export interface CreateInput {
  selection: Selection;
  date: LocalDate;
  start: Minute;
  stylistId?: string | undefined;
  customer: CustomerInput;
  /** Staff: book for an existing client card (D-064) instead of matching by name and contact. */
  customerId?: string | undefined;
  colorNotes?: string | undefined;
  internalNote?: string | undefined;
  /** Required (true) for services with a fee rule when booked online. */
  feeConsent?: boolean | undefined;
  /** Client confirmed having read the privacy notice (Art. 13 DSGVO) – required for online requests. */
  privacyAck?: boolean | undefined;
  /** online = request with client rules; staff = confirmed directly, 5′ grid. */
  source: 'online' | 'staff';
  actor: Actor;
  notifyCustomer?: boolean;
}

export interface CreateResult {
  appointment: AppointmentDto;
  manageToken: string;
}

export async function createAppointment(ctx: Ctx, input: CreateInput, tx?: Tx): Promise<CreateResult> {
  const run = async (t: Tx): Promise<CreateResult> => {
    const selErr = checkSelection(ctx.cfg, input.selection);
    if (selErr === 'AGE_RESTRICTED') throw Errors.ageRestricted();
    if (selErr) throw Errors.invalidSelection(selErr);
    const service = findService(ctx.cfg, input.selection.serviceId)!;
    if (input.source === 'online' && input.privacyAck !== true) {
      throw new AppError('PRIVACY_ACK_REQUIRED', 422, 'Bitte bestätigen Sie, dass Sie die Datenschutzhinweise gelesen haben.');
    }
    if (service.feeRule && input.source === 'online' && input.feeConsent !== true) {
      throw new AppError('FEE_CONSENT_REQUIRED', 422, 'Bitte bestätigen Sie die Ausfallgebühr.');
    }
    // D-062: no age question; the birthday opt-in text asks the client to confirm being at least 16 (Art. 8 DSGVO).
    const customer = input.customerId ? await existingCustomer(t, ctx, input.customerId) : cleanCustomer(input.customer, input.selection.adult !== false);
    const blocks = buildBlocks(service, input.selection, input.start);
    const now = ctx.clock.now();
    const mode = input.source === 'online' ? 'client' : 'staff';

    const stylists = await activeStylists(t, ctx.tenantId);
    const candidates = input.stylistId ? stylists.filter((s) => s.id === input.stylistId) : stylists;
    if (!candidates.length) throw Errors.invalidSelection('UNKNOWN_STYLIST');

    let chosen: string | null = null;
    let lastViolations: Violation[] = [];
    for (const s of candidates) {
      await lockStylistDay(t, s.id, input.date);
      const occ = (await loadOccupancy(t, ctx, [s.id], input.date, 1)).get(input.date)!.get(s.id)!;
      const v = checkPlacement({ config: ctx.cfg, date: input.date, blocks, occupancy: occ, mode, now: salonNow(ctx.clock, ctx.cfg.timeZone), service });
      if (!v.length) {
        chosen = s.id;
        break;
      }
      lastViolations = v;
    }
    if (!chosen) throw isConflictOnly(lastViolations) ? Errors.slotTaken() : Errors.ruleViolation(lastViolations);

    const cust = input.customerId
      ? (await t.query('UPDATE customer SET last_seen_at = $2 WHERE id = $1', [input.customerId, now]), { id: input.customerId, birthMonth: customer.birthMonth })
      : await upsertCustomer(t, ctx, customer, now);
    if (input.privacyAck) {
      await t.query('UPDATE customer SET privacy_ack_at = $2, privacy_ack_version = $3 WHERE id = $1', [cust.id, now, PRIVACY_NOTICE_VERSION]);
    }
    const price = priceFor(await listPrices(t, ctx.tenantId), input.selection);
    const birthday = birthdayDiscountEligible(ctx.cfg, cust.birthMonth, input.date, await redeemedYears(t, ctx, cust.id));
    const id = randomUUID();
    const token = manageTokenFor(ctx.secret, id);
    const rows = blocksToRows(ctx.cfg, input.date, blocks);
    const status: Status = input.source === 'online' ? 'requested' : 'confirmed';
    const fee =
      service.feeRule && (input.feeConsent || input.source === 'staff')
        ? { amountCents: feeAmountCents(service.feeRule, price?.cents ?? null), lateCancelHours: service.feeRule.lateCancelHours }
        : null;
    let appt: AppointmentRow | undefined;
    for (let attempt = 0; !appt; attempt++) {
      try {
        await t.query('SAVEPOINT ref');
        const res = await t.query<AppointmentRow>(
          `INSERT INTO appointment (id, tenant_id, ref_code, stylist_id, customer_id, service_id, audience, variant, finish, adult_declared,
              color_notes, internal_note, status, source, manage_token_hash, age_check_status,
              fee_cents, fee_late_cancel_hours, fee_consent_at, fee_consent_text,
              birthday_discount, price_cents_snapshot, price_is_from, expires_at,
              start_at, end_at, created_at, updated_at)
           VALUES ($27,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$26) RETURNING *`,
          [
            ctx.tenantId,
            newRefCode(),
            chosen,
            cust.id,
            service.id,
            input.selection.audience,
            input.selection.variant ?? (service.variants ? service.defaultVariant : null) ?? null,
            !!input.selection.finish,
            input.selection.adult,
            service.collectsColorNotes ? input.colorNotes?.trim().slice(0, 500) || null : null,
            input.internalNote?.trim().slice(0, 2000) || null,
            status,
            input.source,
            sha256(token),
            'not_required', // D-062: no age check / ID request any more
            fee?.amountCents ?? null,
            fee?.lateCancelHours ?? null,
            fee ? now : null,
            fee ? `${FEE_CONSENT_VERSION}: ${input.source === 'staff' ? '[telefonisch/vor Ort vereinbart] ' : ''}${feeConsentText(fee.amountCents, fee.lateCancelHours)}` : null,
            birthday,
            price?.cents ?? null,
            price?.isFrom ?? false,
            status === 'requested' ? requestExpiresAt(ctx.cfg, now, rows[0]!.start_at) : null,
            rows[0]!.start_at,
            rows.at(-1)!.end_at,
            now,
            id,
          ],
        );
        appt = res.rows[0];
        await t.query('RELEASE SAVEPOINT ref');
      } catch (e) {
        await t.query('ROLLBACK TO SAVEPOINT ref');
        if (pgCode(e) !== PG.UNIQUE_VIOLATION || attempt > 5) throw e;
      }
    }
    await guardOverlap(() => insertBlocks(t, ctx, chosen, appt!.id, input.date, blocks));
    await event(t, ctx, appt!.id, input.actor, 'created', { date: input.date, start: input.start, source: input.source, status });
    if (input.notifyCustomer !== false) {
      await notify(t, ctx, status === 'requested' ? 'request_received' : 'confirmation', appt!, customer);
    }
    const full = await t.query<AppointmentRow>(`${SELECT_APPOINTMENT} WHERE a.tenant_id = $1 AND a.id = $2`, [ctx.tenantId, appt!.id]);
    return { appointment: (await toDtos(t, ctx, full.rows))[0]!, manageToken: token };
  };
  return tx ? guardOverlap(() => run(tx)) : guardOverlap(() => withTx(ctx.db, run));
}

// ---------- read ----------

export async function getById(q: Queryable, ctx: Ctx, id: string, forUpdate = false): Promise<AppointmentRow> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw Errors.notFound();
  const { rows } = await q.query<AppointmentRow>(
    `${SELECT_APPOINTMENT} WHERE a.tenant_id = $1 AND a.id = $2 ${forUpdate ? 'FOR UPDATE OF a' : ''}`,
    [ctx.tenantId, id],
  );
  if (!rows[0]) throw Errors.notFound(); // also for other salons' ids: 404, never 403
  return rows[0];
}

export async function getByToken(q: Queryable, ctx: Ctx, token: string, forUpdate = false): Promise<AppointmentRow> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) throw Errors.invalidLink();
  const { rows } = await q.query<AppointmentRow>(
    `${SELECT_APPOINTMENT} WHERE a.tenant_id = $1 AND a.manage_token_hash = $2 ${forUpdate ? 'FOR UPDATE OF a' : ''}`,
    [ctx.tenantId, sha256(token)],
  );
  if (!rows[0]) throw Errors.invalidLink();
  return rows[0];
}

export async function listInRange(q: Queryable, ctx: Ctx, from: Date, to: Date, stylistIds?: string[], includeInactive = false): Promise<AppointmentDto[]> {
  const { rows } = await q.query<AppointmentRow>(
    `${SELECT_APPOINTMENT}
      WHERE a.tenant_id = $1 AND a.start_at < $3 AND a.end_at > $2
        AND ($4 OR a.status = ANY($5::text[]))
        AND ($6::uuid[] IS NULL OR a.stylist_id = ANY($6::uuid[]))
      ORDER BY a.start_at`,
    [ctx.tenantId, from, to, includeInactive, ACTIVE, stylistIds ?? null],
  );
  return toDtos(q, ctx, rows);
}

export async function listOpenRequests(q: Queryable, ctx: Ctx): Promise<AppointmentDto[]> {
  const { rows } = await q.query<AppointmentRow>(
    `${SELECT_APPOINTMENT} WHERE a.tenant_id = $1 AND a.status IN ('requested', 'discuss') ORDER BY a.created_at`,
    [ctx.tenantId],
  );
  return toDtos(q, ctx, rows);
}

// ---------- self-service (token) ----------

export function selfServiceState(ctx: Ctx, a: Pick<AppointmentRow, 'status' | 'start_at' | 'service_id'>) {
  const service = findService(ctx.cfg, a.service_id);
  const hours = Math.max(ctx.cfg.selfServiceCutoffHours, service?.feeRule?.lateCancelHours ?? 0);
  const cutoff = new Date(a.start_at.getTime() - hours * 3_600_000);
  return { canChange: OPEN.includes(a.status) && canChangeOnline(ctx.cfg, service, a.start_at, ctx.clock.now()), cutoffAt: cutoff };
}

const customerOf = (a: AppointmentRow) => ({ firstName: a.first_name, lastName: a.last_name, email: a.email, phone: a.phone });

export async function cancelByToken(ctx: Ctx, token: string): Promise<void> {
  await withTx(ctx.db, async (tx) => {
    const a = await getByToken(tx, ctx, token, true);
    if (!OPEN.includes(a.status)) throw Errors.notChangeable();
    if (!selfServiceState(ctx, a).canChange) throw Errors.cutoffPassed(ctx.profile.phoneDisplay);
    await deactivate(tx, ctx, a, 'cancelled', 'customer', { cancelReason: 'Vom Kunden abgesagt', template: 'cancelled' });
  });
}

/** Move to an inactive state, free the slot, notify. */
async function deactivate(
  tx: Tx,
  ctx: Ctx,
  a: AppointmentRow,
  status: 'cancelled' | 'declined' | 'expired',
  actor: Actor,
  opts: { cancelReason?: string; declineReason?: string; template: 'cancelled' | 'declined' | 'expired' | null; feeDue?: boolean },
): Promise<AppointmentRow> {
  const now = ctx.clock.now();
  const upd = await tx.query<AppointmentRow>(
    `UPDATE appointment SET status = $3, cancelled_at = CASE WHEN $3 = 'cancelled' THEN $4::timestamptz ELSE cancelled_at END,
            cancel_reason = COALESCE($5, cancel_reason), client_note = COALESCE($6, client_note), client_note_draft = NULL,
            fee_status = CASE WHEN $7 THEN 'due' ELSE fee_status END,
            version = version + 1, updated_at = $4
      WHERE tenant_id = $1 AND id = $2 RETURNING *`,
    [ctx.tenantId, a.id, status, now, opts.cancelReason ?? null, opts.declineReason ?? null, !!opts.feeDue],
  );
  await tx.query('UPDATE time_block SET active = false WHERE tenant_id = $1 AND appointment_id = $2', [ctx.tenantId, a.id]);
  await tx.query('DELETE FROM birthday_redemption WHERE tenant_id = $1 AND appointment_id = $2', [ctx.tenantId, a.id]);
  await dropPendingReminders(tx, a.id);
  await event(tx, ctx, a.id, actor, status, { reason: opts.cancelReason ?? opts.declineReason, feeDue: !!opts.feeDue });
  if (opts.template) await notify(tx, ctx, opts.template, { ...upd.rows[0]!, client_note: opts.declineReason ?? upd.rows[0]!.client_note }, customerOf(a));
  return { ...a, ...upd.rows[0]! };
}

export async function rescheduleByToken(ctx: Ctx, token: string, date: LocalDate, start: Minute): Promise<void> {
  await guardOverlap(() =>
    withTx(ctx.db, async (tx) => {
      const a = await getByToken(tx, ctx, token, true);
      if (!OPEN.includes(a.status)) throw Errors.notChangeable();
      if (!selfServiceState(ctx, a).canChange) throw Errors.cutoffPassed(ctx.profile.phoneDisplay);
      const service = findService(ctx.cfg, a.service_id)!;
      const blocks = buildBlocks(service, selectionOf(a), start);
      const oldDate = fromInstant(a.start_at, ctx.cfg.timeZone).date;
      for (const d of [...new Set([oldDate, date])].sort()) await lockStylistDay(tx, a.stylist_id, d);
      const occ = (await loadOccupancy(tx, ctx, [a.stylist_id], date, 1, a.id)).get(date)!.get(a.stylist_id)!;
      const v = checkPlacement({ config: ctx.cfg, date, blocks, occupancy: occ, mode: 'client', now: salonNow(ctx.clock, ctx.cfg.timeZone), service });
      if (v.length) throw isConflictOnly(v) ? Errors.slotTaken() : Errors.ruleViolation(v);
      // A-16: a confirmed appointment shorter than the threshold stays confirmed; everything else
      // goes back to the salon as a request.
      const keepConfirmed = a.status === 'confirmed' && !rescheduleNeedsReconfirmation(ctx.cfg, totalMinutes(blocks));
      await replaceBlocks(
        tx, ctx, a, a.stylist_id, date, blocks, 'customer',
        keepConfirmed ? { notifyTemplate: 'changed' } : { notifyTemplate: 'request_received', newStatus: 'requested' },
      );
    }),
  );
}

async function replaceBlocks(
  tx: Tx,
  ctx: Ctx,
  a: AppointmentRow,
  stylistId: string,
  date: LocalDate,
  blocks: readonly Block[],
  actor: Actor,
  opts: { notifyTemplate: 'changed' | 'request_received' | null; newStatus?: Status },
): Promise<AppointmentDto> {
  const rows = blocksToRows(ctx.cfg, date, blocks);
  await tx.query('DELETE FROM time_block WHERE tenant_id = $1 AND appointment_id = $2', [ctx.tenantId, a.id]);
  await insertBlocks(tx, ctx, stylistId, a.id, date, blocks);
  const now = ctx.clock.now();
  const status = opts.newStatus ?? a.status;
  // Birthday discount follows the date: re-evaluate when the month may have changed.
  const { rows: bm } = await tx.query<{ birth_month: number | null }>('SELECT birth_month FROM customer WHERE id = $1', [a.customer_id]);
  const birthday = birthdayDiscountEligible(ctx.cfg, bm[0]?.birth_month ?? null, date, await redeemedYears(tx, ctx, a.customer_id, a.id));
  const upd = await tx.query<AppointmentRow>(
    `UPDATE appointment SET start_at = $3, end_at = $4, stylist_id = $5, status = $6, birthday_discount = $7,
            expires_at = CASE WHEN $6 = 'requested' THEN $8::timestamptz ELSE NULL END,
            needs_reassign = (needs_reassign AND stylist_id = $5), -- given to a colleague (D-054)
            version = version + 1, updated_at = $9
      WHERE tenant_id = $1 AND id = $2 RETURNING *`,
    [ctx.tenantId, a.id, rows[0]!.start_at, rows.at(-1)!.end_at, stylistId, status, birthday, requestExpiresAt(ctx.cfg, now, rows[0]!.start_at), now],
  );
  const moved = upd.rows[0]!.start_at.getTime() !== a.start_at.getTime();
  await event(tx, ctx, a.id, actor, moved ? 'rescheduled' : stylistId !== a.stylist_id ? 'reassigned' : 'resized', { date, stylistId, blocks });
  if (moved) {
    await dropPendingReminders(tx, a.id);
    if (opts.notifyTemplate) await notify(tx, ctx, opts.notifyTemplate, upd.rows[0]!, customerOf(a));
  }
  return (await toDtos(tx, ctx, [{ ...a, ...upd.rows[0]! }]))[0]!;
}

// ---------- staff ----------

export async function staffUpdateBlocks(
  ctx: Ctx,
  id: string,
  input: { version: number; date: LocalDate; blocks: Block[]; stylistId?: string | undefined; notifyCustomer?: boolean },
  actor: Actor,
): Promise<AppointmentDto> {
  return guardOverlap(() =>
    withTx(ctx.db, async (tx) => {
      const a = await getById(tx, ctx, id, true);
      if (a.version !== input.version) throw Errors.versionConflict();
      if (!OPEN.includes(a.status)) throw Errors.notChangeable();
      const stylistId = input.stylistId ?? a.stylist_id;
      if (stylistId !== a.stylist_id && !(await activeStylists(tx, ctx.tenantId)).some((s) => s.id === stylistId)) throw Errors.notFound();
      const current = (await blocksOf(tx, ctx, [a.id])).get(a.id)!;
      // Staff may change times, never the structure of the service.
      const sameShape =
        current.blocks.length === input.blocks.length &&
        current.blocks.every((b, i) => b.phase === input.blocks[i]!.phase && b.kind === input.blocks[i]!.kind);
      if (!sameShape) throw Errors.validation({ blocks: 'Phasen dürfen nicht verändert werden.' });
      const locks = [...new Set([`${a.stylist_id}|${current.date}`, `${stylistId}|${input.date}`])].sort();
      for (const l of locks) {
        const [s, d] = l.split('|') as [string, string];
        await lockStylistDay(tx, s, d);
      }
      const occ = (await loadOccupancy(tx, ctx, [stylistId], input.date, 1, a.id)).get(input.date)!.get(stylistId)!;
      const v = checkPlacement({ config: ctx.cfg, date: input.date, blocks: input.blocks, occupancy: occ, mode: 'staff', service: findService(ctx.cfg, a.service_id)! });
      if (v.length) throw Errors.ruleViolation(v);
      return replaceBlocks(tx, ctx, a, stylistId, input.date, input.blocks, actor, {
        notifyTemplate: input.notifyCustomer === false || a.status !== 'confirmed' ? null : 'changed',
      });
    }),
  );
}

export type Decision = 'accept' | 'decline' | 'discuss';

/** Staff answer to a request (D-018). */
export async function staffDecide(ctx: Ctx, id: string, version: number, decision: Decision, actor: Actor, reason?: string): Promise<AppointmentDto> {
  return withTx(ctx.db, async (tx) => {
    const a = await getById(tx, ctx, id, true);
    if (a.version !== version) throw Errors.versionConflict();
    const allowed = decision === 'discuss' ? a.status === 'requested' : a.status === 'requested' || a.status === 'discuss';
    if (!allowed) throw Errors.notChangeable();
    if (decision === 'accept' && a.needs_reassign) {
      throw new AppError('NEEDS_REASSIGN', 409, 'Die Person dieses Termins wurde gelöscht. Bitte den Termin zuerst einer Kollegin oder einem Kollegen geben.');
    }
    if (decision === 'decline') {
      const r = await deactivate(tx, ctx, a, 'declined', actor, { declineReason: reason?.trim().slice(0, 500) || undefined, template: 'declined' });
      return (await toDtos(tx, ctx, [r]))[0]!;
    }
    const status: Status = decision === 'accept' ? 'confirmed' : 'discuss';
    const note = reason?.trim().slice(0, 500) || null;
    const upd = await tx.query<AppointmentRow>(
      `UPDATE appointment SET status = $3, expires_at = NULL, client_note = $5, client_note_draft = NULL, version = version + 1, updated_at = $4
        WHERE tenant_id = $1 AND id = $2 RETURNING *`,
      [ctx.tenantId, a.id, status, ctx.clock.now(), note],
    );
    await event(tx, ctx, a.id, actor, decision === 'accept' ? 'confirmed' : 'discuss', { reason });
    await notify(tx, ctx, decision === 'accept' ? 'confirmation' : 'discuss', upd.rows[0]!, customerOf(a));
    return (await toDtos(tx, ctx, [{ ...a, ...upd.rows[0]! }]))[0]!;
  });
}

/**
 * Save the note to the client of an open request without answering yet (D-057). Staff only: the
 * client sees a note only after the answer (client_note). Optimistic lock like every staff edit.
 */
export async function saveClientNoteDraft(ctx: Ctx, id: string, version: number, note: string, actor: Actor): Promise<AppointmentDto> {
  return withTx(ctx.db, async (tx) => {
    const a = await getById(tx, ctx, id, true);
    if (a.version !== version) throw Errors.versionConflict();
    if (a.status !== 'requested' && a.status !== 'discuss') throw Errors.notChangeable();
    const draft = note.trim().slice(0, 500) || null;
    const upd = await tx.query<AppointmentRow>(
      'UPDATE appointment SET client_note_draft = $3, version = version + 1, updated_at = $4 WHERE tenant_id = $1 AND id = $2 RETURNING *',
      [ctx.tenantId, a.id, draft, ctx.clock.now()],
    );
    await event(tx, ctx, a.id, actor, 'note_draft', { length: draft?.length ?? 0 });
    return (await toDtos(tx, ctx, [{ ...a, ...upd.rows[0]! }]))[0]!;
  });
}

const STATUS_FLOW: Partial<Record<Status, Status[]>> = {
  requested: ['cancelled'],
  discuss: ['cancelled'],
  confirmed: ['completed', 'no_show', 'cancelled'],
  completed: ['confirmed'],
  no_show: ['confirmed'],
  cancelled: ['confirmed'],
  declined: ['requested'],
};

export async function staffSetStatus(
  ctx: Ctx,
  id: string,
  input: { version: number; status: Status; reason?: string | undefined; clientLateCancel?: boolean | undefined },
  actor: Actor,
): Promise<AppointmentDto> {
  return guardOverlap(() =>
    withTx(ctx.db, async (tx) => {
      const a = await getById(tx, ctx, id, true);
      if (a.version !== input.version) throw Errors.versionConflict();
      if (!STATUS_FLOW[a.status]?.includes(input.status)) throw Errors.notChangeable();
      const now = ctx.clock.now();
      const service = findService(ctx.cfg, a.service_id);
      const consented = a.fee_consent_at !== null;
      if ((a.status === 'completed' || a.status === 'no_show') && now.getTime() - a.start_at.getTime() > 7 * 86_400_000) {
        throw Errors.notChangeable(); // undo window 7 days (spec §6)
      }
      if ((input.status === 'completed' || input.status === 'no_show') && a.start_at > now) {
        throw new AppError('NOT_STARTED', 409, 'Der Termin hat noch nicht begonnen.');
      }
      if (input.status === 'cancelled' && fromInstant(a.start_at, ctx.cfg.timeZone).date < salonNow(ctx.clock, ctx.cfg.timeZone).date) {
        // History stays complete: appointments from yesterday backwards cannot be cancelled (owner request 2026-11-07).
        throw new AppError('PAST_LOCKED', 409, 'Vergangene Termine können nicht mehr abgesagt werden. Bitte „Erschienen“ oder „Nicht erschienen“ wählen.');
      }
      if (input.status === 'cancelled') {
        // Fee only if the CLIENT cancelled late (staff records the phone call) – never for salon cancellations.
        const due = !!input.clientLateCancel && feeDue(service, consented, a.start_at, now);
        const r = await deactivate(tx, ctx, a, 'cancelled', actor, {
          cancelReason: input.reason?.trim() || (input.clientLateCancel ? 'Kurzfristige Absage durch Kunden' : 'Vom Salon abgesagt'),
          template: 'cancelled',
          feeDue: due,
        });
        return (await toDtos(tx, ctx, [r]))[0]!;
      }
      if ((input.status === 'confirmed' || input.status === 'requested') && ['cancelled', 'declined'].includes(a.status)) {
        // Undo of a cancellation/decline: re-activate blocks; the exclusion constraint rejects if taken meanwhile.
        await lockStylistDay(tx, a.stylist_id, fromInstant(a.start_at, ctx.cfg.timeZone).date);
        await tx.query('UPDATE time_block SET active = true WHERE tenant_id = $1 AND appointment_id = $2', [ctx.tenantId, a.id]);
      }
      const fee: FeeStatus =
        input.status === 'no_show' && feeDue(service, consented, a.start_at, null) ? 'due' : input.status === 'confirmed' && a.fee_status === 'due' ? 'none' : a.fee_status;
      const upd = await tx.query<AppointmentRow>(
        `UPDATE appointment SET status = $3, fee_status = $4, version = version + 1, updated_at = $5,
                cancelled_at = CASE WHEN $3 IN ('confirmed','requested') THEN NULL ELSE cancelled_at END,
                cancel_reason = CASE WHEN $3 IN ('confirmed','requested') THEN NULL ELSE cancel_reason END
          WHERE tenant_id = $1 AND id = $2 RETURNING *`,
        [ctx.tenantId, a.id, input.status, fee, now],
      );
      // Birthday discount is redeemed when the appointment is completed with it.
      if (input.status === 'completed' && a.birthday_discount) {
        await tx.query(
          'INSERT INTO birthday_redemption (tenant_id, customer_id, year, appointment_id) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING',
          [ctx.tenantId, a.customer_id, Number(fromInstant(a.start_at, ctx.cfg.timeZone).date.slice(0, 4)), a.id],
        );
      }
      if (a.status === 'completed' && input.status === 'confirmed') {
        await tx.query('DELETE FROM birthday_redemption WHERE tenant_id = $1 AND appointment_id = $2', [ctx.tenantId, a.id]);
      }
      await event(tx, ctx, a.id, actor, 'status', { from: a.status, to: input.status, fee });
      return (await toDtos(tx, ctx, [{ ...a, ...upd.rows[0]! }]))[0]!;
    }),
  );
}

export async function staffSetFee(ctx: Ctx, id: string, version: number, status: 'paid' | 'waived' | 'due', actor: Actor): Promise<AppointmentDto> {
  return withTx(ctx.db, async (tx) => {
    const a = await getById(tx, ctx, id, true);
    if (a.version !== version) throw Errors.versionConflict();
    if (a.fee_status === 'none') throw Errors.notChangeable();
    const upd = await tx.query<AppointmentRow>(
      `UPDATE appointment SET fee_status = $3, version = version + 1, updated_at = $4 WHERE tenant_id = $1 AND id = $2 RETURNING *`,
      [ctx.tenantId, a.id, status, ctx.clock.now()],
    );
    await event(tx, ctx, a.id, actor, 'fee', { status });
    return (await toDtos(tx, ctx, [{ ...a, ...upd.rows[0]! }]))[0]!;
  });
}

export async function staffSetNote(ctx: Ctx, id: string, version: number, note: string, actor: Actor): Promise<AppointmentDto> {
  return withTx(ctx.db, async (tx) => {
    const a = await getById(tx, ctx, id, true);
    if (a.version !== version) throw Errors.versionConflict();
    const upd = await tx.query<AppointmentRow>(
      `UPDATE appointment SET internal_note = $3, version = version + 1, updated_at = $4 WHERE tenant_id = $1 AND id = $2 RETURNING *`,
      [ctx.tenantId, a.id, note.trim().slice(0, 2000) || null, ctx.clock.now()],
    );
    await event(tx, ctx, a.id, actor, 'note');
    return (await toDtos(tx, ctx, [{ ...a, ...upd.rows[0]! }]))[0]!;
  });
}

export type AgeCheckAction = 'request' | 'verified' | 'not_verified' | 'not_presented';

/** Age check: records only the outcome – never document data (DSGVO minimisation). */
export async function staffAgeCheck(ctx: Ctx, id: string, version: number, action: AgeCheckAction, staffUserId: string): Promise<AppointmentDto> {
  return withTx(ctx.db, async (tx) => {
    const a = await getById(tx, ctx, id, true);
    if (a.version !== version) throw Errors.versionConflict();
    if (a.age_check_status === 'not_required') throw new AppError('AGE_CHECK_NOT_REQUIRED', 409, 'Für diese Leistung ist keine Altersprüfung nötig.');
    const status: AgeCheckStatus = action === 'request' ? 'requested' : action;
    const now = ctx.clock.now();
    const upd = await tx.query<AppointmentRow>(
      `UPDATE appointment SET age_check_status = $3, age_check_at = $4, age_check_by = $5, version = version + 1, updated_at = $4
        WHERE tenant_id = $1 AND id = $2 RETURNING *`,
      [ctx.tenantId, a.id, status, now, staffUserId],
    );
    await event(tx, ctx, a.id, `staff:${staffUserId}`, 'age_check', { status });
    if (action === 'request') await notify(tx, ctx, 'age_check', upd.rows[0]!, customerOf(a));
    return (await toDtos(tx, ctx, [{ ...a, ...upd.rows[0]! }]))[0]!;
  });
}

export async function eventsOf(q: Queryable, ctx: Ctx, id: string) {
  const { rows } = await q.query<{ at: Date; actor: string; type: string; payload: unknown }>(
    'SELECT at, actor, type, payload FROM appointment_event WHERE tenant_id = $1 AND appointment_id = $2 ORDER BY at, id',
    [ctx.tenantId, id],
  );
  return rows.map((r) => ({ at: r.at.toISOString(), actor: r.actor, type: r.type, payload: r.payload }));
}

/** Worker: expire unanswered requests (D-027). Returns the number expired. */
export async function expireRequests(ctx: Ctx): Promise<number> {
  return withTx(ctx.db, async (tx) => {
    const { rows } = await tx.query<AppointmentRow>(
      `${SELECT_APPOINTMENT} WHERE a.tenant_id = $1 AND a.status = 'requested' AND a.expires_at <= $2 FOR UPDATE OF a SKIP LOCKED`,
      [ctx.tenantId, ctx.clock.now()],
    );
    for (const a of rows) await deactivate(tx, ctx, a, 'expired', 'system', { template: 'expired' });
    return rows.length;
  });
}
