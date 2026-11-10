import { beforeEach, describe, expect, it } from 'vitest';
import { birthdayOffers, retention } from '../src/messages/worker.js';
import { asStaff, book, call, customer, db, login, outbox, resetDb, setup } from './helpers.js';

beforeEach(resetDb);

async function staffSetup(opts: Parameters<typeof setup>[0] = {}) {
  const s = await setup({ stylists: 2, limitScale: 10, ...opts });
  const owner = await login(s.app, `s1@${s.slug}.test`);
  const api = (method: string, path: string, body?: unknown) => call(s.app, method, `/api/staff${path}`, body, asStaff(owner));
  const create = (body: Record<string, unknown>) =>
    api('POST', '/appointments', {
      selection: { serviceId: 'cut', audience: 'women', adult: true, variant: 'dry' },
      date: '2026-11-03',
      start: 540,
      stylistId: s.stylistIds[0],
      customer,
      ...body,
    });
  return { ...s, owner, api, create };
}

describe('staff calendar operations', () => {
  it('staff-created appointments are confirmed directly and may use the 5′ grid', async () => {
    const { create } = await staffSetup();
    const r = await create({ start: 545 });
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ status: 'confirmed', start: 545, end: 575, source: 'staff' });
  });

  it('drag & drop rules: move, resize a phase, invalid → 422 with reason', async () => {
    const { create, api } = await staffSetup();
    const a = (await create({ selection: { serviceId: 'color_root', audience: 'women', adult: true } })).json;
    // resize processing +10′ → styling shifts
    const blocks = a.blocks.map((b: any, i: number) => (i === 1 ? { ...b, end: b.end + 10 } : i === 2 ? { ...b, start: b.start + 10, end: b.end + 10 } : b));
    const r = await api('PATCH', `/appointments/${a.id}/blocks`, { version: a.version, date: a.date, blocks });
    expect(r.status).toBe(200);
    expect(r.json.blocks[2]).toMatchObject({ start: 625, end: 655 });
    // move into the break
    const bad = await api('PATCH', `/appointments/${a.id}/blocks`, {
      version: r.json.version,
      date: a.date,
      blocks: r.json.blocks.map((b: any) => ({ ...b, start: b.start + 120, end: b.end + 120 })),
    });
    expect(bad.status).toBe(422);
    expect(bad.json.error.details.map((v: any) => v.code)).toContain('IN_BREAK');
    // changing the structure is not allowed
    const shape = await api('PATCH', `/appointments/${a.id}/blocks`, { version: r.json.version, date: a.date, blocks: r.json.blocks.slice(0, 2) });
    expect(shape.status).toBe(400);
  });

  it('team view: reassign to another stylist by dropping into their column', async () => {
    const { create, api, stylistIds } = await staffSetup();
    const a = (await create({})).json;
    const r = await api('PATCH', `/appointments/${a.id}/blocks`, { version: a.version, date: a.date, blocks: a.blocks, stylistId: stylistIds[1] });
    expect(r.status).toBe(200);
    expect(r.json.stylistId).toBe(stylistIds[1]);
    const mine = await api('GET', `/calendar?from=2026-11-03&days=1&stylistId=${stylistIds[0]}`);
    expect(mine.json.appointments).toHaveLength(0);
    const team = await api('GET', '/calendar?from=2026-11-03&days=1');
    expect(team.json.appointments).toHaveLength(1);
    expect(team.json.stylists).toHaveLength(2);
  });

  it('absences: rejected over appointments (incl. Einwirkzeit), block new bookings', async () => {
    const { app, slug, create, api, stylistIds } = await staffSetup({ stylists: 1 });
    await create({ selection: { serviceId: 'color_root', audience: 'women', adult: true } }); // 09:00–10:45, processing 09:45–10:15
    const clash = await api('POST', '/absences', { stylistId: stylistIds[0], from: { date: '2026-11-03', minute: 590 }, to: { date: '2026-11-03', minute: 600 }, kind: 'other' });
    expect(clash.status).toBe(409);
    expect(clash.json.error.details.appointments).toHaveLength(1);
    const ok = await api('POST', '/absences', { stylistId: stylistIds[0], from: { date: '2026-11-04', minute: 0 }, to: { date: '2026-11-04', minute: 1440 }, kind: 'vacation' });
    expect(ok.status).toBe(201);
    expect((await book(app, slug, { date: '2026-11-04' })).json.error.code).toBe('SLOT_TAKEN');
    expect((await api('DELETE', `/absences/${ok.json.id}`)).status).toBe(204);
    expect((await book(app, slug, { date: '2026-11-04' })).status).toBe(201);
  });

  it('no-show only after start; undo within 7 days', async () => {
    const { create, api, clock, app, slug } = await staffSetup();
    const a = (await create({})).json;
    expect((await api('POST', `/appointments/${a.id}/status`, { version: a.version, status: 'no_show' })).json.error.code).toBe('NOT_STARTED');
    clock.set('2026-11-03T08:30:00Z');
    const sid = await login(app, `s1@${slug}.test`);
    const ns = await call(app, 'POST', `/api/staff/appointments/${a.id}/status`, { version: a.version, status: 'no_show' }, asStaff(sid));
    expect(ns.json.status).toBe('no_show');
    expect(ns.json.fee).toBeNull(); // no fee rule for a haircut
    const undo = await call(app, 'POST', `/api/staff/appointments/${a.id}/status`, { version: ns.json.version, status: 'confirmed' }, asStaff(sid));
    expect(undo.json.status).toBe('confirmed');
    const ns2 = await call(app, 'POST', `/api/staff/appointments/${a.id}/status`, { version: undo.json.version, status: 'no_show' }, asStaff(sid));
    clock.set('2026-11-11T08:30:00Z');
    const sid2 = await login(app, `s1@${slug}.test`);
    const late = await call(app, 'POST', `/api/staff/appointments/${a.id}/status`, { version: ns2.json.version, status: 'confirmed' }, asStaff(sid2));
    expect(late.json.error.code).toBe('NOT_CHANGEABLE'); // undo window 7 days
    const search = await call(app, 'GET', '/api/staff/customers?q=Muster', undefined, asStaff(sid2));
    expect(search.json.customers[0].noShowCount).toBe(1);
  });
});

