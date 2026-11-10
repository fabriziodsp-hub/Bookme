import { expect, test } from '@playwright/test';
import { login, noSplash, SLUG } from './helpers';

const TODAY = '2026-11-02'; // frozen clock of the e2e server (Monday)

test('logo: staff go back to today’s calendar, clients to the booking page (D-051)', async ({ page }) => {
  await login(page);
  await page.goto(`/${SLUG}/team?date=2026-11-05`);
  await expect(page.locator('[data-day][aria-current="date"]')).toHaveAttribute('data-day', '2026-11-05');
  await page.getByRole('link', { name: 'Salon Beispiel' }).first().click();
  await expect(page).toHaveURL(new RegExp(`/${SLUG}/team$`));
  await expect(page.locator('[data-day][aria-current="date"]')).toHaveAttribute('data-day', TODAY);

  await page.getByRole('link', { name: /Einstellungen/ }).click();
  await page.getByRole('link', { name: 'Salon Beispiel' }).first().click();
  await expect(page).toHaveURL(new RegExp(`/${SLUG}/team$`));

  const client = await page.context().browser()!.newPage();
  await noSplash(client);
  await client.goto(`/${SLUG}/impressum`);
  await client.getByRole('link', { name: 'Salon Beispiel' }).first().click();
  await expect(client).toHaveURL(new RegExp(`/${SLUG}$`));
  await client.close();
});

test('the client’s name in the appointment panel opens the client card (D-051)', async ({ page }) => {
  await login(page);
  await page.goto(`/${SLUG}/team?date=2026-11-04`);
  await page.locator('.blk').first().click();
  const name = page.locator('#panel-h a');
  await expect(name).toBeVisible();
  await name.click();
  await expect(page).toHaveURL(new RegExp(`/${SLUG}/team/kunden/`));
  await expect(page.getByRole('heading', { name: 'Farbrezepturen' })).toBeVisible();
});
