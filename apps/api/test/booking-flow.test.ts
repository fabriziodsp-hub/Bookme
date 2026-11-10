import { beforeEach, describe, expect, it } from 'vitest';
import { expireRequests } from '../src/domain/appointments.js';
import { scheduleReminders, staffDigest } from '../src/messages/worker.js';
import { asStaff, book, call, customer, login, outbox, resetDb, setup } from './helpers.js';

beforeEach(resetDb);

describe('online request → staff decision (D-018)', () => {
  it('reserves the slot, informs the client, and confirms with .ics', async () => {
    const { app, slug, tenantId } = await setup();
    const cfg = await call(app, 'GET', `/api/s/${slug}/config`);
    expect(cfg.status).toBe(200);
    expect(cfg.json.config.timeZone).toBe('Europe/Berlin');

    const q = 'serviceId=cut&audience=women&adult=true&variant=dry&from=2026-11-03&days=1';
    const before = await call(app, 'GET', `/api/s/${slug}/availability?${q}`);
    expect(before.json.days[0].slots.map((s: any) => s.start)).toContain(540);

    const r = await book(app, slug, {});
    expect(r.status).toBe(201);
    expect(r.json.appointment).toMatchObject({ status: 'requested', date: '2026-11-03', start: 540, end: 570, canChange: true });
    expect(r.json.manageToken).toMatch(/^[\w-]{40,}$/);

    // slot is reserved while the request is open
    const after = await call(app, 'GET', `/api/s/${slug}/availability?${q}`);
    expect(after.json.days[0].slots.map((s: any) => s.start)).not.toContain(540);

    let mails = await outbox(tenantId);
    expect(mails).toHaveLength(1);
    expect(mails[0]!.template).toBe('request_received');
    expect(mails[0]!.subject).toContain('noch nicht bestätigt');
    expect(mails[0]!.body).toContain('Di., 3. November 2026, 09:00 Uhr');
    expect(mails[0]!.body).toContain(`/${slug}/termin/${r.json.manageToken}`);

    // .ics only once confirmed
    expect((await call(app, 'GET', `/api/s/${slug}/appointments/${r.json.manageToken}/calendar.ics`)).status).toBe(404);

    const sid = await login(app, `s1@${slug}.test`);
    const reqs = await call(app, 'GET', '/api/staff/requests', undefined, asStaff(sid));
    expect(reqs.json.requests).toHaveLength(1);
    const a = reqs.json.requests[0];
    const ok = await call(app, 'POST', `/api/staff/appointments/${a.id}/decision`, { version: a.version, decision: 'accept' }, asStaff(sid));
    expect(ok.status).toBe(200);
    expect(ok.json.status).toBe('confirmed');

    mails = await outbox(tenantId);
    const conf = mails.find((m) => m.template === 'confirmation')!;
    expect(conf.attachments).toHaveLength(1);
    expect(conf.body).toContain(r.json.manageToken); // same link keeps working

    const view = await call(app, 'GET', `/api/s/${slug}/appointments/${r.json.manageToken}`);
    expect(view.json.status).toBe('confirmed');
    const ics = await app.request(`/api/s/${slug}/appointments/${r.json.manageToken}/calendar.ics`);
    expect(ics.status).toBe(200);
    const text = await ics.text();
    expect(text).toContain('DTSTART:20261103T080000Z');
    // minimal event: service as title, details only link + phone (no time-zone or booking-number text)
    expect(text).toMatch(/SUMMARY:[^\r\n]+\r\n/);
    expect(text).not.toMatch(/SUMMARY:.*:/);
    expect(text.replace(/\r\n /g, '')).toContain(`/termin/${r.json.manageToken}`);
    expect(text).not.toMatch(/Berlin|Buchungsnummer/);
  });

  it('decline frees the slot; discuss keeps it', async () => {
    const { app, slug, tenantId } = await setup();
    const r1 = await book(app, slug, { start: '09:00' });
    const r2 = await book(app, slug, { start: '10:00', customer: { ...customer, email: 'b@example.com', lastName: 'Zwei' } });
    expect(r2.status).toBe(201);
    const sid = await login(app, `s1@${slug}.test`);
    const reqs = (await call(app, 'GET', '/api/staff/requests', undefined, asStaff(sid))).json.requests;
    const [a1, a2] = reqs;
    const d = await call(app, 'POST', `/api/staff/appointments/${a1.id}/decision`, { version: a1.version, decision: 'decline', reason: 'Krankheit' }, asStaff(sid));
    expect(d.json.status).toBe('declined');
    const di = await call(app, 'POST', `/api/staff/appointments/${a2.id}/decision`, { version: a2.version, decision: 'discuss' }, asStaff(sid));
    expect(di.json.status).toBe('discuss');
    const av = await call(app, 'GET', `/api/s/${slug}/availability?serviceId=cut&audience=women&adult=true&variant=dry&from=2026-11-03&days=1`);
    const starts = av.json.days[0].slots.map((s: any) => s.start);
    expect(starts).toContain(540);
    expect(starts).not.toContain(600);
    const mails = await outbox(tenantId);
    expect(mails.find((m) => m.template === 'declined')!.body).toContain('Notiz vom Salon:\nKrankheit');
    expect(mails.find((m) => m.template === 'discuss')).toBeTruthy();
    expect(r1.status).toBe(201);
  });

  it('unanswered requests expire after 48 h and free the slot (D-027)', async () => {
    const { app, slug, ctx, clock, tenantId } = await setup();
    await book(app, slug, { date: '2026-11-10', start: '09:00' });
    clock.advanceMinutes(47 * 60);
    expect(await expireRequests(ctx)).toBe(0);
    clock.advanceMinutes(61);
    expect(await expireRequests(ctx)).toBe(1);
    const { rows } = await ctx.db.query('SELECT status FROM appointment WHERE tenant_id = $1', [tenantId]);
    expect(rows[0].status).toBe('expired');
    expect((await outbox(tenantId)).map((m) => m.template)).toContain('expired');
    expect((await book(app, slug, { date: '2026-11-10', start: '09:00', customer: { ...customer, email: 'c@example.com' } })).status).toBe(201);
  });

  it('staff digest: at most one per 6 h window and staff member', async () => {
    const { app, slug, ctx, clock, tenantId } = await setup({ stylists: 2 });
    await book(app, slug, {});
    expect(await staffDigest(ctx)).toBe(2);
    clock.advanceMinutes(60);
    expect(await staffDigest(ctx)).toBe(0);
    clock.advanceMinutes(6 * 60);
    expect(await staffDigest(ctx)).toBe(2);
    expect((await outbox(tenantId)).filter((m) => m.template === 'staff_digest')).toHaveLength(4);
  });

  it('reminder 24 h before confirmed appointments only', async () => {
    const { app, slug, ctx, clock, tenantId } = await setup();
    await book(app, slug, { date: '2026-11-05', start: '09:00' });
    const sid = await login(app, `s1@${slug}.test`);
    const a = (await call(app, 'GET', '/api/staff/requests', undefined, asStaff(sid))).json.requests[0];
    clock.set('2026-11-04T09:00:00Z'); // 23 h before
    expect(await scheduleReminders(ctx)).toBe(0); // still a request
    const sid2 = await login(app, `s1@${slug}.test`); // the old session expired (12 h TTL)
    expect((await call(app, 'GET', '/api/staff/requests', undefined, asStaff(sid))).status).toBe(401);
    const acc = await call(app, 'POST', `/api/staff/appointments/${a.id}/decision`, { version: a.version, decision: 'accept' }, asStaff(sid2));
    expect(acc.json.status).toBe('confirmed');
    expect(await scheduleReminders(ctx)).toBe(1);
    expect(await scheduleReminders(ctx)).toBe(0); // dedupe
    expect((await outbox(tenantId)).filter((m) => m.template === 'reminder')).toHaveLength(1);
  });
});

