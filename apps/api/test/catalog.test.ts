/** Services editor (D-048): owner and platform admin edit services, phases and durations. */
import { durationMatrix, withDurations, type Service } from '@salon/engine';
import { beforeEach, describe, expect, it } from 'vitest';
import { hashPassword } from '../src/auth/auth.js';
import { asStaff, book, call, customer, db, login, outbox, PASSWORD, resetDb, setup } from './helpers.js';

beforeEach(resetDb);

async function ownerSetup() {
  const s = await setup({ stylists: 2, limitScale: 10 });
  const owner = await login(s.app, `s1@${s.slug}.test`);
  const api = (method: string, path: string, body?: unknown) => call(s.app, method, `/api/staff${path}`, body, asStaff(owner));
  const load = async () => (await api('GET', '/admin/services')).json as { services: Service[]; version: string; inUse: string[] };
  const save = (services: Service[], version: string) => api('PUT', '/admin/services', { services, version });
  return { ...s, owner, api, load, save };
}

const edit = (services: Service[], id: string, fn: (s: Service) => Service) => services.map((s) => (s.id === id ? fn(s) : s));

describe('services editor (owner)', () => {
  it('a new duration applies to new bookings only; existing appointments keep their blocks', async () => {
    const { app, slug, api, load, save } = await ownerSetup();
    const before = await book(app, slug, {});
    expect(before.json.appointment).toMatchObject({ start: 540, end: 570 });

    const c = await load();
    expect(durationMatrix(c.services.find((s) => s.id === 'cut')!)).toEqual([[30, 45, 30, 30]]);
    const r = await save(edit(c.services, 'cut', (s) => withDurations(s, [[40, 45, 30, 30]])), c.version);
    expect(r.status).toBe(200);
    expect(r.json.version).not.toBe(c.version);
    expect(r.json.inUse).toEqual(['cut']);

    const after = await book(app, slug, { start: '10:00', customer: { ...customer, email: 'b@example.com' } });
    expect(after.json.appointment).toMatchObject({ start: 600, end: 640 });
    const cal = await api('GET', '/calendar?from=2026-11-03&days=1');
    const old = cal.json.appointments.find((a: { start: number }) => a.start === 540);
    expect(old.end).toBe(570);
  });

  it('the salon’s own name is used in the booking and the e-mail', async () => {
    const { app, slug, tenantId, load, save } = await ownerSetup();
    const c = await load();
    await save(edit(c.services, 'cut', (s) => ({ ...s, label: 'Kurzhaarschnitt' })), c.version);
    const b = await book(app, slug, {});
    expect(b.json.appointment.serviceLabel).toBe('Kurzhaarschnitt (ohne Waschen)');
    expect((await outbox(tenantId)).at(-1)!.body).toContain('Kurzhaarschnitt');
  });

  it('a new service is bookable; a hidden one is not, but its appointments stay', async () => {
    const { app, slug, api, load, save } = await ownerSetup();
    let c = await load();
    const fringe: Service = {
      id: 'pony',
      label: 'Pony schneiden',
      audiences: ['women'],
      adultOnly: false,
      hidden: false,
      collectsColorNotes: false,
      finishOption: false,
      phases: [{ key: 'pony', label: 'Pony', kind: 'busy', minutes: 15 }],
    };
    const r = await save([...c.services, fringe], c.version);
    expect(r.status).toBe(200);
    const b = await book(app, slug, { selection: { serviceId: 'pony', audience: 'women', adult: false } });
    expect(b.status).toBe(201);
    expect(b.json.appointment).toMatchObject({ start: 540, end: 555, serviceLabel: 'Pony schneiden' });

    c = await load();
    await save(edit(c.services, 'pony', (s) => ({ ...s, hidden: true })), c.version);
    const no = await book(app, slug, { selection: { serviceId: 'pony', audience: 'women', adult: false }, start: '11:00', customer: { ...customer, email: 'x@example.com' } });
    expect(no.status).toBe(422);
    expect(no.json.error.details).toEqual({ code: 'SERVICE_HIDDEN' });
    const cal = await api('GET', '/calendar?from=2026-11-03&days=1');
    expect(cal.json.appointments.map((a: { serviceLabel: string }) => a.serviceLabel)).toContain('Pony schneiden');
  });

  it('a service with appointments cannot be deleted; an unused one can (its prices go too)', async () => {
    const { app, slug, api, load, save } = await ownerSetup();
    await api('PUT', '/admin/prices', { prices: [{ serviceId: 'perm', priceCents: 9000 }, { serviceId: 'cut', priceCents: 3000 }] });
    await book(app, slug, {});
    const c = await load();
    const noCut = await save(c.services.filter((s) => s.id !== 'cut'), c.version);
    expect(noCut.status).toBe(409);
    expect(noCut.json.error.code).toBe('SERVICE_IN_USE');
    expect(noCut.json.error.message).toMatch(/Haarschnitt.*ausblenden/);
    const noVariant = await save(edit(c.services, 'cut', (s) => ({ ...s, variants: ['wash'], defaultVariant: 'wash', phases: s.phases.map((p) => ({ ...p, variantMinutes: { wash: 45 }, audienceVariantMinutes: undefined })) })), c.version);
    expect(noVariant.status).toBe(409);

    const ok = await save(c.services.filter((s) => s.id !== 'perm'), c.version);
    expect(ok.status).toBe(200);
    expect((await api('GET', '/admin/prices')).json.prices.map((p: { serviceId: string }) => p.serviceId)).toEqual(['cut']);
  });

  it('optimistic lock: a stale version is rejected', async () => {
    const { load, save } = await ownerSetup();
    const c = await load();
    expect((await save(edit(c.services, 'cut', (s) => ({ ...s, label: 'A' })), c.version)).status).toBe(200);
    const stale = await save(edit(c.services, 'cut', (s) => ({ ...s, label: 'B' })), c.version);
    expect(stale.status).toBe(409);
    expect(stale.json.error.code).toBe('CATALOG_CONFLICT');
  });

  it('invalid catalogues get a readable German message', async () => {
    const { load, save } = await ownerSetup();
    const c = await load();
    const odd = await save(edit(c.services, 'perm', (s) => withDurations(s, [[30], [32], [15], [15], [30]])), c.version);
    expect(odd.status).toBe(422);
    expect(odd.json.error.message).toBe('„Dauerwelle (Locken)“, Schritt „Wickler eindrehen“: Die Dauer muss ein Vielfaches von 5 Minuten sein.');
    const free = await save(edit(c.services, 'perm', (s) => ({ ...s, phases: s.phases.map((p, i) => (i === 0 ? { ...p, kind: 'free' as const } : p)) })), c.version);
    expect(free.json.error.message).toMatch(/erste und der letzte Schritt/);
    const none = await save(edit(c.services, 'perm', (s) => ({ ...s, audiences: [] })), c.version);
    expect(none.json.error.message).toMatch(/Damen oder Herren/);
    const empty = await save([], c.version);
    expect(empty.status).toBe(422);
  });

  it('only the owner and the platform admin may edit', async () => {
    const { app, slug, tenantId, load } = await ownerSetup();
    const stylist = await login(app, `s2@${slug}.test`);
    expect((await call(app, 'GET', '/api/staff/admin/services', undefined, asStaff(stylist))).status).toBe(403);
    const owner = await login(app, `s1@${slug}.test`);
    expect((await call(app, 'GET', `/api/platform/tenants/${tenantId}/catalog`, undefined, asStaff(owner))).status).toBe(403);

    await db().query(`INSERT INTO staff_user (email, password_hash, role, display_name) VALUES ('admin@p.test', $1, 'platform_admin', 'Admin')`, [await hashPassword(PASSWORD)]);
    const admin = await login(app, 'admin@p.test');
    const c = (await call(app, 'GET', `/api/platform/tenants/${tenantId}/catalog`, undefined, asStaff(admin))).json;
    expect(c.version).toBe((await load()).version);
    const r = await call(app, 'PUT', `/api/platform/tenants/${tenantId}/catalog`, { services: edit(c.services, 'cut', (s: Service) => ({ ...s, label: 'Schnitt' })), version: c.version }, asStaff(admin));
    expect(r.status).toBe(200);
    expect((await load()).services.find((s) => s.id === 'cut')!.label).toBe('Schnitt');
  });
});
