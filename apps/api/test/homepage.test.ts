/** D-052: public homepage texts and team – only opt-in public names, never full staff names. */
import { beforeEach, describe, expect, it } from 'vitest';
import { asStaff, call, login, resetDb, setup } from './helpers.js';

beforeEach(resetDb);

describe('public homepage (D-052)', () => {
  it('public config shows no staff names until someone opts in, then only the public name', async () => {
    const { app, slug, stylistIds } = await setup({ stylists: 2 });
    const cfg = async () => (await call(app, 'GET', `/api/s/${slug}/config`)).json;
    let c = await cfg();
    expect(c.team).toEqual([]);
    expect(JSON.stringify(c)).not.toContain('Stylistin');
    expect(c.homepage).toEqual({ tagline: '', about: '' });

    const owner = await login(app, `s1@${slug}.test`);
    const api = (m: string, p: string, b?: unknown) => call(app, m, `/api/staff${p}`, b, asStaff(owner));
    expect((await api('PUT', `/admin/staff/${stylistIds[1]}/public`, { show: true, publicName: '' })).json.error.code).toBe('PUBLIC_NAME_REQUIRED');
    expect((await api('PUT', `/admin/staff/${stylistIds[1]}/public`, { show: true, publicName: 'Sophie' })).status).toBe(200);
    await api('PUT', '/admin/homepage', { tagline: '  Schnitt mit Liebe  ', about: 'Seit 2010 in Musterstadt.\r\nTermine online.' });

    c = await cfg();
    expect(c.team).toEqual([{ publicName: 'Sophie' }]);
    expect(c.homepage).toEqual({ tagline: 'Schnitt mit Liebe', about: 'Seit 2010 in Musterstadt.\nTermine online.' });
    expect(JSON.stringify(c)).not.toContain('Stylistin 2'); // full name never public

    // withdrawal: hidden again, the owner list still knows the public name
    await api('PUT', `/admin/staff/${stylistIds[1]}/public`, { show: false, publicName: 'Sophie' });
    expect((await cfg()).team).toEqual([]);
    const list = (await api('GET', '/admin/staff')).json.staff;
    expect(list.find((s: { id: string }) => s.id === stylistIds[1])).toMatchObject({ showPublic: false, publicName: 'Sophie' });

    const stylist = await login(app, `s2@${slug}.test`);
    expect((await call(app, 'PUT', '/api/staff/admin/homepage', { tagline: 'x', about: '' }, asStaff(stylist))).status).toBe(403);
  });
});
