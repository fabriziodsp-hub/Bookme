import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { H, login, SLUG } from './helpers';

/** Calendar fits the screen, "Ganzer Tag" / "Klassisch", full screen, wheel = next day (D-060). */
test.describe('calendar view', () => {
  test.skip(() => test.info().project.name !== 'desktop', 'pointer + wheel: desktop');

  test('Ganzer Tag fits the grid to the screen, Klassisch is the old scale; the page itself does not scroll', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 }); // Full HD: the whole 08–17 day fits at ≥ 1.2 px/min
    await login(page);
    await page.goto(`/${SLUG}/team?date=2026-11-04`);
    await expect(page.locator('.blk').first()).toBeVisible();
    const grid = page.locator('.tg-wrap');
    const fit = Number(await grid.getAttribute('data-px'));
    expect(fit).toBeGreaterThanOrEqual(1.2);
    expect(fit).toBeLessThan(1.8);
    // whole opening day visible without scrolling, page without scrollbar
    expect(await grid.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(2);
    expect(await page.evaluate(() => document.documentElement.scrollHeight - innerHeight)).toBeLessThanOrEqual(1);
    await page.getByRole('button', { name: 'Menü', exact: true }).click();
    await page.getByRole('dialog', { name: 'Menü' }).getByRole('button', { name: /Klassische Ansicht/ }).click();
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

    // Ganzer Tag = full-screen calendar (D-069): covers header and tabs, one bar, the rest in the menu drawer
    await expect(page.locator('main.cal-full')).toBeVisible();
    const box = (await page.locator('main.cal-full').boundingBox())!;
    const vp = page.viewportSize()!;
    expect([box.x, box.y, Math.round(box.width), Math.round(box.height)]).toEqual([0, 0, vp.width, vp.height]);
    await page.getByRole('button', { name: 'Nächster Öffnungstag' }).click();
    await expect(page.locator('[data-day][aria-current="date"]')).toHaveAttribute('data-day', '2026-11-05');
    await expect(page.locator('.cal-bar').getByRole('link', { name: /Anfragen/ })).toBeVisible();
    await page.getByRole('button', { name: 'Menü', exact: true }).click();
    const drawer = page.getByRole('dialog', { name: 'Menü' });
    await expect(drawer.getByRole('link', { name: /Einstellungen/ })).toBeVisible();
    await page.evaluate(() => {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync('*, *::before, *::after { transition: none !important; animation: none !important; }');
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    });
    const axe = await new AxeBuilder({ page }).include('#cal-drawer').include('.cal-bar').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    expect(axe.violations.map((v) => `${v.id}: ${v.nodes[0]?.target.join(' ')}`)).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    await page.getByRole('button', { name: 'Menü', exact: true }).click();
    await drawer.getByRole('button', { name: /Klassische Ansicht/ }).click();
    await expect(page.locator('main.cal-full')).toHaveCount(0);
    await page.getByRole('button', { name: 'Ganzer Tag' }).click(); // back for the next tests on this device
  });

  test('click on an empty spot opens "Neuer Termin" at that time; client search first, "+" for a new card (D-064, D-067)', async ({ page }) => {
    const day = ['2027-04-05', '2027-04-12', '2027-04-19'][test.info().retry] ?? '2027-04-26'; // empty Mondays, one per retry
    await login(page);
    await page.goto(`/${SLUG}/team?date=${day}`);
    await page.getByRole('button', { name: 'Team', exact: true }).click();
    const col = page.locator('.tg-col').first();
    await expect(col).toBeVisible();
    const ppm = Number(await page.locator('.tg-wrap').getAttribute('data-px'));
    await page.locator('.tg-wrap').evaluate((el) => (el.scrollTop = 0));
    const box = (await col.boundingBox())!;
    await page.mouse.click(box.x + 40, box.y + (10 * 60 + 7 - 8 * 60) * ppm); // 10:07 → 10:00
    const dialog = page.getByRole('dialog', { name: 'Neuer Termin' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('Start')).toHaveValue('10:00');
    await expect(dialog.getByRole('combobox', { name: /Kundin \/ Kunde suchen/ })).toBeFocused();
    await expect(dialog.getByRole('button', { name: 'Anlegen' })).toBeDisabled();

    // existing card: search and pick
    const r = await page.request.get('/api/staff/customers?limit=1', { headers: H });
    const c = ((await r.json()) as { customers: { firstName: string; lastName: string }[] }).customers[0]!;
    await dialog.getByRole('combobox', { name: /Kundin \/ Kunde suchen/ }).fill(c.lastName);
    await dialog.getByRole('button', { name: new RegExp(`${c.firstName} ${c.lastName}`) }).first().click();
    await expect(dialog.getByRole('button', { name: 'Ändern' })).toBeVisible();

    // or a new card with "+": a typed name is carried over
    await dialog.getByRole('button', { name: 'Ändern' }).click();
    await dialog.getByRole('combobox', { name: /Kundin \/ Kunde suchen/ }).fill('Erna Neu');
    await dialog.getByRole('button', { name: 'Neue Kundin / neuer Kunde' }).click();
    await expect(dialog.getByLabel('Vorname')).toHaveValue('Erna');
    await expect(dialog.getByLabel('Nachname')).toHaveValue('Neu');
    await dialog.getByLabel('Telefon').fill('0151 99999999');
    await dialog.getByLabel('Leistung').selectOption({ label: 'Rentner-Schnitt' });
    await dialog.getByRole('button', { name: 'Anlegen' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('.blk', { hasText: 'Erna Neu' })).toBeVisible();
    await expect(page.locator('.blk', { hasText: 'Erna Neu' }).first()).toContainText('10:00–10:20');
  });
});


