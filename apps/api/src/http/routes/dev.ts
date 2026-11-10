/**
 * Development-only routes: mailbox to read the "sent" e-mails (MAIL_MODE=dev). Never enabled in production.
 * Logged-in staff only, and only their own salon: the e-mails contain the clients' personal management
 * links, and the demo can be reachable from the internet (tunnel).
 */
import { OpenAPIHono } from '@hono/zod-openapi';
import type { Deps } from '../../domain/context.js';
import { requireStaff, type AppEnv } from '../middleware.js';

export function devRoutes(deps: Deps) {
  const app = new OpenAPIHono<AppEnv>();
  app.use('*', requireStaff(deps));
  app.get('/mailbox', async (c) => {
    const { rows } = await deps.db.query(
      `SELECT o.id, t.slug, o.channel, o.recipient, o.template, o.subject, o.body, o.status, o.created_at,
              jsonb_array_length(o.attachments) AS attachments
         FROM outbox_message o JOIN tenant t ON t.id = o.tenant_id
        WHERE o.tenant_id = $1 ORDER BY o.created_at DESC LIMIT 100`,
      [c.get('ctx').tenantId],
    );
    return c.json({ messages: rows });
  });
  return app;
}
