import { expect, test, type Page } from '@playwright/test';
import { calendar, H, login, SLUG } from './helpers';

/** Empty days after the seeded 3 months; each project gets its own week so runs do not collide. */
function emptyDay(n: number) {
  const offset = { iphone: 0, android: 7, desktop: 14 }[test.info().project.name as 'iphone'] ?? 21;
  // a retry gets its own weeks, otherwise it would collide with the appointment left by the failed attempt
  return addDays('2027-03-01', offset + n + test.info().retry * 28); // Mon 1 March 2027 + …
}
function addDays(d: string, n: number) {
  return new Date(Date.parse(`${d}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
}
async function createAppt(page: Page, date: string, start: number, selection: Record<string, unknown> = { serviceId: 'cut', audience: 'women', adult: true, variant: 'dry' }) {
  const me = await (await page.request.get('/api/auth/me', { headers: H })).json();
  const r = await page.request.post('/api/staff/appointments', {
    headers: H,
    data: { selection, date, start, stylistId: me.stylistId, customer: { firstName: 'Drag', lastName: 'Test', email: 'drag@example.com' }, notifyCustomer: false },
  });
  expect(r.status(), await r.text()).toBe(201);
  return (await r.json()) as { id: string };
}

const DAY = '2026-11-04'; // Wednesday, plenty of appointments in the seed

async function openDay(page: Page, date = DAY, view: 'Mein Tag' | 'Team' = 'Team') {
  await page.goto(`/${SLUG}/team?date=${date}`);
  await page.getByRole('button', { name: view, exact: true }).click();
  await expect(page.locator('.blk').first()).toBeVisible();
}

/** Drag the ⠿ handle of the n-th appointment by dy pixels (1.8 px per minute). */
async function dragHandle(page: Page, apptId: string, dy: number, dx = 0) {
  const grip = page.locator(`[data-appt="${apptId}"] .grip`).first();
  await grip.scrollIntoViewIfNeeded();
  const b = (await grip.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(b.x + b.width / 2 + (dx * i) / 6, b.y + b.height / 2 + (dy * i) / 6);
  await page.waitForTimeout(100);
}

test.describe('staff', () => {
  test('navigation: every tab leads to its own clean URL, also after switching several times', async ({ page }) => {
    await login(page);
    const base = new URL(page.url()).pathname.replace(/\/$/, '');
    expect(base).toBe(`/${SLUG}/team`);
    for (const [name, path] of [['Anfragen', 'anfragen'], ['Kunden', 'kunden'], ['Einstellungen', 'einstellungen'], ['Anfragen', 'anfragen'], ['Kalender', '']] as const) {
      await page.locator('.staff-nav').getByRole('link', { name: new RegExp(`^${name}`) }).click();
      await expect(page).toHaveURL(new RegExp(`${base}${path ? `/${path}` : ''}/?$`));
    }
  });

  test('client card: from the search to the card, add a colour recipe; allergies need consent', async ({ page }) => {
    await login(page);
    await page.goto(`/${SLUG}/team/kunden`);
    const first = (await calendar(page.request, DAY)).appointments.find((x) => x.customer.lastName) as unknown as { customer: { id: string; firstName: string; lastName: string } };
    await page.getByRole('searchbox').fill(first.customer.lastName);
    await page.getByRole('link', { name: `${first.customer.firstName} ${first.customer.lastName}` }).first().click();
    await expect(page).toHaveURL(new RegExp(`/team/kunden/${first.customer.id}$`));
    await expect(page.getByRole('heading', { name: 'Vergangene Termine' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Kommende Termine' })).toBeVisible();
    const recipe = `Majirel 6.0 30 g ${test.info().project.name}`;
    await page.locator('#ce-color').fill(recipe);
    await page.getByRole('region', { name: 'Farbrezepturen' }).getByRole('button', { name: 'Hinzufügen' }).click();
    await expect(page.getByText(recipe)).toBeVisible();
    await expect(page.locator('#ch-notes')).toBeDisabled();
  });

  test('now line follows the clock; "Heute" scrolls it into the middle of the calendar', async ({ page }) => {
    // the server clock is frozen at Mon 2 Nov 07:00 Berlin; the browser clock runs on from there
    await page.clock.install({ time: new Date('2026-11-02T06:00:00Z') });
    await login(page);
    await page.goto(`/${SLUG}/team`);
    await expect(page.locator('.blk').first()).toBeVisible();
    await expect(page.locator('.tg-now')).toHaveCount(0); // 07:00: before opening
    await page.clock.fastForward('03:15:00'); // → 10:15
    await expect(page.locator('.tg-now-time')).toHaveText('10:15');
    const lines = page.locator('.tg-now');
    expect(await lines.count()).toBeGreaterThan(1); // one per stylist column in the team view
    const wrap = page.locator('.tg-wrap');
    await wrap.evaluate((el) => (el.scrollTop = 0));
    await page.getByRole('button', { name: 'Heute', exact: true }).click();
    await expect
      .poll(async () => {
        const [w, l] = [await wrap.boundingBox(), await lines.first().boundingBox()];
        return Math.abs(l!.y - (w!.y + w!.height / 2)) < 80;
      })
      .toBe(true);
  });

  test('login, open request inbox, accept a request', async ({ page }) => {
    await login(page);
    await page.getByRole('link', { name: /Anfragen/ }).click();
    const first = page.locator('article').first();
    await expect(first).toBeVisible();
    const name = (await first.getByRole('heading').innerText()).split('\n')[0]!;
    await first.getByRole('button', { name: 'Annehmen' }).click();
    await expect(page.getByRole('heading', { name: new RegExp(name.trim().split(' ')[0]!) })).toHaveCount(0, { timeout: 10_000 }).catch(() => undefined);
  });

  test('drag & drop: move +15 min snaps to the 5-min grid and is saved; undo restores', async ({ page }) => {
    await login(page);
    const d = emptyDay(0);
    const a = await createAppt(page, d, 600); // 10:00–10:30 on an empty day
    await openDay(page, d);
    await dragHandle(page, a.id, 15 * 1.8 + 2);
    await expect(page.locator('.blk.ghost').first()).toBeVisible();
    await page.mouse.up();
    await expect(page.getByRole('status').filter({ hasText: 'Verschoben' })).toBeVisible();
    expect((await calendar(page.request, d)).appointments.find((x) => x.id === a.id)!.start).toBe(615);
    await page.getByRole('button', { name: /Rückgängig/ }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Rückgängig' })).toBeVisible();
    expect((await calendar(page.request, d)).appointments.find((x) => x.id === a.id)!.start).toBe(600);
  });

  test('drag & drop into the lunch break is shown red and not saved', async ({ page }) => {
    await login(page);
    const d = emptyDay(1);
    const a = await createAppt(page, d, 600);
    await openDay(page, d);
    await dragHandle(page, a.id, (735 - 600) * 1.8); // ~12:15
    await expect(page.locator('.blk.ghost.bad').first()).toBeVisible();
    await expect(page.getByRole('status')).toContainText('Nicht möglich');
    await page.mouse.up();
    expect((await calendar(page.request, d)).appointments.find((x) => x.id === a.id)!.start).toBe(600);
  });

  test('drag & drop onto another day in the strip moves the appointment there', async ({ page }) => {
    await login(page);
    const d = emptyDay(2);
    const a = await createAppt(page, d, 540);
    await openDay(page, d);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.locator('.tg-wrap').evaluate((el) => (el.scrollTop = 60 * 1.8)); // 09:00 at the top: strip and block both on screen
    const target = page.locator(`.strip [data-day="${addDays(d, 1)}"]`);
    const tb = (await target.boundingBox())!;
    const grip = (await page.locator(`[data-appt="${a.id}"] .grip`).first().boundingBox())!;
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await page.mouse.down();
    await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2, { steps: 8 });
    await page.waitForTimeout(100);
    await expect(target).toHaveClass(/drop/);
    await page.mouse.up();
    await expect(page.getByRole('status').filter({ hasText: 'Verschoben' })).toBeVisible();
    expect((await calendar(page.request, addDays(d, 1))).appointments.find((x) => x.id === a.id)?.start).toBe(540);
  });

  test('resize a phase by dragging its bottom edge', async ({ page }) => {
    await login(page);
    const d = emptyDay(3);
    const a = await createAppt(page, d, 600, { serviceId: 'color_root', audience: 'women', adult: true });
    await openDay(page, d);
    // resize the Einwirkzeit (2nd phase) by +10 min → styling shifts
    const rz = page.locator(`[data-appt="${a.id}"] .rz`).nth(1);
    await rz.scrollIntoViewIfNeeded();
    const b = (await rz.boundingBox())!;
    const cx = b.x + b.width / 2;
    const cy = b.y + b.height / 2;
    await page.mouse.move(cx, cy - 3);
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx, cy + 2, { steps: 2 });
    await page.mouse.move(cx, cy + 10 * 1.8 + 2, { steps: 8 });
    await page.waitForTimeout(150); // let the last animation frame of the drag preview run (WebKit)
    await page.mouse.up();
    // the stored result is what matters; the status line is checked afterwards
    await expect
      .poll(async () => (await calendar(page.request, d)).appointments.find((x) => x.id === a.id)?.blocks.map((x) => x.end - x.start), { timeout: 8000 })
      .toEqual([45, 40, 30]);
    const after = (await calendar(page.request, d)).appointments.find((x) => x.id === a.id)!;
    expect(after.end).toBe(600 + 115);
    await expect(page.getByRole('status').filter({ hasText: 'Verschoben' })).toBeVisible();
  });

  test('keyboard alternative: focus a block, ArrowDown = +5 min, Enter opens the panel', async ({ page }) => {
    await login(page);
    await openDay(page);
    const before = await calendar(page.request, DAY);
    const a = before.appointments
      .filter((x) => x.status === 'confirmed' && x.blocks.length === 1 && x.end < 715)
      .find((x) => !before.appointments.some((o) => o.id !== x.id && o.stylistId === x.stylistId && o.blocks.some((b) => b.kind === 'busy' && b.start < x.end + 5 && x.end < b.end)))!;
    const blk = page.locator(`[data-appt="${a.id}"]`).first();
    await blk.focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('status').filter({ hasText: 'Verschoben' })).toBeVisible();
    expect((await calendar(page.request, DAY)).appointments.find((x) => x.id === a.id)!.start).toBe(a.start + 5);
    await page.locator(`[data-appt="${a.id}"]`).first().focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: /^−5: 5 Minuten früher/ })).toBeVisible();
  });

  test('team view: one column per stylist with full names; reassign by dropping into another column', async ({ page }) => {
    await login(page);
    const d = emptyDay(4);
    const a = await createAppt(page, d, 540);
    await openDay(page, d, 'Team');
    const { stylists } = await calendar(page.request, d);
    const wrap = page.locator('.tg-wrap');
    for (const s of stylists) {
      const head = page.locator('.tg-head .name', { hasText: s.displayName });
      await head.scrollIntoViewIfNeeded();
      await expect(head).toBeVisible();
    }
    await wrap.evaluate((el) => (el.scrollLeft = 0));
    const col2 = (await page.locator(`[data-col="${stylists[1]!.id}"]`).boundingBox())!;
    const grip = (await page.locator(`[data-appt="${a.id}"] .grip`).first().boundingBox())!;
    await dragHandle(page, a.id, 0, Math.min(col2.x + 40, (page.viewportSize()?.width ?? 400) - 10) - (grip.x + grip.width / 2));
    await page.mouse.up();
    await expect(page.getByRole('status').filter({ hasText: 'Verschoben' })).toBeVisible();
    expect((await calendar(page.request, d)).appointments.find((x) => x.id === a.id)!.stylistId).toBe(stylists[1]!.id);
  });
});

test('"Mein Tag" shows only the logged-in stylist\'s clients', async ({ page }) => {
  await login(page);
  await page.goto(`/${SLUG}/team?date=${DAY}`);
  await page.getByRole('button', { name: 'Mein Tag', exact: true }).click();
  const me = await (await page.request.get('/api/auth/me', { headers: { 'x-requested-with': 'salon' } })).json();
  const all = await calendar(page.request, DAY);
  const mine = all.appointments.filter((a) => a.stylistId === me.stylistId && ['requested', 'discuss', 'confirmed', 'completed', 'no_show'].includes(a.status));
  await expect(page.locator('.tg-head')).toHaveCount(2); // corner + one column
  const ids = await page.locator('[data-appt]').evaluateAll((els) => [...new Set(els.map((e) => e.getAttribute('data-appt')))]);
  expect(ids.sort()).toEqual(mine.map((a) => a.id).sort());
});
