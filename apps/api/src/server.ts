import { serve } from '@hono/node-server';
import { systemClock, fixedClock } from './clock.js';
import { migrate } from './db/migrate.js';
import { createPool } from './db/pool.js';
import { allowedOrigins, loadEnv } from './env.js';
import { createApp } from './http/app.js';
import { devMailer, disabledWhatsapp, smtpMailer } from './messages/mailer.js';
import { startWorkers } from './messages/worker.js';
import type { Deps } from './domain/context.js';

const env = loadEnv();
const log = (m: string) => console.log(`${new Date().toISOString()} ${m}`);
const db = createPool(env.DATABASE_URL);
await migrate(db, log);

const deps: Deps = {
  db,
  clock: env.FAKE_NOW ? fixedClock(env.FAKE_NOW) : systemClock,
  publicBaseUrl: env.PUBLIC_BASE_URL,
  whatsappEnabled: env.WHATSAPP_ENABLED,
  secret: env.APP_SECRET,
};

const app = createApp(deps, {
  allowedOrigins: allowedOrigins(env),
  trustProxy: env.TRUST_PROXY,
  secureCookie: env.NODE_ENV === 'production',
  devRoutes: env.DEV_ROUTES ?? env.NODE_ENV !== 'production',
  staticDir: env.STATIC_DIR,
  limitScale: env.RATE_LIMIT_SCALE,
  log,
});

const mailer = env.MAIL_MODE === 'smtp' ? smtpMailer(env.SMTP_URL!, env.MAIL_FROM) : devMailer;
const stop = env.WORKERS ? startWorkers(deps, mailer, disabledWhatsapp, log) : () => undefined;

const server = serve({ fetch: app.fetch, port: env.PORT }, (i) => log(`API listening on http://localhost:${i.port}`));

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    stop();
    server.close();
    void db.end().then(() => process.exit(0));
  });
}
