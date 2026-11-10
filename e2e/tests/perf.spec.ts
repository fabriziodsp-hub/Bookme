import { expect, test } from '@playwright/test';
import { H, login, SLUG } from './helpers';

test.skip(() => test.info().project.name !== 'desktop', 'measured once, on desktop');

test('API latency with the seeded data set (~2 000 appointments)', async ({ page }) => {
  await login(page);
  const measure = async (url: string, n = 30) => {
    const ms: number[] = [];
    for (let i = 0; i < n; i++) {
      const t0 = performance.now();
      const r = await page.request.get(url, { headers: H });
      expect(r.ok()).toBeTruthy();
      ms.push(performance.now() - t0);
    }
    ms.sort((a, b) => a - b);
    return { p50: Math.round(ms[Math.floor(n / 2)]!), p95: Math.round(ms[Math.floor(n * 0.95)]!) };
  };
  const cal = await measure('/api/staff/calendar?from=2026-11-16&days=7');
  const av = await measure(`/api/s/${SLUG}/availability?serviceId=color_root&audience=women&adult=true&from=2026-11-16&days=7`);
  test.info().annotations.push({ type: 'perf', description: `calendar week p50 ${cal.p50} ms / p95 ${cal.p95} ms; availability week p50 ${av.p50} ms / p95 ${av.p95} ms` });
  expect(cal.p95).toBeLessThan(200);
  expect(av.p95).toBeLessThan(200);
});

test('team week drag stays smooth: no long tasks > 50 ms while dragging', async ({ page }) => {
  await login(page);
  await page.goto(`/${SLUG}/team?date=2026-11-18`);
  await page.getByRole('button', { name: 'Mein Tag', exact: true }).click();
  await page.getByRole('button', { name: 'Woche', exact: true }).click();
  await expect(page.locator('.blk').first()).toBeVisible();
  const blocks = await page.locator('.blk').count();
  await page.evaluate(() => {
    (window as any).__long = [];
    new PerformanceObserver((l) => l.getEntries().forEach((e) => (window as any).__long.push(e.duration))).observe({ type: 'longtask', buffered: false });
  });
  const grip = page.locator('.blk .grip').nth(3);
  await grip.scrollIntoViewIfNeeded();
  const b = (await grip.boundingBox())!;
  await page.mouse.move(b.x + 10, b.y + 10);
  await page.mouse.down();
  for (let i = 0; i < 60; i++) await page.mouse.move(b.x + 10 + (i % 7) * 20, b.y + 10 + i * 3);
  const long = (await page.evaluate(() => (window as any).__long)) as number[];
  await page.keyboard.press('Escape');
  await page.mouse.up();
  test.info().annotations.push({ type: 'perf', description: `${blocks} blocks rendered; long tasks during drag: ${JSON.stringify(long.map(Math.round))}` });
  expect(long.filter((d) => d > 50)).toEqual([]);
});