describe('Balayage fee (D-020)', () => {
  it('amount follows the formula and the salon price (labour only without price)', async () => {
    const { app, slug, tenantId } = await setup({ limitScale: 10 });
    expect((await call(app, 'GET', `/api/s/${slug}/config`)).json.feeAmountCents).toEqual({ balayage: 6900 });
    await db().query(`INSERT INTO price (tenant_id, service_id, variant, price_cents, is_from) VALUES ($1, 'balayage', '', 19000, true)`, [tenantId]);
    const cfg = (await call(app, 'GET', `/api/s/${slug}/config`)).json;
    expect(cfg.feeAmountCents).toEqual({ balayage: 9700 });
    expect(cfg.feeConsentText.balayage).toMatch(/97\s€/);
  });

  it('no-show with consent → fee due → paid', async () => {
    const { app, slug, clock, tenantId } = await setup({ limitScale: 10 });
    await db().query(`INSERT INTO price (tenant_id, service_id, variant, price_cents, is_from) VALUES ($1, 'balayage', '', 19000, true)`, [tenantId]);
    const r = await book(app, slug, { selection: { serviceId: 'balayage', audience: 'women', adult: true }, date: '2026-11-10', start: '08:00', feeConsent: true });
    expect((await outbox(tenantId))[0]!.body).toMatch(/Ausfallgebühr von 97\s€/);
    clock.set('2026-11-10T08:00:00Z');
    const sid = await login(app, `s1@${slug}.test`);
    let a = (await call(app, 'GET', '/api/staff/requests', undefined, asStaff(sid))).json.requests[0];
    a = (await call(app, 'POST', `/api/staff/appointments/${a.id}/decision`, { version: a.version, decision: 'accept' }, asStaff(sid))).json;
    a = (await call(app, 'POST', `/api/staff/appointments/${a.id}/status`, { version: a.version, status: 'no_show' }, asStaff(sid))).json;
    expect(a.status).toBe('no_show');
    expect(a.fee).toMatchObject({ cents: 9700, status: 'due' });
    a = (await call(app, 'POST', `/api/staff/appointments/${a.id}/fee`, { version: a.version, status: 'paid' }, asStaff(sid))).json;
    expect(a.fee.status).toBe('paid');
    const { rows } = await db().query('SELECT fee_consent_text FROM appointment WHERE id = $1', [a.id]);
    expect(rows[0].fee_consent_text).toMatch(/^fee-v1: .*geringerer Schaden/);
    expect(r.status).toBe(201);
  });

  it('client cancels by phone < 48 h → due; > 48 h → none; salon cancellation never', async () => {
    const { app, slug, clock } = await setup({ limitScale: 10 });
    const sel = { serviceId: 'balayage', audience: 'women', adult: true };
    await book(app, slug, { selection: sel, date: '2026-11-10', start: '08:00', feeConsent: true });
    await book(app, slug, { selection: sel, date: '2026-11-11', start: '08:00', feeConsent: true, customer: { ...customer, email: 'b@example.com' } });
    await book(app, slug, { selection: sel, date: '2026-11-12', start: '08:00', feeConsent: true, customer: { ...customer, email: 'c@example.com' } });
    clock.set('2026-11-09T12:00:00Z');
    const sid = await login(app, `s1@${slug}.test`);
    const [a, b, c] = (await call(app, 'GET', '/api/staff/requests', undefined, asStaff(sid))).json.requests;
    const cancel = (x: any, late: boolean) => call(app, 'POST', `/api/staff/appointments/${x.id}/status`, { version: x.version, status: 'cancelled', clientLateCancel: late }, asStaff(sid));
    expect((await cancel(a, true)).json.fee.status).toBe('due'); // 19 h before
    expect((await cancel(b, true)).json.fee.status).toBe('due'); // 43 h before
    expect((await cancel(c, false)).json.fee.status).toBe('none'); // salon cancels
  });
});

