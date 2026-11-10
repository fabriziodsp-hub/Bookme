import type { Context, MiddlewareHandler } from 'hono';
import { getConnInfo } from '@hono/node-server/conninfo';
import { getCookie } from 'hono/cookie';
import { userForSession, SESSION_COOKIE, type StaffUser } from '../auth/auth.js';
import { tenantCtx, type Ctx, type Deps } from '../domain/context.js';
import { Errors } from '../domain/errors.js';
import { tenantById, tenantBySlug } from '../domain/tenants.js';

export type AppEnv = { Variables: { user: StaffUser; requestId: string; ctx: Ctx } };

export function clientIp(c: Context, trustProxy: boolean): string {
  if (trustProxy) {
    // The right-most entry is the one our own reverse proxy / tunnel added; everything left of it
    // comes from the client and can be forged (a forged first entry would dodge the rate limits).
    const fwd = c.req.header('x-forwarded-for')?.split(',').map((x) => x.trim()).filter(Boolean).at(-1);
    if (fwd) return fwd;
  }
  try {
    return getConnInfo(c).remote.address ?? 'unknown';
  } catch {
    return 'local'; // app.request() in tests has no socket
  }
}

/**
 * Fixed-window in-memory rate limiter. Good enough for a single instance;
 * behind a load balancer use a shared store (documented limitation).
 */
export function rateLimit(opts: { bucket: string; limit: number; windowMs: number; trustProxy: boolean; key?: (c: Context) => string }): MiddlewareHandler {
  const hits = new Map<string, { count: number; reset: number }>();
  return async (c, next) => {
    const now = Date.now();
    const id = `${opts.bucket}:${clientIp(c, opts.trustProxy)}:${opts.key?.(c) ?? ''}`;
    let h = hits.get(id);
    if (!h || h.reset <= now) {
      h = { count: 0, reset: now + opts.windowMs };
      hits.set(id, h);
      if (hits.size > 10_000) for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
    }
    h.count++;
    c.header('RateLimit-Limit', String(opts.limit));
    c.header('RateLimit-Remaining', String(Math.max(0, opts.limit - h.count)));
    if (h.count > opts.limit) {
      c.header('Retry-After', String(Math.ceil((h.reset - now) / 1000)));
      throw Errors.rateLimited();
    }
    await next();
  };
}

/**
 * CSRF defence for state-changing requests:
 * 1. SameSite=Strict session cookie (staff),
 * 2. JSON-only bodies + custom header → forces a CORS preflight cross-site,
 * 3. Origin/Referer must be an allowed origin when present.
 */
export function csrf(allowedOrigins: string[]): MiddlewareHandler {
  return async (c, next) => {
    const m = c.req.method;
    if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return next();
    if (c.req.header('x-requested-with') !== 'salon') throw Errors.csrf();
    const origin = c.req.header('origin') ?? (c.req.header('referer') ? new URL(c.req.header('referer')!).origin : undefined);
    if (origin && !allowedOrigins.includes(origin)) throw Errors.csrf();
    const ct = c.req.header('content-type') ?? '';
    if (c.req.header('content-length') !== '0' && ct && !ct.startsWith('application/json') && ct !== 'application/octet-stream') throw Errors.csrf();
    await next();
  };
}

/** Public salon routes: resolve the salon from the :slug path segment. */
export function salonFromSlug(deps: Deps): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const slug = c.req.param('slug') ?? '';
    if (!/^[a-z0-9-]{3,40}$/.test(slug)) throw Errors.notFound();
    c.set('ctx', tenantCtx(deps, await tenantBySlug(deps, slug)));
    await next();
  };
}

/** Logged-in staff of a salon; the salon comes from the session, never from the request. */
export function requireStaff(deps: Deps): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const user = await userForSession(deps.db, deps.clock, getCookie(c, SESSION_COOKIE));
    if (!user || !user.tenantId) throw Errors.unauthorized();
    c.set('user', user);
    c.set('ctx', tenantCtx(deps, await tenantById(deps, user.tenantId)));
    await next();
  };
}

export const requireOwner: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.get('user').role !== 'owner') throw Errors.forbidden();
  await next();
};

export function requirePlatformAdmin(deps: Deps): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const user = await userForSession(deps.db, deps.clock, getCookie(c, SESSION_COOKIE));
    if (!user) throw Errors.unauthorized();
    if (user.role !== 'platform_admin') throw Errors.forbidden();
    c.set('user', user);
    await next();
  };
}
