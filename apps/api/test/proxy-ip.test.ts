import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { clientIp } from '../src/http/middleware.js';

describe('client IP behind a trusted proxy (rate limits)', () => {
  const app = new Hono();
  app.get('/ip', (c) => c.text(clientIp(c, true)));
  app.get('/ip-direct', (c) => c.text(clientIp(c, false)));

  it('uses the entry added by our proxy, not a forged one from the client', async () => {
    const r = await app.request('/ip', { headers: { 'x-forwarded-for': '6.6.6.6, 203.0.113.7' } });
    expect(await r.text()).toBe('203.0.113.7');
    expect(await (await app.request('/ip', { headers: { 'x-forwarded-for': '203.0.113.7' } })).text()).toBe('203.0.113.7');
  });

  it('ignores the header when no proxy is trusted', async () => {
    const r = await app.request('/ip-direct', { headers: { 'x-forwarded-for': '6.6.6.6' } });
    expect(await r.text()).not.toBe('6.6.6.6');
  });
});