describe('birthday discount (D-021)', () => {
  it('flags the appointment in the birth month, redeems once per year, offer mail with unsubscribe', async () => {
    const { app, slug, ctx, clock, tenantId } = await setup({ limitScale: 10 });
    const c = { ...customer, birthMonth: 11 };
    const r1 = await book(app, slug, { customer: c, date: '2026-11-03' });
    expect(r1.json.appointment.price).toBeNull(); // no price list yet
    const sid = await login(app, `s1@${slug}.test`);
    await call(app, 'PUT', '/api/staff/admin/prices', { prices: [{ serviceId: 'cut', priceCents: 3000 }] }, asStaff(sid));
    const r2 = await book(app, slug, { customer: c, date: '2026-11-05' });
    expect(r2.json.appointment.price).toEqual({ cents: 3000, isFrom: false, birthdayDiscount: true });
    expect((await outbox(tenantId)).at(-1)!.body).toMatch(/Geburtstagsrabatt \(10 %\): 27\s€/);

    // complete the first → redeemed; a new booking in November is no longer discounted
    clock.set('2026-11-03T09:00:00Z');
    const sid2 = await login(app, `s1@${slug}.test`);
    let [a] = (await call(app, 'GET', '/api/staff/requests', undefined, asStaff(sid2))).json.requests;
    a = (await call(app, 'POST', `/api/staff/appointments/${a.id}/decision`, { version: a.version, decision: 'accept' }, asStaff(sid2))).json;
    await call(app, 'POST', `/api/staff/appointments/${a.id}/status`, { version: a.version, status: 'completed' }, asStaff(sid2));
    const r3 = await book(app, slug, { customer: c, date: '2026-11-20' });
    expect(r3.json.appointment.price.birthdayDiscount).toBe(false);

    // minors never get the offer (no marketing consent from minors)
    const minor = await book(app, slug, { customer: { ...customer, email: 'kid@example.com', lastName: 'Kind', birthMonth: 11 }, selection: { serviceId: 'cut', audience: 'women', adult: false, variant: 'dry' }, date: '2026-11-24' });
    const { rows } = await db().query("SELECT birth_month FROM customer WHERE email = 'kid@example.com'");
    expect(rows[0].birth_month).toBeNull();
    expect(minor.status).toBe(201);

    clock.set('2026-11-01T08:00:00Z');
    expect(await birthdayOffers(ctx)).toBe(1);
    expect(await birthdayOffers(ctx)).toBe(0); // once per year
    const mail = (await outbox(tenantId)).find((m) => m.template === 'birthday')!;
    const token = /abmelden\/([\w-]+)/.exec(mail.body)![1];
    expect((await call(app, 'POST', `/api/s/${slug}/unsubscribe/${token}`)).status).toBe(200);
    const after = await db().query("SELECT birth_month, marketing_unsubscribed_at FROM customer WHERE email = 'anna@example.com'");
    expect(after.rows[0].birth_month).toBeNull();
    expect(after.rows[0].marketing_unsubscribed_at).not.toBeNull();
  });
});

describe('age check (outcome only)', () => {
  it('request sends a short message; outcomes are stored without document data', async () => {
    const { create, api, tenantId } = await staffSetup();
    const a = (await create({ selection: { serviceId: 'color_root', audience: 'women', adult: true } })).json;
    expect(a.ageCheck.status).toBe('open');
    const r = await api('POST', `/appointments/${a.id}/age-check`, { version: a.version, action: 'request' });
    expect(r.json.ageCheck.status).toBe('requested');
    expect((await outbox(tenantId)).find((m) => m.template === 'age_check')!.body).toContain('amtlichen Ausweis');
    const v = await api('POST', `/appointments/${a.id}/age-check`, { version: r.json.version, action: 'verified' });
    expect(v.json.ageCheck.status).toBe('verified');
    const cut = (await create({ start: 690 })).json;
    expect((await api('POST', `/appointments/${cut.id}/age-check`, { version: cut.version, action: 'request' })).status).toBe(409);
    const cols = await db().query("SELECT column_name FROM information_schema.columns WHERE table_name = 'appointment' AND column_name ~ '(document|birth_date|date_of_birth|id_number)'");
    expect(cols.rows).toHaveLength(0);
  });
});

