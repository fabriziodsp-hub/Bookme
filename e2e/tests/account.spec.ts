import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { classicCalendar, H, login, SLUG } from './helpers';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'];

async function axe(page: Page, include?: string) {
  await page.evaluate(() => {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync('*, *::before, *::after { transition: none !important; animation: none !important; }');
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  });
  const b = new AxeBuilder({ page }).withTags(TAGS);
  const r = await (include ? b.include(include) : b).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes[0]?.target.join(' ')}`)).toEqual([]);
}

test('account menu on the name: switch profile and log out; no logout tab any more (D-055)', async ({ page }) => {
  await classicCalendar(page);
  await login(page);
  await expect(page.locator('.staff-nav').getByRole('button', { name: 'Abmelden' })).toHaveCount(0);
  const menu = page.getByRole('button', { name: /Maria .*Konto-Menü/ });
  await menu.click();
  await expect(menu).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('button', { name: 'Abmelden' })).toBeVisible();
  // only the menu: while it is open it covers part of the toolbar below it (popover)
  await axe(page, '.user-menu');
  await page.keyboard.press('Escape');
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await expect(menu).toBeFocused();

  await menu.click();
  await page.getByRole('button', { name: 'Profil wechseln' }).click();
  await page.getByRole('button', { name: /^Als Sophie .* anmelden$/ }).click();
  await expect(page.getByText(/Anmeldung für Sophie/)).toBeVisible();
  await expect(page.getByLabel('E-Mail oder Benutzername')).toHaveValue('sophie');
  await expect(page.getByLabel('Passwort')).toBeFocused();
});

test('settings by category: overview, one page per category, logout under "Konto" (D-058)', async ({ page }) => {
  await login(page);
  await page.goto(`/${SLUG}/team/einstellungen`);
  for (const name of ['Konto', 'Ansicht', 'Leistungen & Dauern', 'Preisliste', 'Öffnungszeiten', 'Startseite', 'Aussehen', 'Team']) {
    await expect(page.getByRole('link', { name: new RegExp(`^${name}`) }).first()).toBeVisible();
  }
  await axe(page);
  await page.getByRole('link', { name: /^Öffnungszeiten/ }).click();
  await expect(page).toHaveURL(new RegExp(`/team/einstellungen/oeffnungszeiten$`));
  await expect(page.getByRole('heading', { level: 1, name: 'Öffnungszeiten' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Öffnungszeiten', exact: true })).toHaveAttribute('aria-current', 'page');
  await axe(page);
  await page.getByRole('link', { name: 'Konto', exact: true }).click();
  await page.locator('main').getByRole('button', { name: 'Abmelden' }).click();
  await expect(page.getByLabel('E-Mail oder Benutzername')).toBeVisible();
});

test('client list is visible without a search, A–Z or by next appointment (D-056)', async ({ page }) => {
  await login(page);
  await page.goto(`/${SLUG}/team/kunden`);
  const items = page.locator('main article.list-item');
  await expect(items.first()).toBeVisible();
  expect(await items.count()).toBeGreaterThan(10);
  await expect(page.locator('.cs-letter').first()).toBeVisible();
  await page.getByRole('button', { name: 'Nächster Termin' }).click();
  await expect(page.getByRole('button', { name: 'Nächster Termin' })).toHaveAttribute('aria-pressed', 'true');
  await expect(items.first()).toContainText('Nächster Termin:');
  await axe(page);
});

test('owner deletes a staff profile after confirming (D-054)', async ({ page }) => {
  test.skip(test.info().project.name !== 'desktop', 'shared team – one project is enough');
  await login(page);
  await page.goto(`/${SLUG}/team/einstellungen/team`);
  await page.getByLabel('Anzeigename').fill('E2E Aushilfe');
  await page.getByRole('button', { name: 'Anlegen' }).click();
  const del = page.getByRole('button', { name: 'Profil löschen: E2E Aushilfe' });
  await expect(del).toBeVisible();
  await del.click();
  const dialog = page.getByRole('dialog', { name: 'Profil von E2E Aushilfe löschen?' });
  await expect(dialog).toBeVisible();
  await axe(page);
  await dialog.getByRole('button', { name: 'Abbrechen' }).click();
  await expect(dialog).toBeHidden();
  await del.click();
  await page.getByRole('dialog').getByRole('button', { name: 'Endgültig löschen' }).click();
  await expect(page.getByText('Profil von E2E Aushilfe gelöscht.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Profil löschen: E2E Aushilfe' })).toHaveCount(0);
});

test('Ansicht is also a settings category (D-059)', async ({ page }) => {
  await login(page);
  await page.goto(`/${SLUG}/team/einstellungen/ansicht`);
  await expect(page.getByRole('heading', { level: 1, name: 'Ansicht' })).toBeVisible();
  await page.getByRole('button', { name: /125 %/ }).click();
  await expect(page.locator('html')).toHaveAttribute('style', /--scale: 1.25/);
  await page.getByRole('button', { name: /100 %/ }).click();
  await axe(page);
});

test('calendar panel: the note to the client is saved first, then the answer is possible (D-057)', async ({ page }) => {
  test.skip(test.info().project.name !== 'desktop', 'shared requests – one project is enough');
  await login(page);
  const r = await page.request.get('/api/staff/requests', { headers: H });
  const req = ((await r.json()) as { requests: { id: string; date: string; needsReassign: boolean }[] }).requests.find((x) => !x.needsReassign)!;
  await page.goto(`/${SLUG}/team?date=${req.date}`);
  await page.getByRole('button', { name: 'Team', exact: true }).click();
  await page.locator(`.blk[data-appt="${req.id}"]`).first().click();
  const note = page.getByLabel('Notiz (optional)');
  await note.fill('E2E: Bitte Termin bestätigen.');
  await expect(page.getByRole('button', { name: 'Annehmen' })).toBeDisabled();
  await page.getByRole('button', { name: 'Notiz speichern (an die Kundin / den Kunden)' }).click();
  await expect(page.getByText('Wird mit Ihrer Antwort gesendet:')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Annehmen' })).toBeEnabled();
});
