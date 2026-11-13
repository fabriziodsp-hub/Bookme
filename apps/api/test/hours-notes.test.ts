import { beforeEach, describe, expect, it } from 'vitest';
import { asStaff, call, customer, login, resetDb, setup } from './helpers.js';

beforeEach(resetDb);

async function salon() {
  const s = await setup({ stylists: 2, limitScale: 10 });
  const owner = await login(s.app, `s1@${s.slug}.test`);
  const stylist = await login(s.app, `s2@${s.slug}.test`);
  const as = (cookie: string) => (m: string, p: string, b?: unknown) => call(s.app, m, `/api/staff${p}`, b, asStaff(cookie));
  return { ...s, owner: as(owner), stylist: as(stylist) };
}

describe('personal working hours (D-071)', () => {
  it('owner sets them; slots and staff placement respect them; invalid plans are refused', async () => {
    const { owner, stylist, app, slug, stylistIds } = await salon();
    const sid = stylistIds[1]!;
    expect((await stylist('PUT', `/admin/staff/${sid}/work-hours`, { workHours: { tue: { open: '09:00', close: '12:00', breaks: [] } } })).status).toBe(403);
    expect((await owner('PUT', `/admin/staff/${sid}/work-hours`, { workHours: { tue: { open: '07:00', close: '12:00', breaks: [] } } })).status).toBe(422);
    const ok = await owner('PUT', `/admin/staff/${sid}/work-hours`, { workHours: { tue: { open: '09:00', close: '12:00', breaks: [] }, wed: null } });
    expect(ok.status).toBe(200);
    const q = 'serviceId=cut&audience=women&variant=dry&from=2026-11-03&days=2';
    const days = (await call(app, 'GET', `/api/s/${slug}/availability?${q}&stylistId=${sid}`)).json.days;
    const tue = days[0].slots.map((x: { start: number }) => x.start);
    expect(Math.min(...tue)).toBe(540); // 09:00
    expect(Math.max(...tue)).toBe(690); // 11:30 (ends 12:00)
    expect(days[1].slots).toHaveLength(0); // Wednesday off
    const place = await owner('POST', '/appointments', { selection: { serviceId: 'cut', audience: 'women', variant: 'dry' }, date: '2026-11-03', start: 780, stylistId: sid, customer });
    expect([409, 422]).toContain(place.status); // 13:00 is off duty, also for staff
    const cal = (await owner('GET', '/calendar?from=2026-11-03&days=1')).json;
    expect(cal.stylists.find((x: { id: string }) => x.id === sid).workHours.tue).toEqual({ open: '09:00', close: '12:00', breaks: [] });
    expect((await owner('PUT', `/admin/staff/${sid}/work-hours`, { workHours: null })).json.workHours).toBeNull();
  });
});

describe('internal calendar notes (D-072) and absences owner-only (D-071)', () => {
  it('a non-blocking note leaves the time bookable, a blocking one does not; stylists may add notes but no absences', async () => {
    const { owner, stylist, app, slug, stylistIds } = await salon();
    const sid = stylistIds[1]!;
    const note = (blocks: boolean, minute: number) => ({ stylistId: sid, from: { date: '2026-11-03', minute }, to: { date: '2026-11-03', minute: minute + 30 }, kind: 'note', note: 'Lieferung Farben', blocks });
    const free = await stylist('POST', '/absences', note(false, 600));
    expect(free.status).toBe(201);
    expect(free.json).toMatchObject({ kind: 'note', blocks: false, note: 'Lieferung Farben' });
    const blocking = await stylist('POST', '/absences', note(true, 660));
    expect(blocking.json.blocks).toBe(true);
    const q = 'serviceId=cut&audience=women&variant=dry&from=2026-11-03&days=1';
    const starts = (await call(app, 'GET', `/api/s/${slug}/availability?${q}&stylistId=${sid}`)).json.days[0].slots.map((x: { start: number }) => x.start);
    expect(starts).toContain(600); // non-blocking note at 10:00
    expect(starts).not.toContain(660); // blocking note at 11:00
    expect((await stylist('POST', '/absences', { ...note(false, 720), note: '  ' })).status).toBe(400);
    expect((await stylist('POST', '/absences', { stylistId: sid, from: { date: '2026-11-05', minute: 0 }, to: { date: '2026-11-05', minute: 1440 }, kind: 'vacation' })).status).toBe(403);
    const vac = await owner('POST', '/absences', { stylistId: sid, from: { date: '2026-11-05', minute: 0 }, to: { date: '2026-11-05', minute: 1440 }, kind: 'sick' });
    expect(vac.status).toBe(201);
    expect((await stylist('DELETE', `/absences/${vac.json.id}`)).status).toBe(404); // not theirs to remove
    expect((await stylist('DELETE', `/absences/${free.json.id}`)).status).toBe(204);
    expect((await owner('DELETE', `/absences/${vac.json.id}`)).status).toBe(204);
  });
});
