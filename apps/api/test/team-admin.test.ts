import { beforeEach, describe, expect, it } from 'vitest';
import { asStaff, book, call, customer, db, login, resetDb, setup } from './helpers.js';

beforeEach(resetDb);

async function team() {
  const s = await setup({ stylists: 3, limitScale: 10 });
  const owner = await login(s.app, `s1@${s.slug}.test`);
  const api = (method: string, path: string, body?: unknown, cookie = owner) => call(s.app, method, `/api/staff${path}`, body, asStaff(cookie));
  const create = (stylistId: string, body: Record<string, unknown> = {}) =>
    api('POST', '/appointments', {
      selection: { serviceId: 'cut', audience: 'women', adult: true, variant: 'dry' },
      date: '2026-11-03',
      start: 540,
      stylistId,
      customer,
      ...body,
    });
  return { ...s, owner, api, create };
}

describe('delete staff profiles (D-054)', () => {
  it('a person without history is removed completely, the login stops working', async () => {
    const { api, app, slug, stylistIds } = await team();
    const sophie = await login(app, `s3@${slug}.test`);
    const r = await api('DELETE', `/admin/staff/${stylistIds[2]}`);
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ removed: 'deleted', toReassign: 0 });
    expect((await db().query('SELECT 1 FROM stylist WHERE id = $1', [stylistIds[2]])).rowCount).toBe(0);
    expect((await call(app, 'GET', '/api/auth/me', undefined, asStaff(sophie))).status).toBe(401);
    const list = (await api('GET', '/admin/staff')).json.staff;
    expect(list.map((x: { id: string }) => x.id)).not.toContain(stylistIds[2]);
  });

  it('past appointments stay; upcoming ones become "Rücksprache" and wait for a colleague', async () => {
    const { api, app, slug, clock, create, stylistIds } = await team();
    const past = (await create(stylistIds[1]!, { date: '2026-11-02', start: 540 })).json;
    const next = (await create(stylistIds[1]!, { date: '2026-11-05', start: 600 })).json;
    clock.set('2026-11-02T09:00:00Z'); // 10:00 Berlin: the 09:00 appointment is now in the past
    const r = await api('DELETE', `/admin/staff/${stylistIds[1]}`);
    expect(r.json).toEqual({ removed: 'anonymized', toReassign: 1 });
    // the login is gone: e-mail freed, no more sign-in
    expect((await call(app, 'POST', '/api/auth/login', { login: `s2@${slug}.test`, password: 'test-passwort-123', slug })).status).toBe(401);
    const row = await db().query<{ display_name: string; active: boolean; deleted_at: Date | null }>('SELECT display_name, active, deleted_at FROM stylist WHERE id = $1', [stylistIds[1]]);
    expect(row.rows[0]).toMatchObject({ display_name: 'Stylistin 2', active: false });
    expect(row.rows[0]!.deleted_at).not.toBeNull();
    // history unchanged
    const p = (await api('GET', `/appointments/${past.id}`)).json.appointment;
    expect(p).toMatchObject({ status: 'confirmed', stylistId: stylistIds[1], needsReassign: false });
    // upcoming: in the requests inbox, cannot be accepted before it has a new person
    const inbox = (await api('GET', '/requests')).json.requests;
    const n = inbox.find((x: { id: string }) => x.id === next.id);
    expect(n).toMatchObject({ status: 'discuss', needsReassign: true });
    expect((await api('POST', `/appointments/${next.id}/decision`, { version: n.version, decision: 'accept' })).status).toBe(409);
    const moved = await api('PATCH', `/appointments/${next.id}/blocks`, { version: n.version, date: n.date, blocks: n.blocks, stylistId: stylistIds[2], notifyCustomer: false });
    expect(moved.status).toBe(200);
    expect(moved.json).toMatchObject({ stylistId: stylistIds[2], needsReassign: false, status: 'discuss' });
    const ok = await api('POST', `/appointments/${next.id}/decision`, { version: moved.json.version, decision: 'accept' });
    expect(ok.status).toBe(200);
    expect(ok.json.status).toBe('confirmed');
  });

  it('refuses the own profile, the last owner and stylists', async () => {
    const { api, app, slug, stylistIds } = await team();
    expect((await api('DELETE', `/admin/staff/${stylistIds[0]}`)).status).toBe(409);
    const stylist = await login(app, `s2@${slug}.test`);
    expect((await api('DELETE', `/admin/staff/${stylistIds[2]}`, undefined, stylist)).status).toBe(403);
  });

  it('colleague list for "Profil wechseln" has names and user names, no e-mails (D-055)', async () => {
    const { api, app, slug } = await team();
    const stylist = await login(app, `s2@${slug}.test`);
    const r = await api('GET', '/team-logins', undefined, stylist);
    expect(r.status).toBe(200);
    expect(r.json.logins).toHaveLength(3);
    expect(JSON.stringify(r.json)).not.toContain('@');
  });
});