test.describe('column buttons: working hours (owner) and internal notes (D-071, D-072)', () => {
  test.skip(() => test.info().project.name !== 'desktop', 'shared team data – desktop only');

  test('a note that does not block, shown in the column; the hours dialog saves (axe on both)', async ({ page }) => {
    const day = ['2027-05-03', '2027-05-10', '2027-05-17'][test.info().retry] ?? '2027-05-24';
    await login(page);
    await page.goto(`/${SLUG}/team?date=${day}`);
    await page.getByRole('button', { name: 'Team', exact: true }).click();
    const axe = async (sel: string) => {
      await page.evaluate(() => {
        const sheet = new CSSStyleSheet(); // no half-faded colours (dialog animation)
        sheet.replaceSync('*, *::before, *::after { transition: none !important; animation: none !important; }');
        document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
      });
      const r = await new AxeBuilder({ page }).include(sel).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
      expect(r.violations.map((v) => `${v.id}: ${v.nodes[0]?.target.join(' ')}`)).toEqual([]);
    };
    await page.getByRole('button', { name: /^Notiz im Kalender für Sophie/ }).click();
    const dlg = page.getByRole('dialog', { name: 'Notiz im Kalender' });
    await dlg.getByLabel(/Text/).fill('E2E Lieferung');
    await dlg.getByLabel('Von').fill('10:00');
    await dlg.getByLabel('Bis').fill('10:30');
    await expect(dlg.getByRole('checkbox', { name: /Blockiert die Arbeitszeit/ })).not.toBeChecked();
    await axe('.sheet');
    await dlg.getByRole('button', { name: 'Anlegen' }).click();
    await expect(dlg).toBeHidden();
    const note = page.locator('.note-blk', { hasText: 'E2E Lieferung' });
    await expect(note).toBeVisible();
    await expect(note).toHaveClass(/free/);

    await page.getByRole('button', { name: /^Arbeitszeiten und Abwesenheiten von Sophie/ }).click();
    const hrs = page.getByRole('dialog', { name: /Arbeitszeiten – Sophie/ });
    await hrs.getByLabel('Samstag: Arbeitszeit').selectOption('own'); // same times as the salon: no effect on other tests
    await axe('.sheet');
    await hrs.getByRole('button', { name: 'Speichern' }).click();
    await expect(hrs).toBeHidden();
    await page.getByRole('button', { name: /^Arbeitszeiten und Abwesenheiten von Sophie/ }).click();
    await expect(hrs.getByLabel('Samstag: Arbeitszeit')).toHaveValue('own');
    await hrs.getByLabel('Samstag: Arbeitszeit').selectOption('salon');
    await hrs.getByRole('button', { name: 'Speichern' }).click();
    await expect(hrs).toBeHidden();
  });
});
