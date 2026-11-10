import { beforeEach, describe, expect, it } from 'vitest';
import { asStaff, book, call, customer, db, login, outbox, resetDb, setup } from './helpers.js';

beforeEach(resetDb);

async function accepted(note?: string, slug?: string) {
  const s = await setup({ stylists: 2, ...(slug ? { slug } : {}) });
  const r = await book(s.app, s.slug, {});
  const sid = await login(s.app, `s1@${s.slug}.test`);
  const a = (await call(s.app, 'GET', '/api/staff/requests', undefined, asStaff(sid))).json.requests[0];
  const d = await call(s.app, 'POST', `/api/staff/appointments/${a.id}/decision`, { version: a.version, decision: 'accept', reason: note }, asStaff(sid));
  return { ...s, sid, token: r.json.manageToken as string, appt: d.json };
}

describe('note to the client (Notiz) on every decision', () => {
  it('accept: note in the confirmation e-mail and on the booking page', async () => {
    const { app, slug, tenantId, token } = await accepted('Bitte 10 Minuten früher kommen.');
    const mail = (await outbox(tenantId)).find((m) => m.template === 'confirmation')!;
    expect(mail.body).toContain('Notiz vom Salon:\nBitte 10 Minuten früher kommen.');
    const pub = await call(app, 'GET', `/api/s/${slug}/appointments/${token}`);
    expect(pub.json.clientNote).toBe('Bitte 10 Minuten früher kommen.');
  });

  it('Rücksprache: note in the e-mail and on the booking page; no note → nothing shown', async () => {
    const s = await setup();
    const r = await book(s.app, s.slug, {});
    const sid = await login(s.app, `s1@${s.slug}.test`);
    const a = (await call(s.app, 'GET', '/api/staff/requests', undefined, asStaff(sid))).json.requests[0];
    await call(s.app, 'POST', `/api/staff/appointments/${a.id}/decision`, { version: a.version, decision: 'discuss', reason: 'Länge der Haare?' }, asStaff(sid));
    expect((await outbox(s.tenantId)).find((m) => m.template === 'discuss')!.body).toContain('Notiz vom Salon:\nLänge der Haare?');
    expect((await call(s.app, 'GET', `/api/s/${s.slug}/appointments/${r.json.manageToken}`)).json.clientNote).toBe('Länge der Haare?');
    const b = await accepted(undefined, 'zweiter-salon');
    expect((await call(b.app, 'GET', `/api/s/${b.slug}/appointments/${b.token}`)).json.clientNote).toBeNull();
  });
});

describe('privacy notice acknowledgement (Art. 13 DSGVO)', () => {
  it('online requests need it; it is stored on the client card', async () => {
    const { app, slug } = await setup();
    const r = await book(app, slug, { privacyAck: undefined });
    expect(r.status).toBe(422);
    expect(r.json.error.code).toBe('PRIVACY_ACK_REQUIRED');
    const ok = await book(app, slug, {});
    expect(ok.status).toBe(201);
    const sid = await login(app, `s1@${slug}.test`);
    const cid = (await db().query('SELECT id FROM customer LIMIT 1')).rows[0].id;
    const card = await call(app, 'GET', `/api/staff/customers/${cid}`, undefined, asStaff(sid));
    expect(card.json.customer.privacyAckAt).toBeTruthy();
    const { rows } = await db().query('SELECT privacy_ack_version FROM customer');
    expect(rows[0].privacy_ack_version).toMatch(/^privacy-v2/);
  });
});

