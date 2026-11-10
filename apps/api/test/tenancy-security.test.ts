import { beforeEach, describe, expect, it } from 'vitest';
import { hashPassword } from '../src/auth/auth.js';
import { asStaff, book, call, db, login, ORIGIN, PASSWORD, resetDb, setup } from './helpers.js';

beforeEach(resetDb);

async function twoSalons() {
  const a = await setup({ slug: 'salon-a', limitScale: 10 });
  const b = await setup({ slug: 'salon-b' });
  return { a, b };
}

describe('tenant isolation', () => {
  it("staff of salon B can neither read nor change salon A's appointment (404, not 403)", async () => {
    const { a, b } = await twoSalons();
    await book(a.app, a.slug, {});
    const sa = await login(a.app, 's1@salon-a.test');
    const appt = (await call(a.app, 'GET', '/api/staff/requests', undefined, asStaff(sa))).json.requests[0];
    const sb = await login(b.app, 's1@salon-b.test');
    expect((await call(b.app, 'GET', `/api/staff/appointments/${appt.id}`, undefined, asStaff(sb))).status).toBe(404);
    const d = await call(b.app, 'POST', `/api/staff/appointments/${appt.id}/decision`, { version: 1, decision: 'decline' }, asStaff(sb));
    expect(d.status).toBe(404);
    expect((await call(b.app, 'GET', '/api/staff/requests', undefined, asStaff(sb))).json.requests).toHaveLength(0);
    const cal = await call(b.app, 'GET', '/api/staff/calendar?from=2026-11-03&days=1', undefined, asStaff(sb));
    expect(cal.json.appointments).toHaveLength(0);
    expect((await call(b.app, 'GET', '/api/staff/customers?q=Muster', undefined, asStaff(sb))).json.customers).toHaveLength(0);
  });

  it("a management link of salon A does not work under salon B's address", async () => {
    const { a, b } = await twoSalons();
    const r = await book(a.app, a.slug, {});
    expect((await call(b.app, 'GET', `/api/s/${b.slug}/appointments/${r.json.manageToken}`)).status).toBe(404);
  });

  it("salon B's calendar is independent: the same time is free there", async () => {
    const { a, b } = await twoSalons();
    expect((await book(a.app, a.slug, {})).status).toBe(201);
    expect((await book(b.app, b.slug, {})).status).toBe(201);
  });

  it('staff cannot use a stylist id of another salon', async () => {
    const { a, b } = await twoSalons();
    const sa = await login(a.app, 's1@salon-a.test');
    const r = await call(a.app, 'POST', '/api/staff/absences', {
      stylistId: b.stylistIds[0], from: { date: '2026-11-03', minute: 480 }, to: { date: '2026-11-03', minute: 600 }, kind: 'other',
    }, asStaff(sa));
    expect(r.status).toBe(404);
  });
});

