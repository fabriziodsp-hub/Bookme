import { OpenAPIHono } from '@hono/zod-openapi';
import { serveStatic } from '@hono/node-server/serve-static';
import { secureHeaders } from 'hono/secure-headers';
import { readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Deps } from '../domain/context.js';
import { AppError } from '../domain/errors.js';
import { csrf, type AppEnv } from './middleware.js';
import { authRoutes } from './routes/auth.js';
import { devRoutes } from './routes/dev.js';
import { platformRoutes } from './routes/platform.js';
import { publicRoutes } from './routes/public.js';
import { staffRoutes } from './routes/staff.js';

export interface AppOptions {
  allowedOrigins: string[];
  trustProxy: boolean;
  secureCookie: boolean;
  devRoutes: boolean;
  staticDir?: string | undefined;
  /** Multiply rate limits (tests of concurrency use a high value). Default 1. */
  limitScale?: number;
  log?: (msg: string, extra?: unknown) => void;
}

export function createApp(deps: Deps, opts: AppOptions) {
  const app = new OpenAPIHono<AppEnv>({
    // Zod validation errors → our error format (German message, field details).
    defaultHook: (result, c) => {
      if (!result.success) {
        return c.json(
          { error: { code: 'VALIDATION', message: 'Bitte prüfen Sie Ihre Eingaben.', details: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) } },
          400,
        );
      }
      return undefined;
    },
  });

  app.use('*', async (c, next) => {
    c.set('requestId', randomUUID());
    await next();
  });

  const secure = secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        workerSrc: ["'self'", 'blob:'],
      },
      referrerPolicy: 'strict-origin-when-cross-origin',
      strictTransportSecurity: opts.secureCookie ? 'max-age=31536000; includeSubDomains' : false,
      crossOriginResourcePolicy: 'same-origin',
      permissionsPolicy: { camera: [], microphone: [], geolocation: [], payment: [] },
  });
  // Logo responses carry their own, stricter CSP (SVG may never run code); everything else gets the app CSP.
  app.use('*', (c, next) => (/^\/api\/s\/[^/]+\/logo$/.test(c.req.path) ? next() : secure(c, next)));

  app.use('/api/*', async (c, next) => {
    await next();
    c.header('cache-control', c.res.headers.get('cache-control') ?? 'no-store');
  });
  app.use('/api/*', csrf(opts.allowedOrigins));

  app.onError((err, c) => {
    const requestId = c.get('requestId');
    if (err instanceof AppError) {
      return c.json({ error: { code: err.code, message: err.userMessage, details: err.details, requestId } }, err.status);
    }
    opts.log?.(`[error] ${requestId} ${c.req.method} ${c.req.path}: ${(err as Error).stack ?? err}`);
    return c.json({ error: { code: 'INTERNAL', message: 'Ein Fehler ist aufgetreten. Bitte versuchen Sie es später erneut.', requestId } }, 500);
  });
  app.notFound((c) => (c.req.path.startsWith('/api/') ? c.json({ error: { code: 'NOT_FOUND', message: 'Nicht gefunden.' } }, 404) : c.text('Not found', 404)));

  app.get('/api/health', async (c) => {
    await deps.db.query('SELECT 1');
    return c.json({ ok: true });
  });

  app.route('/api/auth', authRoutes(deps, { secureCookie: opts.secureCookie, trustProxy: opts.trustProxy, limitScale: opts.limitScale ?? 1 }));
  app.route('/api/staff', staffRoutes(deps));
  app.route('/api/platform', platformRoutes(deps));
  app.route('/api/s', publicRoutes(deps, { trustProxy: opts.trustProxy, limitScale: opts.limitScale ?? 1 }));
  if (opts.devRoutes) app.route('/api/dev', devRoutes(deps));

  app.doc31('/api/openapi.json', {
    openapi: '3.1.0',
    info: { title: 'Salon booking API', version: '1.0.0', description: 'Multi-salon booking platform. UI language: German.' },
  });

  // Production single-container mode: serve the SPA; unknown non-API paths fall back to index.html.
  if (opts.staticDir) {
    const dir = resolve(opts.staticDir);
    const root = relative(process.cwd(), dir) || '.'; // serveStatic expects a path relative to cwd
    app.use('/assets/*', async (c, next) => {
      await next();
      c.header('cache-control', 'public, max-age=31536000, immutable');
    });
    app.use('*', serveStatic({ root }));
    app.get('*', async (c) => c.html(await readFile(join(dir, 'index.html'), 'utf8')));
  }
  return app;
}

export type App = ReturnType<typeof createApp>;
