import { expect, test } from '@playwright/test';
import { chooseService, login, noSplash, SLUG } from './helpers';

// Visual regression on Chromium projects only (baselines are per browser and OS).
test.skip(({ browserName }) => browserName !== 'chromium', 'chromium baselines only');
test.skip(() => test.info().project.name === 'iphone', 'iphone project may run on WebKit in CI');
// Baselines were rendered on the developer machine; the CI runner has different fonts and rendering.
// Run them locally (pnpm test:e2e) or set VISUAL=1 after regenerating the baselines on the runner.
test.skip(() => !!process.env.CI && !process.env.VISUAL, 'visual baselines are machine specific');

test('client week calendar (week of 16 Nov)', async ({ page }) => {
  await noSplash(page);
  await page.goto(`/${SLUG}/buchen`);
  await chooseService(page, /^Schnitt & Farbe – Ansatz \d/); // name + computed duration ("1 Std. 45 Min."), not "bis Spitzen"
  await page.getByRole('button', { name: 'Nächste Woche' }).click();
  await page.getByRole('button', { name: 'Nächste Woche' }).click();
  const cal = page.locator('.cal');
  await expect(cal.locator('.cal-slot').first()).toBeVisible();
  await expect(cal).toHaveScreenshot('client-week.png');
});

test('staff team day view (19 Nov)', async ({ page }) => {
  await login(page);
  await page.goto(`/${SLUG}/team?date=2026-11-19`);
  await page.getByRole('button', { name: 'Team', exact: true }).click();
  await expect(page.locator('.blk').first()).toBeVisible();
  await page.locator('.tg-wrap').evaluate((el) => (el.scrollTop = 0));
  await expect(page.locator('.tg-wrap')).toHaveScreenshot('staff-team.png');
});
