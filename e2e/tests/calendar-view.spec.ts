import { expect, test } from '@playwright/test';
import { login, SLUG } from './helpers';

/** Calendar fits the screen, "Ganzer Tag" / "Klassisch", full screen, wheel = next day (D-060). */
test.describe('calendar view', () => {
  test.skip(() => test.info().project.name !== 'desktop', 'pointer + wheel: desktop');

  test('Ganzer Tag fits the grid to the screen, Klassisch is the old scale; the page itself does not scroll', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await login(page);
    await page.goto(`/${SLUG}/team?date=2026-11-04`);
    await expect(page.locator('.blk').first()).toBeVisible();
    const grid = page.locator('.tg-wrap');
    const fit = Number(await grid.getAttribute('data-px'));
    expect(fit).toBeGreaterThanOrEqual(1.05);
    expect(fit).toBeLessThan(1.8);
    // whole opening day visible without scrolling, page without scrollbar
    expect(await grid.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(2);
    expect(await page.evaluate(() => document.documentElement.scrollHeight - innerHeight)).toBeLessThanOrEqual(1);
    await page.getByRole('button', { name: 'Klassisch' }).click();
    await expect(grid).toHaveAttribute('data-px', '1.800');
    await page.reload();
    await expect(page.getByRole('button', { name: 'Klassisch' })).toHaveAttribute('aria-pressed', 'true'); // remembered per device
    await page.getByRole('button', { name: 'Ganzer Tag' }).click();
  });

  test('mouse wheel over the day strip moves day by day; full screen keeps the controls', async ({ page }) => {
    await login(page);
    await page.goto(`/${SLUG}/team?date=2026-11-04`);
    await expect(page.locator('[data-day][aria-current="date"]')).toHaveAttribute('data-day', '2026-11-04');
    const strip = page.locator('.strip');
    await strip.hover();
    await page.mouse.wheel(0, 120);
    await expect(page.locator('[data-day][aria-current="date"]')).toHaveAttribute('data-day', '2026-11-05');
    await page.waitForTimeout(500);
    await page.mouse.wheel(0, -120);
    await expect(page.locator('[data-day][aria-current="date"]')).toHaveAttribute('data-day', '2026-11-04');

    await page.getByRole('button', { name: 'Vollbild' }).click();
    await expect(page.locator('main.cal-full')).toBeVisible();
    const box = (await page.locator('main.cal-full').boundingBox())!;
    const vp = page.viewportSize()!;
    expect([box.x, box.y, Math.round(box.width), Math.round(box.height)]).toEqual([0, 0, vp.width, vp.height]); // covers header and tabs
    await page.getByRole('button', { name: 'Nächster Öffnungstag' }).click();
    await expect(page.locator('[data-day][aria-current="date"]')).toHaveAttribute('data-day', '2026-11-05');
    await page.getByRole('button', { name: 'Vollbild beenden' }).click();
    await expect(page.locator('main.cal-full')).toHaveCount(0);
  });
});
