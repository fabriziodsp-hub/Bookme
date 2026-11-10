import { expect, test } from '@playwright/test';
import { noSplash, OWNER, SLUG } from './helpers';

test('staff log in with the user name instead of the e-mail (D-049)', async ({ page }) => {
  await noSplash(page);
  await page.goto(`/${SLUG}/team`);
  await page.getByLabel('E-Mail oder Benutzername').fill('maria');
  await page.getByLabel('Passwort').fill(OWNER.password);
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await expect(page.getByRole('link', { name: 'Kalender' })).toBeVisible();
});

test('/{salon}/admin leads to the salon settings; unknown addresses get a readable page (D-050)', async ({ page }) => {
  await noSplash(page);
  await page.goto(`/${SLUG}/admin`);
  await expect(page).toHaveURL(new RegExp(`/${SLUG}/team/einstellungen$`));
  await expect(page.getByLabel('E-Mail oder Benutzername')).toBeVisible(); // login first, then the settings

  await page.goto(`/${SLUG}/gibt-es-nicht`);
  await expect(page.getByRole('heading', { name: 'Seite nicht gefunden' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Zur Terminbuchung' })).toHaveAttribute('href', `/${SLUG}/buchen`);
});
