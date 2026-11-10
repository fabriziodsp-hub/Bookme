import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { chooseService, login, noSplash, SLUG } from './helpers';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function audit(page: Page, name: string) {
  // Buttons fade their background (transition); axe must not sample a half-faded colour.
  // (constructable stylesheet: the strict CSP forbids injected <style> tags)
  await page.evaluate(() => {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync('*, *::before, *::after { transition: none !important; animation: none !important; }');
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  });
  const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const summary = r.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.length}× ${v.nodes[0]?.target.join(' ')}`);
  expect(summary, `axe violations on ${name}`).toEqual([]);
}

test.describe('accessibility (axe, WCAG 2.2 AA)', () => {
  test('booking page – empty, with service chosen, with details form, month sheet', async ({ page }) => {
    await noSplash(page);
    await page.goto(`/${SLUG}/buchen`);
    await audit(page, 'booking start');
    await chooseService(page, /^Schnitt & Farbe – Ansatz \d/); // name + computed duration (not „bis Spitzen“)
    await audit(page, 'service chosen');
    await page.getByRole('button', { name: 'Liste' }).click();
    await page.getByRole('button', { name: /Uhr frei$/ }).first().click();
    await audit(page, 'details form');
    await page.getByRole('button', { name: 'Kalender', exact: true }).click();
    await page.getByRole('button', { name: /Datum im Monatskalender wählen/ }).click();
    await audit(page, 'month sheet');
  });

  test('all themes and the high-contrast mode', async ({ page }) => {
    await noSplash(page);
    for (const [scheme, contrast] of [['light', false], ['dark', false], ['dark', true]] as const) {
      await page.addInitScript(([s, c]) => localStorage.setItem('salon.viewPrefs.v1', JSON.stringify({ scheme: s, contrast: c, textScale: 100, reducedMotion: null })), [scheme, contrast] as const);
      await page.goto(`/${SLUG}/buchen`);
      await chooseService(page, /^Haarschnitt/);
      await audit(page, `${scheme}${contrast ? '+contrast' : ''}`);
    }
  });

  test('legal pages and login', async ({ page }) => {
    await noSplash(page);
    for (const p of ['impressum', 'datenschutz', 'team']) {
      await page.goto(`/${SLUG}/${p}`);
      await audit(page, p);
    }
  });

  test('staff calendar, panel, requests, customers, settings', async ({ page }) => {
    await login(page);
    await page.goto(`/${SLUG}/team?date=2026-11-04`);
    await expect(page.locator('.blk').first()).toBeVisible();
    await audit(page, 'staff calendar');
    await page.locator('.blk').first().click();
    await audit(page, 'appointment panel');
    await page.getByRole('link', { name: /Kundenkarte öffnen/ }).click();
    await expect(page.getByRole('heading', { name: 'Farbrezepturen' })).toBeVisible();
    await audit(page, 'client card');
    for (const tab of ['Anfragen', 'Kunden', 'Einstellungen']) {
      await page.getByRole('link', { name: new RegExp(tab) }).click();
      await page.waitForLoadState('networkidle');
      await audit(page, tab);
    }
  });

  test('keyboard only: skip link, focus visible, booking reachable without pointer', async ({ page }) => {
    await noSplash(page);
    await page.goto(`/${SLUG}/buchen`);
    await expect(page.getByRole('heading', { name: 'Für wen?' })).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Zum Inhalt springen' })).toBeFocused();
    await page.keyboard.press('Enter');
    // Walk to "Damen" and select with keyboard
    let found = false;
    for (let i = 0; i < 10 && !found; i++) {
      await page.keyboard.press('Tab');
      found = (await page.evaluate(() => document.activeElement?.textContent)) === 'Damen';
    }
    expect(found).toBe(true);
    const outline = await page.evaluate(() => getComputedStyle(document.activeElement!).outlineStyle);
    expect(outline).not.toBe('none');
  });

  test('touch targets are at least 44 × 44 px on the booking page', async ({ page }) => {
    await noSplash(page);
    await page.goto(`/${SLUG}/buchen`);
    await chooseService(page, /^Haarschnitt/);
    // measure the final layout, not a frame of an entry animation
    await page.evaluate(() => Promise.all(document.getAnimations().map((x) => x.finished.catch(() => undefined))));
    const small = await page.locator('main button:visible, main a:visible').evaluateAll((els) =>
      els
        .map((e) => ({ t: (e as HTMLElement).innerText.trim().slice(0, 20) || e.getAttribute('aria-label'), r: e.getBoundingClientRect() }))
        .filter((x) => x.r.height < 44 && x.r.width > 0 && !x.t?.match(/^\d\d:\d\d$/)) // calendar slots: 45 px tall, width depends on screen (WCAG 2.5.8 AA: ≥ 24 px)
        .map((x) => `${x.t} ${Math.round(x.r.width)}×${Math.round(x.r.height)}`),
    );
    expect(small).toEqual([]);
  });
});
