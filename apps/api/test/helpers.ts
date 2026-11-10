import { resetLoginThrottle } from '../src/auth/auth.js';
import { manualClock } from '../src/clock.js';
import { createPool, type Db } from '../src/db/pool.js';
import { tenantCtx, type Ctx, type Deps } from '../src/domain/context.js';
import { solveChallenge } from '../src/domain/pow.js';
import { createStaff } from '../src/domain/staff.js';
import { createTenant, invalidateTenant, tenantById } from '../src/domain/tenants.js';
import { createApp } from '../src/http/app.js';
import { TEST_DB } from './global-setup.js';

export const ORIGIN = 'http://localhost:5173';
export const PASSWORD = 'test-passwort-123';

let pool: Db | undefined;
export const db = () => (pool ??= createPool(TEST_DB, 30));

export async function resetDb() {
  invalidateTenant();
  resetLoginThrottle();
  await db().query(
    'TRUNCATE tenant, asset, staff_user, session, customer, appointment, absence, time_block, appointment_event, outbox_message, idempotency_key, price, stylist, birthday_redemption CASCADE',
  );
}

/** App + a salon with N stylists (first is owner) + manual clock at Mon 2026-11-02 07:00 Berlin. */
export async function setup(opts: { slug?: string; stylists?: number; now?: string; limitScale?: number } = {}) {
  const clock = manualClock(opts.now ?? '2026-11-02T06:00:00Z');
  const deps: Deps = { db: db(), clock, publicBaseUrl: ORIGIN, whatsappEnabled: false, secret: 'test-secret-test-secret-test-secret-123' };
  const app = createApp(deps, { allowedOrigins: [ORIGIN], trustProxy: false, secureCookie: false, devRoutes: true, limitScale: opts.limitScale ?? 1 });
  const slug = opts.slug ?? 'salon-a';
  const t = await createTenant(deps, { slug, name: `Salon ${slug}`, stylistName: 'tmp' });
  await db().query('DELETE FROM stylist WHERE tenant_id = $1', [t.id]);
  const stylistIds: string[] = [];
  for (let i = 0; i < (opts.stylists ?? 1); i++) {
    const r = await createStaff(db(), t.id, {
      displayName: `Stylistin ${i + 1}`,
      email: `s${i + 1}@${slug}.test`,
      password: PASSWORD,
      role: i === 0 ? 'owner' : 'stylist',
    });
    stylistIds.push(r.id);
  }
  const ctx: Ctx = tenantCtx(deps, await tenantById(deps, t.id));
  return { app, deps, clock, ctx, slug, tenantId: t.id, stylistIds };
}

type App = Awaited<ReturnType<typeof setup>>['app'];

/** JSON request with the headers a real browser client sends (CSRF). */
export async function call(app: App, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await app.request(path, {
    method,
    headers: {
      origin: ORIGIN,
      'x-requested-with': 'salon',
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, json, headers: res.headers };
}

export async function login(app: App, email: string, password = PASSWORD): Promise<string> {
  const r = await app.request('/api/auth/login', {
    method: 'POST',
    headers: { origin: ORIGIN, 'x-requested-with': 'salon', 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (r.status !== 200) throw new Error(`login failed ${r.status} ${await r.text()}`);
  return /sid=([^;]+)/.exec(r.headers.get('set-cookie') ?? '')![1]!;
}

export const asStaff = (cookie: string) => ({ cookie: `sid=${cookie}` });

export async function pow(app: App, slug: string) {
  const c = (await call(app, 'GET', `/api/s/${slug}/challenge`)).json;
  return { challenge: c.challenge, salt: c.salt, signature: c.signature, number: solveChallenge(c) };
}

export const customer = { firstName: 'Anna', lastName: 'Muster', email: 'anna@example.com', phone: '0151 23456789' };

export async function book(app: App, slug: string, body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return call(
    app,
    'POST',
    `/api/s/${slug}/bookings`,
    {
      selection: { serviceId: 'cut', audience: 'women', adult: true, variant: 'dry' },
      date: '2026-11-03',
      start: '09:00',
      customer,
      privacyAck: true,
      pow: await pow(app, slug),
      ...body,
    },
    headers,
  );
}

export async function outbox(tenantId: string) {
  const { rows } = await db().query<{ template: string; recipient: string; subject: string; body: string; attachments: unknown[] }>(
    'SELECT template, recipient, subject, body, attachments FROM outbox_message WHERE tenant_id = $1 ORDER BY created_at, template',
    [tenantId],
  );
  return rows;
}
