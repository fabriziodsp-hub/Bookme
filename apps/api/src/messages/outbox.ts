import type { Tx } from '../db/pool.js';
import type { Ctx } from '../domain/context.js';
import { buildIcs, eventDescription } from './ics.js';
import { renderMessage, type MessageContext, type Template } from './templates.js';

export interface Recipient {
  email: string | null;
  phone: string | null;
}

export interface RawMessage {
  appointmentId?: string | null;
  channel: 'email' | 'whatsapp';
  recipient: string;
  template: string;
  subject: string;
  body: string;
  attachments?: { filename: string; content: string; contentType: string }[];
  dedupeKey?: string | null;
  sendAfter?: Date;
}

/** Insert one message into the outbox (same transaction as the business change). */
export async function enqueueRaw(tx: Tx, ctx: Ctx, m: RawMessage): Promise<boolean> {
  const r = await tx.query(
    `INSERT INTO outbox_message (tenant_id, appointment_id, channel, recipient, template, subject, body, attachments, dedupe_key, send_after)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING`,
    [
      ctx.tenantId,
      m.appointmentId ?? null,
      m.channel,
      m.recipient,
      m.template,
      m.subject,
      m.body,
      JSON.stringify(m.attachments ?? []),
      m.dedupeKey ?? null,
      m.sendAfter ?? ctx.clock.now(),
    ],
  );
  return (r.rowCount ?? 0) > 0;
}

/** Queue a transactional client message (outbox pattern). */
export async function enqueue(
  tx: Tx,
  ctx: Ctx,
  e: { appointmentId: string; template: Template; to: Recipient; msg: Omit<MessageContext, 'salon'>; startAt: Date; endAt: Date; version: number },
): Promise<void> {
  const m = renderMessage(e.template, { ...e.msg, salon: ctx.profile });
  const withIcs = e.template === 'confirmation' || e.template === 'changed' || e.template === 'cancelled';
  const attachments = withIcs
    ? [
        {
          filename: 'termin.ics',
          contentType: 'text/calendar; charset=utf-8',
          content: buildIcs({
            uid: `${e.appointmentId}@salon-booking`,
            start: e.startAt,
            end: e.endAt,
            summary: e.msg.serviceLabel,
            location: `${ctx.profile.street}, ${ctx.profile.postalCode} ${ctx.profile.city}`,
            description: eventDescription(e.msg.manageUrl, ctx.profile.phoneDisplay),
            now: ctx.clock.now(),
            cancelled: e.template === 'cancelled',
            sequence: e.version,
          }),
        },
      ]
    : [];
  const dedupe = e.template === 'reminder' ? `reminder:${e.appointmentId}` : null;
  if (e.to.email) {
    await enqueueRaw(tx, ctx, { appointmentId: e.appointmentId, channel: 'email', recipient: e.to.email, template: e.template, subject: m.subject, body: m.body, attachments, dedupeKey: dedupe });
  }
  // WhatsApp Business: prepared, off by default (D-029).
  if (ctx.whatsappEnabled && e.to.phone) {
    await enqueueRaw(tx, ctx, { appointmentId: e.appointmentId, channel: 'whatsapp', recipient: e.to.phone, template: e.template, subject: '', body: m.short, dedupeKey: dedupe });
  }
}

/** Drop reminders not yet sent (after a reschedule or cancellation) so a new one can be scheduled. */
export async function dropPendingReminders(tx: Tx, appointmentId: string): Promise<void> {
  await tx.query(`DELETE FROM outbox_message WHERE appointment_id = $1 AND template = 'reminder' AND status = 'pending'`, [appointmentId]);
}
