import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(3000),
  DATABASE_URL: z.string().url().default('postgres://postgres@localhost:5432/salon'),
  /** Base URL used in e-mail links, e.g. https://termine.salon-beispiel.de */
  PUBLIC_BASE_URL: z.string().url().default('http://localhost:5173'),
  /** Allowed origins for state-changing requests (comma separated). Defaults to PUBLIC_BASE_URL. */
  ALLOWED_ORIGINS: z.string().optional(),
  MAIL_MODE: z.enum(['dev', 'smtp']).default('dev'),
  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().default('Salon Beispiel <termine@salon-beispiel.de>'),
  /** HMAC secret for links and anti-bot challenges. ≥ 32 chars; generate with `openssl rand -base64 48`. */
  APP_SECRET: z.string().min(32).default('dev-only-secret-change-me-dev-only-secret-change-me'),
  WHATSAPP_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  TRUST_PROXY: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  /** Multiplies all rate limits – only for automated end-to-end tests. */
  RATE_LIMIT_SCALE: z.coerce.number().positive().default(1),
  /** Frozen clock for demos, e2e and visual tests (ISO instant). Never set in production. */
  FAKE_NOW: z.string().datetime().optional(),
  /** Directory of the built web app to serve (production single-container mode). */
  STATIC_DIR: z.string().optional(),
  WORKERS: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  /** Expose /api/dev/* (mailbox). Never in production. */
  DEV_ROUTES: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const env = EnvSchema.parse(source);
  if (env.NODE_ENV === 'production') {
    if (env.APP_SECRET.startsWith('dev-only-secret')) throw new Error('APP_SECRET must be set in production');
    if (env.RATE_LIMIT_SCALE !== 1) throw new Error('RATE_LIMIT_SCALE must not be set in production');
    if (env.FAKE_NOW) throw new Error('FAKE_NOW must not be set in production');
    if (env.DEV_ROUTES) throw new Error('DEV_ROUTES must not be enabled in production');
    if (env.MAIL_MODE === 'smtp' && !env.SMTP_URL) throw new Error('SMTP_URL is required for MAIL_MODE=smtp');
  }
  return env;
}

export function allowedOrigins(env: Env): string[] {
  const list = env.ALLOWED_ORIGINS?.split(',').map((s) => s.trim()).filter(Boolean) ?? [];
  return list.length ? list : [new URL(env.PUBLIC_BASE_URL).origin];
}