describe('owner admin', () => {
  it('price list: validated, variant-specific price wins', async () => {
    const { api, app, slug } = await staffSetup();
    expect((await api('PUT', '/admin/prices', { prices: [{ serviceId: 'nope', priceCents: 1 }] })).status).toBe(400);
    const ok = await api('PUT', '/admin/prices', {
      prices: [
        { serviceId: 'cut', priceCents: 3000 },
        { serviceId: 'cut', variant: 'wash', priceCents: 4500, isFrom: true },
        { serviceId: 'color_root', priceCents: 6900, finishSurchargeCents: 1500 },
      ],
    });
    expect(ok.json.prices).toHaveLength(3);
    const blow = await book(app, slug, { selection: { serviceId: 'cut', audience: 'women', adult: true, variant: 'wash' } });
    expect(blow.json.appointment.price).toMatchObject({ cents: 4500, isFrom: true });
    const col = await book(app, slug, { selection: { serviceId: 'color_root', audience: 'women', adult: true, finish: true }, start: '13:00', customer: { ...customer, email: 'q@example.com' } });
    expect(col.json.appointment.price.cents).toBe(8400);
  });

  it('opening hours: dry run lists conflicts, saving keeps appointments', async () => {
    const { api, create } = await staffSetup();
    await create({ start: 960 }); // 16:00 Tue
    const hours = { mon: { open: '08:00', close: '17:00', breaks: [['12:00', '13:00']] }, tue: { open: '09:00', close: '15:00', breaks: [] }, wed: null, thu: null, fri: null, sat: null, sun: null };
    const dry = await api('PUT', '/admin/opening-hours', { dryRun: true, weeklyHours: hours });
    expect(dry.json.conflicts).toHaveLength(1);
    const bad = await api('PUT', '/admin/opening-hours', { dryRun: false, weeklyHours: { ...hours, tue: { open: '15:00', close: '09:00', breaks: [] } } });
    expect(bad.status).toBe(400);
    await api('PUT', '/admin/opening-hours', { dryRun: false, weeklyHours: hours });
    const cal = await api('GET', '/calendar?from=2026-11-03&days=1');
    expect(cal.json.appointments).toHaveLength(1);
  });

  it('client data: export (Art. 15) and anonymisation (Art. 17), owner only', async () => {
    const { api, create, app, slug } = await staffSetup();
    const a = (await create({})).json;
    const exp = await api('GET', `/customers/${a.customer.id}/export`);
    expect(exp.json.customer.email).toBe('anna@example.com');
    const stylist = await login(app, `s2@${slug}.test`);
    expect((await call(app, 'POST', `/api/staff/customers/${a.customer.id}/anonymize`, undefined, asStaff(stylist))).status).toBe(403);
    expect((await api('POST', `/customers/${a.customer.id}/anonymize`)).status).toBe(204);
    const { rows } = await db().query('SELECT first_name, email, phone FROM customer WHERE id = $1', [a.customer.id]);
    expect(rows[0]).toEqual({ first_name: 'Gelöscht', email: null, phone: null });
    expect((await api('GET', '/customers?q=Muster')).json.customers).toHaveLength(0);
  });

  it('retention anonymises clients after 12 months without appointments', async () => {
    const { create, ctx, clock } = await staffSetup();
    await create({});
    clock.set('2027-11-04T00:00:00Z');
    expect((await retention(ctx)).anonymized).toBe(1);
  });

  it('retention keeps clients with an open fee claim until the limitation period ends (A-07)', async () => {
    const { create, ctx, clock } = await staffSetup();
    const a = (await create({})).json;
    await db().query(`UPDATE appointment SET fee_status = 'due' WHERE id = $1`, [a.id]);
    clock.set('2027-11-04T00:00:00Z');
    expect((await retention(ctx)).anonymized).toBe(0); // claim from 2026 runs until 31.12.2029
    clock.set('2030-01-02T00:00:00Z');
    expect((await retention(ctx)).anonymized).toBe(1);
  });

  it('client search by name, phone fragment and e-mail; shows no-shows', async () => {
    const { api, create } = await staffSetup();
    await create({});
    for (const q of ['Muster', 'anna@', '23456', 'Anna Mu']) {
      expect((await api('GET', `/customers?q=${encodeURIComponent(q)}`)).json.customers).toHaveLength(1);
    }
    expect((await api('GET', '/customers?q=a')).json.customers).toHaveLength(0);
  });
});
