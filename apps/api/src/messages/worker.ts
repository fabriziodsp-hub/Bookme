/**
 * Background jobs. Safe with several instances (SKIP LOCKED, dedupe keys).
 * Per-salon jobs iterate over active tenants.
 */
import { findService, fromInstant } from '@salon/engine';
import { de } from '@salon/i18n';
import { withTx } from '../db/pool.js';
import { expireRequests, listOpenRequests } from '../domain/appointments.js';
import { salonUrl, tenantCtx, type Ctx, type Deps } from '../domain/context.js';
import { anonymizeCustomer } from '../domain/customers.js';
import { tenantById } from '../domain/tenants.js';
import { manageTokenFor, serviceLabel, unsubscribeTokenFor } from '../domain/util.js';
import { dateTimeInWords } from './format.js';
import type { Mailer, WhatsappSender } from './mailer.js';
import { enqueue, enqueueRaw } from './outbox.js';
import { renderBirthday, renderStaffDigest } from './templates.js';

const MAX_ATTEMPTS = 6;

/** Send due messages of all salons. */
export async function processOutbox(deps: Deps, mailer: Mailer, whatsapp: WhatsappSender, batch = 20): Promise<number> {
  return withTx(deps.db, async (tx) => {
    const { rows } = await tx.query<{
      id: string; channel: 'email' | 'whatsapp'; recipient: string; subject: string; body: string;
      attachments: { filename: string; content: string; contentType: string }[]; attempts: number;
    }>(
      `SELECT id, channel, recipient, subject, body, attachments, attempts FROM outbox_message
        WHERE status = 'pending' AND send_after <= $1 ORDER BY send_after LIMIT $2 FOR UPDATE SKIP LOCKED`,
      [deps.clock.now(), batch],
    );
    for (const m of rows) {
      try {
        if (m.channel === 'email') await mailer.send({ to: m.recipient, subject: m.subject, text: m.body, attachments: m.attachments });
        else await whatsapp.send(m.recipient, m.body);
        await tx.query(`UPDATE outbox_message SET status = 'sent', sent_at = $2, attempts = attempts + 1 WHERE id = $1`, [m.id, deps.clock.now()]);
      } catch (e) {
        const attempts = m.attempts + 1;
        await tx.query(`UPDATE outbox_message SET attempts = $2, last_error = $3, status = $4, send_after = $5 WHERE id = $1`, [
          m.id,
          attempts,
          String((e as Error).message).slice(0, 500),
          attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
          new Date(deps.clock.now().getTime() + 2 ** attempts * 60_000), // 2, 4, 8 … minutes
        ]);
      }
    }
    return rows.length;
  });
}

