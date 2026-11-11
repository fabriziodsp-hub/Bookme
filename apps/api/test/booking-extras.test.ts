import { beforeEach, describe, expect, it } from 'vitest';
import { asStaff, book, call, customer, db, login, resetDb, setup } from './helpers.js';

beforeEach(resetDb);

describe('wish for a person in the online booking (D-063)', () => {
  it('the public team carries an id; availability, month dots and next free slot filter by it; the booking goes to that person', async () => {
    const s = await setup({ stylists: 2 });
    await db().query("UPDATE stylist SET show_public = true, public_name = 'Sophie' WHERE id = $1", [s.stylistIds[1]]);
    const salon = (await call(s.app, 'GET', `/api/s/${s.slug}/config`)).json;
    expect(salon.team).toEqual([{ id: s.stylistIds[1], publicName: 'Sophie' }]);
    const q = `serviceId=cut&audience=women&variant=dry&from=2026-11-03`;
    const day = (await call(s.app, 'GET', `/api/s/${s.slug}/availability?${q}&days=1&stylistId=${s.stylistIds[1]}`)).json.days[0];
    expect(day.slots.length).toBeGreaterThan(0);
    expect(day.slots.every((x: { stylistIds: string[] }) => x.stylistIds.join() === s.stylistIds[1])).toBe(true);
    expect((await call(s.app, 'GET', `/api/s/${s.slug}/availability/days?${q}&days=7&stylistId=${s.stylistIds[1]}`)).status).toBe(200);
    expect((await call(s.app, 'GET', `/api/s/${s.slug}/availability/next?${q}&stylistId=${s.stylistIds[1]}`)).json.next).not.toBeNull();
    const b = await book(s.app, s.slug, { stylistId: s.stylistIds[1] });
    expect(b.status).toBe(201);
    const row = await db().query('SELECT stylist_id FROM appointment WHERE ref_code = $1', [b.json.appointment.refCode]);
    expect(row.rows[0].stylist_id).toBe(s.stylistIds[1]);
  });
});

describe('no age question (D-062) and new services (D-066)', () => {
  it('selection without "adult" works; Rentner- and Kinder-Schnitt are bookable with their durations', async () => {
    const s = await setup();
    const r = await book(s.app, s.slug, { selection: { serviceId: 'color_root', audience: 'women' } });
    expect(r.status).toBe(201);
    const senior = await book(s.app, s.slug, { selection: { serviceId: 'cut_senior', audience: 'men' }, start: '13:00', customer: { ...customer, email: 'r@example.com' } });
    expect(senior.status).toBe(201);
    expect(senior.json.appointment.end - senior.json.appointment.start).toBe(20);
    const kids = await book(s.app, s.slug, { selection: { serviceId: 'cut_kids', audience: 'women' }, start: '14:00', customer: { ...customer, email: 'k@example.com' } });
    expect(kids.json.appointment.end - kids.json.appointment.start).toBe(30);
  });
});

describe('staff: appointment for an existing client card (D-064)', () => {
  it('uses the card, does not create a second client; other salons\' cards are not found', async () => {
    const s = await setup();
    const b = await book(s.app, s.slug, {});
    const owner = await login(s.app, `s1@${s.slug}.test`);
    const api = (m: string, p: string, body?: unknown) => call(s.app, m, `/api/staff${p}`, body, asStaff(owner));
    const card = (await api('GET', '/customers?q=Muster')).json.customers[0];
    const before = (await db().query('SELECT count(*)::int AS n FROM customer')).rows[0].n;
    const r = await api('POST', '/appointments', {
      selection: { serviceId: 'cut_senior', audience: 'women' },
      date: '2026-11-04',
      start: 600,
      stylistId: s.stylistIds[0],
      customerId: card.id,
      notifyCustomer: false,
    });
    expect(r.status).toBe(201);
    expect(r.json.customer).toMatchObject({ id: card.id, lastName: 'Muster' });
    expect((await db().query('SELECT count(*)::int AS n FROM customer')).rows[0].n).toBe(before);
    expect(b.status).toBe(201);
    // neither a card nor new data → 400; unknown / foreign card → 404
    expect((await api('POST', '/appointments', { selection: { serviceId: 'cut', audience: 'women', variant: 'dry' }, date: '2026-11-04', start: 700, stylistId: s.stylistIds[0] })).status).toBe(400);
    const other = await setup({ slug: 'salon-b' });
    const foreign = (await db().query("SELECT id FROM customer WHERE tenant_id = $1 LIMIT 1", [s.tenantId])).rows[0].id;
    const ob = await login(other.app, 's1@salon-b.test');
    const x = await call(other.app, 'POST', '/api/staff/appointments', { selection: { serviceId: 'cut', audience: 'women', variant: 'dry' }, date: '2026-11-04', start: 600, stylistId: other.stylistIds[0], customerId: foreign }, asStaff(ob));
    expect(x.status).toBe(404);
  });
});
