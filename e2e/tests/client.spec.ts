import { expect, test } from '@playwright/test';
import { chooseService, noSplash, SLUG } from './helpers';

test.describe('client booking (no account)', () => {
  test.beforeEach(async ({ page }) => noSplash(page));

  test('request a haircut → "noch nicht bestätigt" → manage link → cancel', async ({ page }) => {
    await page.goto(`/${SLUG}/buchen`);
    await chooseService(page, /^Haarschnitt/);
    await page.getByRole('radio', { name: /ohne Waschen/ }).click();
    await expect(page.getByRole('heading', { name: 'Dauer: 30 Min.' })).toBeVisible();
    // Next week (so the 12 h self-service window is still open), calendar view: tap the first free slot
    await page.getByRole('button', { name: 'Nächste Woche' }).click();
    const slot = page.locator('.cal-slot').first();
    await slot.scrollIntoViewIfNeeded();
    await slot.click();
    await page.getByLabel('Vorname').fill('Erika');
    await page.getByLabel('Nachname').fill('Testfrau');
    await page.getByLabel(/^E-Mail/).fill('erika.testfrau@example.com');
    await page.getByRole('checkbox', { name: /Datenschutzhinweise gelesen/ }).check();
    await page.getByRole('button', { name: 'Termin anfragen' }).click();
    await expect(page.getByRole('heading', { name: /Anfrage gesendet – noch nicht bestätigt/ })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/Buchungsnummer/)).toBeVisible();

    await page.getByRole('link', { name: /Termin ansehen, verschieben oder absagen/ }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Angefragt' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Zum Kalender hinzufügen' })).toHaveCount(0); // only when confirmed
    await page.getByRole('button', { name: 'Absagen' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Ja, absagen' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Abgesagt' })).toBeVisible();
  });

  test('list view, validation errors and focus', async ({ page }) => {
    await page.goto(`/${SLUG}/buchen`);
    await chooseService(page, /^Haarschnitt/);
    await page.getByRole('button', { name: 'Liste' }).click();
    await page.getByRole('button', { name: /Uhr frei$/ }).first().click();
    await page.getByRole('button', { name: 'Termin anfragen' }).click();
    await expect(page.getByText('Bitte Vornamen angeben.')).toBeVisible();
    await expect(page.getByText('Bitte Telefon oder E-Mail angeben.')).toBeVisible();
    await expect(page.getByText('Bitte bestätigen Sie, dass Sie die Datenschutzhinweise gelesen haben.')).toBeVisible();
    await expect(page.getByLabel('Vorname')).toBeFocused();
  });

  test('minors only see haircut and wash & set', async ({ page }) => {
    await page.goto(`/${SLUG}/buchen`);
    await page.getByRole('radio', { name: 'Minderjährig (unter 18)' }).click();
    await expect(page.getByText(/aus gesundheitlichen Gründen nicht verfügbar/)).toBeVisible();
    const services = page.getByRole('radiogroup', { name: 'Leistung' }).getByRole('radio');
    await expect(services).toHaveCount(2);
    await expect(page.getByRole('radio', { name: /Balayage/ })).toHaveCount(0);
  });

  test('Balayage: month sheet with 12 month chips, "Nächster freier Termin", fee consent required', async ({ page }) => {
    await page.goto(`/${SLUG}/buchen`);
    await chooseService(page, /^Balayage/);
    await expect(page.getByText(/Nur 08:00 \(Vormittag\) oder 13:00 Uhr/)).toBeVisible();
    await page.getByRole('button', { name: /Datum im Monatskalender wählen/ }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('group', { name: 'Monat wählen' }).getByRole('button')).toHaveCount(13);
    await dialog.getByRole('button', { name: 'Nächster freier Termin' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const slot = page.locator('.cal-slot').first();
    await slot.scrollIntoViewIfNeeded();
    await expect(slot).toHaveText(/^(08:00|13:00)$/);
    await slot.click();
    await expect(page.getByText(/Ausfallgebühr: 97/)).toBeVisible();
    await page.getByLabel('Vorname').fill('Bea');
    await page.getByLabel('Nachname').fill('Layage');
    await page.getByLabel(/^Telefon/).fill('0151 1234567');
    await page.getByRole('button', { name: 'Termin anfragen' }).click();
    await expect(page.getByText('Bitte bestätigen Sie die Ausfallgebühr.')).toBeVisible();
  });

  test('"Ansicht": text size and high contrast are applied and remembered', async ({ page }) => {
    await page.goto(`/${SLUG}/buchen`);
    await page.getByRole('button', { name: 'Ansicht' }).click();
    await page.getByRole('button', { name: /150 %/ }).click();
    await page.getByLabel('Hoher Kontrast').check();
    await page.keyboard.press('Escape');
    await expect(page.locator('html')).toHaveAttribute('data-flavor', 'contrast');
    const size = await page.evaluate(() => getComputedStyle(document.documentElement).fontSize);
    expect(parseFloat(size)).toBeCloseTo(24, 0);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-flavor', 'contrast');
  });
});

test('splash shows the salon at most 2 s, then the page', async ({ page }) => {
  await page.goto(`/${SLUG}`);
  await expect(page.getByTestId('splash')).toBeVisible();
  await expect(page.getByTestId('splash')).toHaveCount(0, { timeout: 3_000 });
  await expect(page.getByRole('heading', { level: 1, name: 'Salon Beispiel' })).toBeVisible();
});