/** Reminders for confirmed appointments starting within `reminderHoursBefore` (not if booked later than that). */
export async function scheduleReminders(ctx: Ctx): Promise<number> {
  const now = ctx.clock.now();
  const horizon = new Date(now.getTime() + ctx.cfg.reminderHoursBefore * 3_600_000);
  return withTx(ctx.db, async (tx) => {
    const { rows } = await tx.query<{
      id: string; ref_code: string; start_at: Date; end_at: Date; version: number; service_id: string; variant: string | null; finish: boolean;
      price_cents_snapshot: number | null; price_is_from: boolean; birthday_discount: boolean; fee_cents: number | null;
      first_name: string; last_name: string; email: string | null; phone: string | null;
    }>(
      `SELECT a.id, a.ref_code, a.start_at, a.end_at, a.version, a.service_id, a.variant, a.finish, a.price_cents_snapshot, a.price_is_from,
              a.birthday_discount, a.fee_cents, c.first_name, c.last_name, c.email, c.phone
         FROM appointment a JOIN customer c ON c.id = a.customer_id
        WHERE a.tenant_id = $1 AND a.status = 'confirmed' AND a.start_at > $2 AND a.start_at <= $3
          AND a.created_at <= a.start_at - make_interval(hours => $4)
          AND NOT EXISTS (SELECT 1 FROM outbox_message o WHERE o.appointment_id = a.id AND o.template = 'reminder')
        FOR UPDATE OF a SKIP LOCKED`,
      [ctx.tenantId, now, horizon, ctx.cfg.reminderHoursBefore],
    );
    for (const a of rows) {
      const s = fromInstant(a.start_at, ctx.cfg.timeZone);
      const e = fromInstant(a.end_at, ctx.cfg.timeZone);
      await enqueue(tx, ctx, {
        appointmentId: a.id,
        template: 'reminder',
        to: { email: a.email, phone: a.phone },
        startAt: a.start_at,
        endAt: a.end_at,
        version: a.version,
        msg: {
          firstName: a.first_name,
          lastName: a.last_name,
          date: s.date,
          start: s.minute,
          end: e.minute,
          serviceLabel: serviceLabel(ctx.cfg, { serviceId: a.service_id, variant: a.variant ?? undefined, finish: a.finish }),
          refCode: a.ref_code,
          manageUrl: salonUrl(ctx, `/termin/${manageTokenFor(ctx.secret, a.id)}`),
          restricted: !!findService(ctx.cfg, a.service_id)?.adultOnly,
          price: a.price_cents_snapshot != null ? { cents: a.price_cents_snapshot, isFrom: a.price_is_from, birthdayPercent: a.birthday_discount ? ctx.cfg.birthdayDiscount.percent : 0 } : null,
          fee: a.fee_cents,
        },
      });
    }
    return rows.length;
  });
}

/** Staff digest of open requests, at most once per `staffDigestHours` window (D-027). */
export async function staffDigest(ctx: Ctx): Promise<number> {
  const open = await listOpenRequests(ctx.db, ctx);
  if (!open.length) return 0;
  const windowMs = ctx.cfg.staffDigestHours * 3_600_000;
  const slot = Math.floor(ctx.clock.now().getTime() / windowMs);
  const { rows: staff } = await ctx.db.query<{ email: string }>('SELECT email FROM staff_user WHERE tenant_id = $1 AND deleted_at IS NULL', [ctx.tenantId]);
  const msg = renderStaffDigest({
    salon: ctx.profile,
    url: salonUrl(ctx, '/team/anfragen'),
    items: open.map((a) => ({
      refCode: a.refCode,
      when: dateTimeInWords(a.date, a.start),
      name: `${a.customer.firstName} ${a.customer.lastName}`,
      service: a.serviceLabel,
      status: a.status === 'discuss' ? 'Rücksprache' : 'offen',
    })),
  });
  let sent = 0;
  await withTx(ctx.db, async (tx) => {
    for (const s of staff) {
      if (await enqueueRaw(tx, ctx, { channel: 'email', recipient: s.email, template: 'staff_digest', subject: msg.subject, body: msg.body, dedupeKey: `digest:${ctx.tenantId}:${s.email}:${slot}` })) sent++;
    }
  });
  return sent;
}

/** One birthday offer per opted-in adult customer and year, sent in the birth month (D-021). */
export async function birthdayOffers(ctx: Ctx): Promise<number> {
  if (!ctx.cfg.birthdayDiscount.enabled) return 0;
  const today = fromInstant(ctx.clock.now(), ctx.cfg.timeZone).date;
  const [year, month] = today.split('-').map(Number) as [number, number];
  const { rows } = await ctx.db.query<{ id: string; first_name: string; last_name: string; email: string }>(
    `SELECT id, first_name, last_name, email FROM customer
      WHERE tenant_id = $1 AND birth_month = $2 AND birthday_consent_at IS NOT NULL AND marketing_unsubscribed_at IS NULL
        AND anonymized_at IS NULL AND email IS NOT NULL`,
    [ctx.tenantId, month],
  );
  let n = 0;
  await withTx(ctx.db, async (tx) => {
    for (const c of rows) {
      const m = renderBirthday({
        firstName: c.first_name,
        lastName: c.last_name,
        percent: ctx.cfg.birthdayDiscount.percent,
        monthName: de.monthLong[month - 1]!,
        bookUrl: salonUrl(ctx, '/buchen'),
        unsubscribeUrl: salonUrl(ctx, `/abmelden/${unsubscribeTokenFor(ctx.secret, c.id)}`),
        salon: ctx.profile,
      });
      if (await enqueueRaw(tx, ctx, { channel: 'email', recipient: c.email, template: 'birthday', subject: m.subject, body: m.body, dedupeKey: `birthday:${c.id}:${year}` })) n++;
    }
  });
  return n;
}