describe('validation and abuse protection', () => {
  it('rejects missing contact, minors with colour, Balayage without fee consent, honeypot, bad proof-of-work', async () => {
    const { app, slug } = await setup();
    const noContact = await book(app, slug, { customer: { firstName: 'A', lastName: 'B' } });
    expect(noContact.status).toBe(400);
    expect(noContact.json.error.details.fieldErrors.contact).toBeTruthy();
    const minor = await book(app, slug, { selection: { serviceId: 'color_root', audience: 'women', adult: false } });
    expect(minor.json.error.code).toBe('AGE_RESTRICTED');
    const bal = await book(app, slug, { selection: { serviceId: 'balayage', audience: 'women', adult: true }, date: '2026-11-10', start: '08:00' });
    expect(bal.json.error.code).toBe('FEE_CONSENT_REQUIRED');
    const balOk = await book(app, slug, { selection: { serviceId: 'balayage', audience: 'women', adult: true }, date: '2026-11-10', start: '08:00', feeConsent: true });
    expect(balOk.status).toBe(201);
    expect(balOk.json.appointment.fee).toEqual({ cents: 6900, lateCancelHours: 48 }); // no price list in the test salon → labour part only
    expect((await book(app, slug, { website: 'http://spam' })).status).toBe(400);
    const p = await book(app, slug, {});
    expect(p.status).toBe(201);
    const badPow = await call(app, 'POST', `/api/s/${slug}/bookings`, {
      selection: { serviceId: 'cut', audience: 'women', adult: true },
      date: '2026-11-04',
      start: '09:00',
      customer,
      pow: { challenge: 'x', salt: 'y', number: 1, signature: 'z' },
    });
    expect(badPow.json.error.details.pow).toBeTruthy();
    const offGrid = await book(app, slug, { start: '09:05', date: '2026-11-04' });
    expect(offGrid.json.error.code).toBe('RULE_VIOLATION');
    const brk = await book(app, slug, { start: '11:45', date: '2026-11-04' });
    expect(brk.json.error.code).toBe('RULE_VIOLATION');
    const sunday = await book(app, slug, { date: '2026-11-08' });
    expect(sunday.json.error.code).toBe('RULE_VIOLATION');
    expect((await call(app, 'GET', '/api/s/nope-salon/config')).status).toBe(404);
  });

  it('idempotency: same key → one appointment; same key + other data → 422', async () => {
    const { app, slug, tenantId, ctx } = await setup();
    const key = { 'idempotency-key': 'abc-123-xyz' };
    const a = await book(app, slug, {}, key);
    const b = await book(app, slug, {}, key);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(b.json.manageToken).toBe(a.json.manageToken);
    const { rows } = await ctx.db.query('SELECT count(*)::int AS n FROM appointment WHERE tenant_id = $1', [tenantId]);
    expect(rows[0].n).toBe(1);
    const c = await book(app, slug, { start: '10:00' }, key);
    expect(c.json.error.code).toBe('IDEMPOTENCY_MISMATCH');
  });
});

