import { beforeEach, describe, expect, it } from 'vitest';
import { asStaff, book, call, login, resetDb, setup } from './helpers.js';

beforeEach(resetDb);

describe('dev mailbox (demo only)', () => {
  it('needs a staff login and shows only the own salon', async () => {
    const a = await setup({ slug: 'salon-a' });
    const b = await setup({ slug: 'salon-b' });
    expect((await book(a.app, 'salon-a', {})).status).toBe(201);
    expect((await call(a.app, 'GET', '/api/dev/mailbox')).status).toBe(401);
    const sb = await login(b.app, 's1@salon-b.test');
    const other = await call(b.app, 'GET', '/api/dev/mailbox', undefined, asStaff(sb));
    expect(other.status).toBe(200);
    expect(other.json.messages).toHaveLength(0);
    const sa = await login(a.app, 's1@salon-a.test');
    const own = await call(a.app, 'GET', '/api/dev/mailbox', undefined, asStaff(sa));
    expect(own.json.messages.length).toBeGreaterThan(0);
    expect(own.json.messages.every((m: { slug: string }) => m.slug === 'salon-a')).toBe(true);
  });
});