/** Retention (spec §8): anonymise after 12 months without appointments; purge technical data. */
/**
 * A-07: anonymise customers `cfg.retentionMonths` after their last appointment. Booking data is no
 * Buchungsbeleg (§ 147 AO / § 257 HGB) – those live in the salon's till/accounting – so the
 * DSGVO storage-limitation principle applies. Exception: an open fee claim (fee_status 'due')
 * keeps the customer until the end of the limitation period (§§ 195, 199 BGB).
 */
export async function retention(ctx: Ctx, months = ctx.cfg.retentionMonths): Promise<{ anonymized: number }> {
  const now = ctx.clock.now();
  const cutoff = new Date(now);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - months);
  // claim arising in year Y is time-barred at the end of Y + N → keep claims from years > now.year - N - 1
  const claimYearFloor = now.getUTCFullYear() - ctx.cfg.feeClaimRetentionYears;
  const { rows } = await ctx.db.query<{ id: string }>(
    `SELECT c.id FROM customer c
      WHERE c.tenant_id = $2 AND c.anonymized_at IS NULL AND c.last_seen_at < $1
        AND NOT EXISTS (SELECT 1 FROM appointment a WHERE a.customer_id = c.id AND a.end_at > $1)
        AND NOT EXISTS (SELECT 1 FROM appointment a WHERE a.customer_id = c.id AND a.fee_status = 'due'
                          AND EXTRACT(YEAR FROM a.start_at AT TIME ZONE 'UTC') >= $3)`,
    [cutoff, ctx.tenantId, claimYearFloor],
  );
  for (const r of rows) await anonymizeCustomer(ctx, r.id, 'retention');
  return { anonymized: rows.length };
}

export async function purgeTechnical(deps: Deps): Promise<void> {
  const now = deps.clock.now();
  await deps.db.query(`DELETE FROM outbox_message WHERE status = 'sent' AND sent_at < $1`, [new Date(now.getTime() - 30 * 86_400_000)]);
  await deps.db.query(`DELETE FROM idempotency_key WHERE created_at < $1`, [new Date(now.getTime() - 86_400_000)]);
  await deps.db.query(`DELETE FROM session WHERE expires_at < $1`, [now]);
}

/** Run every per-salon job once for all active salons. */
export async function runTenantJobs(deps: Deps, jobs: ((ctx: Ctx) => Promise<unknown>)[]): Promise<void> {
  const { rows } = await deps.db.query<{ id: string }>('SELECT id FROM tenant WHERE active');
  for (const r of rows) {
    const ctx = tenantCtx(deps, await tenantById(deps, r.id));
    for (const job of jobs) await job(ctx);
  }
}

export function startWorkers(deps: Deps, mailer: Mailer, whatsapp: WhatsappSender, log: (m: string) => void): () => void {
  const safe = (name: string, fn: () => Promise<unknown>) => () => fn().catch((e) => log(`[worker:${name}] ${(e as Error).message}`));
  const timers = [
    setInterval(safe('outbox', () => processOutbox(deps, mailer, whatsapp)), 15_000),
    setInterval(safe('minute', () => runTenantJobs(deps, [expireRequests, scheduleReminders])), 60_000),
    setInterval(safe('digest', () => runTenantJobs(deps, [staffDigest])), 10 * 60_000),
    setInterval(safe('daily', async () => {
      await runTenantJobs(deps, [birthdayOffers, retention]);
      await purgeTechnical(deps);
    }), 6 * 3_600_000),
  ];
  return () => timers.forEach(clearInterval);
}
