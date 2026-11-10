/** D-049: log in with e-mail or user name in one field; user names are unique per salon. */
import { beforeEach, describe, expect, it } from 'vitest';
import { hashPassword } from '../src/auth/auth.js';
import { createStaff } from '../src/domain/staff.js';
import { asStaff, call, db, login, PASSWORD, resetDb, setup } from './helpers.js';

beforeEach(resetDb);

const signIn = (app: Awaited<ReturnType<typeof setup>>['app'], body: Record<string, unknown>) => call(app, 'POST', '/api/auth/login', { password: PASSWORD, ...body });

describe('login with e-mail or user name (D-049)', () => {
  it('a user name works on its own salon’s login page, case-insensitive', async () => {
    const a = await setup({ slug: 'salon-a' });
    await createStaff(db(), a.tenantId, { displayName: 'Maria', email: 'maria@a.test', username: 'Maria', password: PASSWORD });
    const r = await signIn(a.app, { login: ' MARIA ', slug: 'salon-a' });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ email: 'maria@a.test', tenant: { slug: 'salon-a' } });
    // e-mail still works, also with the old field name
    expect((await signIn(a.app, { login: 'maria@a.test', slug: 'salon-a' })).status).toBe(200);
    expect((await signIn(a.app, { email: 'maria@a.test' })).status).toBe(200);
  });

  it('user names are per salon: the same name in two salons logs into the salon of the page', async () => {
    const a = await setup({ slug: 'salon-a' });
    const b = await setup({ slug: 'salon-b' });
    await createStaff(db(), a.tenantId, { displayName: 'Anna A', email: 'anna@a.test', username: 'anna', password: PASSWORD });
    await createStaff(db(), b.tenantId, { displayName: 'Anna B', email: 'anna@b.test', username: 'anna', password: PASSWORD });
    expect((await signIn(a.app, { login: 'anna', slug: 'salon-a' })).json.email).toBe('anna@a.test');
    expect((await signIn(a.app, { login: 'anna', slug: 'salon-b' })).json.email).toBe('anna@b.test');
    // wrong salon or no salon → generic 401
    const wrong = await signIn(a.app, { login: 'anna', slug: 'salon-x' });
    expect(wrong.status).toBe(401);
    expect(wrong.json.error.message).toBe('Anmeldename oder Passwort ist falsch.');
    expect((await signIn(a.app, { login: 'anna' })).status).toBe(401);
  });

  it('without a salon only platform admins match a user name (/admin)', async () => {
    const a = await setup();
    await db().query(`INSERT INTO staff_user (email, username, password_hash, role, display_name) VALUES ('admin@p.test', 'admin', $1, 'platform_admin', 'Admin')`, [await hashPassword(PASSWORD)]);
    const r = await signIn(a.app, { login: 'admin' });
    expect(r.status).toBe(200);
    expect(r.json.role).toBe('platform_admin');
    expect((await signIn(a.app, { login: 'admin', slug: a.slug })).status).toBe(401);
  });

  it('5 wrong passwords lock that user name on that salon', async () => {
    const a = await setup({ slug: 'salon-a' });
    await createStaff(db(), a.tenantId, { displayName: 'Maria', email: 'maria@a.test', username: 'maria', password: PASSWORD });
    for (let i = 0; i < 5; i++) expect((await signIn(a.app, { login: 'maria', slug: 'salon-a', password: 'falsch-falsch-falsch' })).status).toBe(401);
    expect((await signIn(a.app, { login: 'maria', slug: 'salon-a' })).status).toBe(429);
  });
});

describe('accounts: e-mail mandatory for a login, user name optional (D-049)', () => {
  it('validates and keeps user names unique within the salon', async () => {
    const a = await setup({ slug: 'salon-a', stylists: 2 });
    const owner = await login(a.app, 's1@salon-a.test');
    const api = (method: string, path: string, body?: unknown) => call(a.app, method, `/api/staff${path}`, body, asStaff(owner));

    const noMail = await api('POST', '/admin/staff', { displayName: 'Ohne Mail', username: 'ohnemail', password: PASSWORD });
    expect(noMail.status).toBe(422);
    expect(noMail.json.error.code).toBe('EMAIL_REQUIRED');
    expect((await api('POST', '/admin/staff', { displayName: 'Nur Kalender' })).status).toBe(201); // no login at all is fine

    const bad = await api('POST', '/admin/staff', { displayName: 'X', email: 'x@a.test', username: 'a@b', password: PASSWORD });
    expect(bad.json.error.code).toBe('USERNAME_INVALID');
    expect((await api('POST', '/admin/staff', { displayName: 'Lea', email: 'lea@a.test', username: 'lea', password: PASSWORD })).status).toBe(201);
    const dup = await api('POST', '/admin/staff', { displayName: 'Lea 2', email: 'lea2@a.test', username: 'LEA', password: PASSWORD });
    expect(dup.status).toBe(409);
    expect(dup.json.error.code).toBe('USERNAME_TAKEN');

    // the owner sets, changes and removes a user name; the list shows it
    const s2 = a.stylistIds[1]!;
    expect((await api('PUT', `/admin/staff/${s2}/username`, { username: 'lea' })).status).toBe(409);
    expect((await api('PUT', `/admin/staff/${s2}/username`, { username: 'sophie' })).json).toEqual({ username: 'sophie' });
    const list = (await api('GET', '/admin/staff')).json.staff;
    expect(list.find((s: { id: string }) => s.id === s2).username).toBe('sophie');
    expect((await signIn(a.app, { login: 'sophie', slug: 'salon-a' })).status).toBe(200);
    expect((await api('PUT', `/admin/staff/${s2}/username`, { username: null })).json).toEqual({ username: null });

    const stylist = await login(a.app, 's2@salon-a.test');
    expect((await call(a.app, 'PUT', `/api/staff/admin/staff/${s2}/username`, { username: 'x' }, asStaff(stylist))).status).toBe(403);
  });
});