describe('self-service via management link', () => {
  it('cancel until cut-off; after cut-off the phone number is shown', async () => {
    const { app, slug, clock } = await setup();
    const r = await book(app, slug, { date: '2026-11-04', start: '09:00' });
    const t = r.json.manageToken;
    clock.set('2026-11-03T20:30:00Z'); // 11.5 h before (08:00Z start) → past 12 h cut-off
    const late = await call(app, 'POST', `/api/s/${slug}/appointments/${t}/cancel`);
    expect(late.json.error.code).toBe('CUTOFF_PASSED');
    expect(late.json.error.message).toContain('030 123 45 67');
    clock.set('2026-11-03T10:00:00Z');
    const ok = await call(app, 'POST', `/api/s/${slug}/appointments/${t}/cancel`);
    expect(ok.json.status).toBe('cancelled');
    expect((await call(app, 'POST', `/api/s/${slug}/appointments/${t}/cancel`)).json.error.code).toBe('NOT_CHANGEABLE');
  });

  it('Balayage: online changes close 48 h before', async () => {
    const { app, slug, clock } = await setup();
    const r = await book(app, slug, { selection: { serviceId: 'balayage', audience: 'women', adult: true }, date: '2026-11-10', start: '08:00', feeConsent: true });
    clock.set('2026-11-08T08:00:00Z'); // 47 h before 07:00Z start
    expect((await call(app, 'POST', `/api/s/${slug}/appointments/${r.json.manageToken}/cancel`)).json.error.code).toBe('CUTOFF_PASSED');
  });

  it('reschedule of a confirmed appointment under 60 minutes stays confirmed (A-16)', async () => {
    const { app, slug, tenantId } = await setup();
    const r = await book(app, slug, { date: '2026-11-04', start: '09:00' }); // cut dry: 30 min
    const sid = await login(app, `s1@${slug}.test`);
    const a = (await call(app, 'GET', '/api/staff/requests', undefined, asStaff(sid))).json.requests[0];
    await call(app, 'POST', `/api/staff/appointments/${a.id}/decision`, { version: a.version, decision: 'accept' }, asStaff(sid));
    const re = await call(app, 'POST', `/api/s/${slug}/appointments/${r.json.manageToken}/reschedule`, { date: '2026-11-05', start: '10:00' });
    expect(re.status).toBe(200);
    expect(re.json).toMatchObject({ status: 'confirmed', date: '2026-11-05', start: 600 });
    expect((await outbox(tenantId)).map((m) => m.template)).toContain('changed');
  });

  it('reschedule of a confirmed appointment of 60 minutes or more needs re-confirmation (A-16)', async () => {
    const { app, slug } = await setup();
    const r = await book(app, slug, { date: '2026-11-04', start: '09:00', selection: { serviceId: 'color_root', audience: 'women', adult: true } }); // 105 min
    const sid = await login(app, `s1@${slug}.test`);
    const a = (await call(app, 'GET', '/api/staff/requests', undefined, asStaff(sid))).json.requests[0];
    await call(app, 'POST', `/api/staff/appointments/${a.id}/decision`, { version: a.version, decision: 'accept' }, asStaff(sid));
    const re = await call(app, 'POST', `/api/s/${slug}/appointments/${r.json.manageToken}/reschedule`, { date: '2026-11-05', start: '10:00' });
    expect(re.status).toBe(200);
    expect(re.json).toMatchObject({ status: 'requested', date: '2026-11-05', start: 600 });
    const avail = await call(app, 'GET', `/api/s/${slug}/appointments/${r.json.manageToken}/availability?from=2026-11-04&days=1`);
    expect(avail.json.days[0].slots.map((s: any) => s.start)).toContain(540); // old slot free again
  });

  it('invalid tokens get a neutral 404', async () => {
    const { app, slug } = await setup();
    const r = await call(app, 'GET', `/api/s/${slug}/appointments/${'x'.repeat(43)}`);
    expect(r.status).toBe(404);
    expect(r.json.error.code).toBe('INVALID_LINK');
  });
});