describe('client list (D-056)', () => {
  it('lists all clients without a search, alphabetically, paged; sorts by next appointment', async () => {
    const { api, create, stylistIds } = await team();
    await create(stylistIds[0]!, { date: '2026-11-10', start: 540, customer: { ...customer, firstName: 'Zoe', lastName: 'Adler', email: 'z@example.com', phone: '0151 11111111' } });
    await create(stylistIds[0]!, { date: '2026-11-04', start: 540, customer: { ...customer, firstName: 'Ben', lastName: 'Zander', email: 'b@example.com', phone: '0151 22222222' } });
    await create(stylistIds[0]!, { date: '2026-11-02', start: 540, customer: { ...customer, firstName: 'Mia', lastName: 'Meier', email: 'm@example.com', phone: '0151 33333333' } });
    const all = (await api('GET', '/customers')).json;
    expect(all.customers.map((c: { lastName: string }) => c.lastName)).toEqual(['Adler', 'Meier', 'Zander']);
    expect(all.hasMore).toBe(false);
    const page = (await api('GET', '/customers?limit=2')).json;
    expect(page.customers).toHaveLength(2);
    expect(page.hasMore).toBe(true);
    expect((await api('GET', '/customers?limit=2&offset=2')).json.customers.map((c: { lastName: string }) => c.lastName)).toEqual(['Zander']);
    // by next appointment: soonest first, clients without an upcoming appointment last
    const next = (await api('GET', '/customers?sort=next')).json.customers;
    expect(next.map((c: { lastName: string }) => c.lastName)).toEqual(['Meier', 'Zander', 'Adler']);
    expect(next[0].next).toMatchObject({ date: '2026-11-02' });
    // search still works
    expect((await api('GET', '/customers?q=zan')).json.customers.map((c: { lastName: string }) => c.lastName)).toEqual(['Zander']);
  });
});

describe('note to the client in the requests inbox (D-057)', () => {
  it('is saved first (staff only) and sent exactly as saved', async () => {
    const { api, app, slug } = await team();
    const b = await book(app, slug, {});
    expect(b.status).toBe(201);
    const req = (await api('GET', '/requests')).json.requests[0];
    const saved = await api('PUT', `/appointments/${req.id}/client-note`, { version: req.version, note: '  Bitte 10 Minuten früher kommen.  ' });
    expect(saved.status).toBe(200);
    expect(saved.json).toMatchObject({ clientNoteDraft: 'Bitte 10 Minuten früher kommen.', clientNote: null, status: 'requested' });
    // old version → conflict
    expect((await api('PUT', `/appointments/${req.id}/client-note`, { version: req.version, note: 'x' })).status).toBe(409);
    const ok = await api('POST', `/appointments/${req.id}/decision`, { version: saved.json.version, decision: 'accept', reason: saved.json.clientNoteDraft });
    expect(ok.json).toMatchObject({ status: 'confirmed', clientNote: 'Bitte 10 Minuten früher kommen.', clientNoteDraft: null });
  });
});
