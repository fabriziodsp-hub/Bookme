import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { login, logout, SESSION_COOKIE, SESSION_TTL_MS, userForSession } from '../../auth/auth.js';
import type { Deps } from '../../domain/context.js';
import { Errors } from '../../domain/errors.js';
import { rateLimit, type AppEnv } from '../middleware.js';
import { errorResponses, json, StaffUserSchema } from '../schemas.js';

export function authRoutes(deps: Deps, opts: { secureCookie: boolean; trustProxy: boolean; limitScale?: number }) {
  const app = new OpenAPIHono<AppEnv>();
  const tenantInfo = async (tenantId: string | null) => {
    if (!tenantId) return null;
    const { rows } = await deps.db.query<{ id: string; slug: string; name: string }>('SELECT id, slug, name FROM tenant WHERE id = $1', [tenantId]);
    return rows[0] ?? null;
  };

  // 20 attempts per 15 min per IP; additionally 5 failures per e-mail lock that account for 15 min (auth.ts).
  app.use('/login', rateLimit({ bucket: 'login-ip', limit: 20 * (opts.limitScale ?? 1), windowMs: 15 * 60_000, trustProxy: opts.trustProxy }));

  app.openapi(
    createRoute({
      method: 'post',
      path: '/login',
      tags: ['auth'],
      summary: 'Staff login with e-mail or user name; sets an HttpOnly session cookie',
      request: {
        body: {
          content: {
            'application/json': {
              // `login` = e-mail or user name (D-049); `email` kept for older clients. `slug` = salon of the login page.
              schema: z
                .object({ login: z.string().min(1).max(254).optional(), email: z.string().max(254).optional(), password: z.string().min(1).max(200), slug: z.string().max(40).optional() })
                .refine((b) => !!(b.login ?? b.email), { message: 'login required', path: ['login'] }),
            },
          },
          required: true,
        },
      },
      responses: { 200: json(StaffUserSchema, 'Logged in'), 401: json(z.any(), 'Bad credentials'), ...errorResponses },
    }),
    async (c) => {
      const b = c.req.valid('json');
      const { token, user } = await login(deps.db, deps.clock, (b.login ?? b.email)!, b.password, b.slug);
      setCookie(c, SESSION_COOKIE, token, {
        httpOnly: true,
        secure: opts.secureCookie,
        sameSite: 'Strict',
        path: '/api',
        maxAge: SESSION_TTL_MS / 1000,
      });
      return c.json({ ...user, tenant: await tenantInfo(user.tenantId) }, 200);
    },
  );

  app.openapi(
    createRoute({ method: 'post', path: '/logout', tags: ['auth'], summary: 'Logout', responses: { 204: { description: 'Logged out' } } }),
    async (c) => {
      await logout(deps.db, getCookie(c, SESSION_COOKIE));
      deleteCookie(c, SESSION_COOKIE, { path: '/api' });
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({ method: 'get', path: '/me', tags: ['auth'], summary: 'Current staff user', responses: { 200: json(StaffUserSchema, 'User'), 401: json(z.any(), 'Not logged in') } }),
    async (c) => {
      const user = await userForSession(deps.db, deps.clock, getCookie(c, SESSION_COOKIE));
      if (!user) throw Errors.unauthorized();
      return c.json({ ...user, tenant: await tenantInfo(user.tenantId) }, 200);
    },
  );
  return app;
}
