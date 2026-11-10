/** Development-only routes: mailbox to read the "sent" e-mails (MAIL_MODE=dev). Never enabled in production. */
import { Hono } from 'hono';
import type { Deps } from '../../domain/context.js';

export function devRoutes(deps: Deps) {
  const app = new Hono();
  app.get('/mailbox', async (c) => {
    const { rows } = await deps.db.query(
      `SELECT o.id, t.slug, o.channel, o.recipient, o.template, o.subject, o.body, o.status, o.created_at,
              jsonb_array_length(o.attachments) AS attachments
         FROM outbox_message o JOIN tenant t ON t.id = o.tenant_id ORDER BY o.created_at DESC LIMIT 100`,
    );
    return c.json({ messages: rows });
  });
  return app;
}