describe('security', () => {
  it('CSRF: state-changing requests need the custom header and an allowed origin', async () => {
    const { app, slug } = await setup();
    const noHeader = await app.request(`/api/s/${slug}/bookings`, { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN }, body: '{}' });
    expect(noHeader.status).toBe(403);
    const evil = await call(app, 'POST', `/api/s/${slug}/bookings`, {}, { origin: 'https://evil.example' });
    expect(evil.status).toBe(403);
    const form = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-requested-with': 'salon', origin: ORIGIN },
      body: 'email=a&password=b',
    });
    expect(form.status).toBe(403);
  });

  it('authentication and roles', async () => {
    const { app, slug } = await setup({ stylists: 2 });
    expect((await call(app, 'GET', '/api/staff/calendar?from=2026-11-03')).status).toBe(401);
    const stylist = await login(app, `s2@${slug}.test`);
    expect((await call(app, 'GET', '/api/staff/admin/prices', undefined, asStaff(stylist))).status).toBe(403);
    expect((await call(app, 'GET', '/api/platform/tenants', undefined, asStaff(stylist))).status).toBe(403);
    const owner = await login(app, `s1@${slug}.test`);
    expect((await call(app, 'GET', '/api/staff/admin/prices', undefined, asStaff(owner))).status).toBe(200);
    expect((await call(app, 'GET', '/api/platform/tenants', undefined, asStaff(owner))).status).toBe(403);
  });

  it('session cookie is HttpOnly + SameSite=Strict; logout invalidates it', async () => {
    const { app, slug } = await setup();
    const r = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { origin: ORIGIN, 'x-requested-with': 'salon', 'content-type': 'application/json' },
      body: JSON.stringify({ email: `s1@${slug}.test`, password: PASSWORD }),
    });
    const cookie = r.headers.get('set-cookie')!;
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    const sid = /sid=([^;]+)/.exec(cookie)![1]!;
    expect((await call(app, 'GET', '/api/auth/me', undefined, asStaff(sid))).status).toBe(200);
    await call(app, 'POST', '/api/auth/logout', undefined, asStaff(sid));
    expect((await call(app, 'GET', '/api/auth/me', undefined, asStaff(sid))).status).toBe(401);
  });

  it('login: wrong password → generic 401; 5 failures lock the account for 15 min', async () => {
    const { app, slug } = await setup();
    const email = `s1@${slug}.test`;
    for (let i = 0; i < 5; i++) {
      const r = await call(app, 'POST', '/api/auth/login', { email, password: 'falsch-falsch' });
      expect(r.json.error.code).toBe('BAD_CREDENTIALS');
    }
    expect((await call(app, 'POST', '/api/auth/login', { email, password: PASSWORD })).status).toBe(429);
    expect((await call(app, 'POST', '/api/auth/login', { email: 'unknown@x.test', password: 'x' })).json.error.code).toBe('BAD_CREDENTIALS');
  });

  it('rate limit on booking requests → 429 with Retry-After', async () => {
    const { app, slug } = await setup();
    let last;
    for (let i = 0; i < 11; i++) last = await book(app, slug, { start: '09:00', customer: { firstName: 'R', lastName: `L${i}`, email: `r${i}@example.com` } });
    expect(last!.status).toBe(429);
    expect(last!.headers.get('retry-after')).toBeTruthy();
  });

  it('security headers and no-store on API responses', async () => {
    const { app, slug } = await setup();
    const r = await app.request(`/api/s/${slug}/config`);
    expect(r.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(r.headers.get('x-frame-options')).toBe('SAMEORIGIN');
    expect(r.headers.get('cache-control')).toBe('no-store');
  });

  it('errors never leak internals', async () => {
    const { app } = await setup();
    const r = await call(app, 'GET', '/api/s/salon-a/appointments/../../etc/passwd');
    expect(JSON.stringify(r.json ?? '')).not.toMatch(/stack|at .*\.ts/);
  });

  it('platform admin: only this role uploads logos; unsafe SVG is rejected', async () => {
    const { app, tenantId, slug } = await setup();
    await db().query(`INSERT INTO staff_user (email, password_hash, role, display_name) VALUES ('admin@p.test', $1, 'platform_admin', 'Admin')`, [
      await hashPassword(PASSWORD),
    ]);
    const owner = await login(app, `s1@${slug}.test`);
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><circle r="5"/></svg>';
    const put = (sid: string, body: string) =>
      app.request(`/api/platform/tenants/${tenantId}/logo`, {
        method: 'PUT',
        headers: { origin: ORIGIN, 'x-requested-with': 'salon', 'content-type': 'application/octet-stream', cookie: `sid=${sid}` },
        body,
      });
    expect((await put(owner, svg)).status).toBe(403);
    const admin = await login(app, 'admin@p.test');
    expect((await put(admin, '<svg><script>alert(1)</script></svg>')).status).toBe(400);
    expect((await put(admin, '<svg onload="x()"></svg>')).status).toBe(400);
    expect((await put(admin, 'GIF89a…')).status).toBe(400);
    expect((await put(admin, svg)).status).toBe(200);
    const logo = await app.request(`/api/s/${slug}/logo`);
    expect(logo.headers.get('content-type')).toBe('image/svg+xml');
    expect(logo.headers.get('content-security-policy')).toContain("default-src 'none'");
  });

  it('OpenAPI document is generated from the schemas', async () => {
    const { app } = await setup();
    const r = await call(app, 'GET', '/api/openapi.json');
    expect(r.json.openapi).toBe('3.1.0');
    expect(Object.keys(r.json.paths)).toEqual(expect.arrayContaining(['/api/s/{slug}/bookings', '/api/staff/calendar']));
  });
});