describe('client card (staff only)', () => {
  async function cardSetup() {
    const s = await accepted();
    const cid = (await db().query('SELECT id FROM customer WHERE tenant_id = $1', [s.tenantId])).rows[0].id as string;
    const api = (sid: string, m: string, path: string, b?: unknown) => call(s.app, m, `/api/staff/customers/${cid}${path}`, b, asStaff(sid));
    return { ...s, cid, api };
  }

  it('shows contact data and all appointments; not reachable without staff login', async () => {
    const { app, sid, cid, api } = await cardSetup();
    const c = await api(sid, 'GET', '');
    expect(c.status).toBe(200);
    expect(c.json.customer).toMatchObject({ firstName: customer.firstName, lastName: customer.lastName, email: customer.email });
    expect(c.json.customer.phone).toMatch(/23456789$/);
    expect(c.json.appointments).toHaveLength(1);
    expect(c.json.appointments[0]).toMatchObject({ status: 'confirmed', date: '2026-11-03', start: 540, locked: false });
    expect((await call(app, 'GET', `/api/staff/customers/${cid}`)).status).toBe(401);
  });

  it('colour recipes and notes: author or owner may delete', async () => {
    const { app, slug, sid: owner, api } = await cardSetup(); // s1 is the owner
    const stylist = await login(app, `s2@${slug}.test`);
    const add = await api(owner, 'POST', '/entries', { kind: 'color', body: 'Majirel 6.0 30 g + 7.1 10 g, 6 % 1:1,5, 35 Min.' });
    expect(add.status).toBe(201);
    const byOwner = add.json.entries[0];
    expect(byOwner).toMatchObject({ kind: 'color', body: expect.stringContaining('Majirel') });
    expect((await api(stylist, 'DELETE', `/entries/${byOwner.id}`)).status).toBe(403);
    const own = (await api(stylist, 'POST', '/entries', { kind: 'note', body: 'Mag es kurz' })).json.entries.find((e: any) => e.kind === 'note');
    expect((await api(stylist, 'DELETE', `/entries/${own.id}`)).status).toBe(204);
    expect((await api(owner, 'DELETE', `/entries/${byOwner.id}`)).status).toBe(204);
    expect((await api(owner, 'GET', '')).json.entries).toHaveLength(0);
    expect((await api(owner, 'POST', '/entries', { kind: 'x', body: 'a' })).status).toBe(400);
  });

  it('allergies only with explicit consent (Art. 9 DSGVO); withdrawal deletes them', async () => {
    const { sid, api } = await cardSetup();
    await api(sid, 'PUT', '/health', { consent: false, notes: 'PPD-Allergie' });
    expect((await api(sid, 'GET', '')).json.customer.health).toEqual({ consentAt: null, notes: null });
    const yes = await api(sid, 'PUT', '/health', { consent: true, notes: 'PPD-Allergie' });
    expect(yes.json.customer.health).toMatchObject({ consentAt: expect.any(String), notes: 'PPD-Allergie' });
    await expect(db().query(`UPDATE customer SET health_consent_at = NULL`)).rejects.toThrow(/health_notes_need_consent/);
    const no = await api(sid, 'PUT', '/health', { consent: false });
    expect(no.json.customer.health).toEqual({ consentAt: null, notes: null });
  });

  it('export contains the card; anonymisation deletes entries and health data', async () => {
    const { app, slug, sid, cid, api } = await cardSetup();
    await api(sid, 'POST', '/entries', { kind: 'note', body: 'Mag kurze Seiten' });
    await api(sid, 'PUT', '/health', { consent: true, notes: 'Nickel' });
    const owner = sid;
    void app; void slug;
    const exp = await api(owner, 'GET', '/export');
    expect(exp.json.cardEntries).toHaveLength(1);
    expect(exp.json.customer.health_notes).toBe('Nickel');
    expect((await api(owner, 'POST', '/anonymize')).status).toBe(204);
    expect((await db().query('SELECT count(*)::int AS n FROM customer_entry WHERE customer_id = $1', [cid])).rows[0].n).toBe(0);
    expect((await db().query('SELECT health_notes FROM customer WHERE id = $1', [cid])).rows[0].health_notes).toBeNull();
  });
});

describe('past appointments stay in the history', () => {
  it('cannot be cancelled from yesterday backwards; today still can', async () => {
    const { app, slug, appt, clock } = await accepted();
    clock.set('2026-11-04T08:00:00Z'); // appointment was yesterday (3 Nov)
    const sid = await login(app, `s1@${slug}.test`);
    const set = async (status: string) => {
      const cur = (await call(app, 'GET', `/api/staff/appointments/${appt.id}`, undefined, asStaff(sid))).json.appointment;
      return call(app, 'POST', `/api/staff/appointments/${appt.id}/status`, { version: cur.version, status }, asStaff(sid));
    };
    const r = await set('cancelled');
    expect(r.status).toBe(409);
    expect(r.json.error.code).toBe('PAST_LOCKED');
    expect((await set('no_show')).status).toBe(200);
  });
});
