import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { login, noSplash, SLUG } from './helpers';

/**
 * Services editor (D-048). Runs on one project only: the catalogue is shared by all projects,
 * and parallel saves would (correctly) be rejected by the optimistic lock. The temporary service
 * is for men and adults only, so the other booking tests never see it.
 */
test('owner adds a service in the editor, clients can book it, the owner removes it again', async ({ page, browser }) => {
  test.skip(test.info().project.name !== 'desktop', 'shared catalogue – one project is enough');
  await login(page);
  await page.goto(`/${SLUG}/team/einstellungen`);
  const editor = page.locator('section[aria-labelledby="svc-h"]');
  await editor.getByRole('button', { name: '+ Neue Leistung' }).click();
  const card = editor.locator('details').last();
  await card.locator('summary').click();
  await card.getByLabel('Name', { exact: true }).fill('E2E Bartpflege');
  await card.getByRole('checkbox', { name: 'Damen' }).uncheck();
  await card.getByRole('checkbox', { name: 'Nur ab 18 Jahren' }).check();
  await card.getByLabel('E2E Bartpflege, Behandlung, Dauer: Minuten').fill('20');
  await expect(card.locator('tfoot')).toContainText('20 Min.');

  const axe = await new AxeBuilder({ page }).include('section[aria-labelledby="svc-h"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes[0]?.target.join(' ')}`)).toEqual([]);

  await editor.getByRole('button', { name: 'Speichern' }).click();
  await expect(editor.getByRole('status')).toHaveText('Gespeichert.');

  // the client sees it with the computed duration (fresh context: no staff session)
  const client = await browser.newPage();
  await noSplash(client);
  await client.goto(`/${SLUG}/buchen`);
  await client.getByRole('radio', { name: 'Herren' }).click();
  await client.getByRole('radio', { name: 'Volljährig (ab 18)' }).click();
  await expect(client.getByRole('radio', { name: /E2E Bartpflege\s*20 Min\./ })).toBeVisible();
  await client.close();

  // no appointments → it can be deleted again
  await page.reload();
  const again = editor.locator('details', { hasText: 'E2E Bartpflege' });
  await again.locator('summary').click();
  page.once('dialog', (d) => void d.accept());
  await again.getByRole('button', { name: 'Leistung löschen' }).click();
  await editor.getByRole('button', { name: 'Speichern' }).click();
  await expect(editor.getByRole('status')).toHaveText('Gespeichert.');
  await expect(editor.locator('details', { hasText: 'E2E Bartpflege' })).toHaveCount(0);
});

test('a service with appointments can only be hidden', async ({ page }) => {
  await login(page);
  await page.goto(`/${SLUG}/team/einstellungen`);
  const card = page.locator('section[aria-labelledby="svc-h"] details', { hasText: 'Haarschnitt' }).first();
  await card.locator('summary').click();
  await expect(card.getByText('Hat Termine – kann nur ausgeblendet werden.')).toBeVisible();
  await expect(card.getByRole('button', { name: 'Leistung löschen' })).toHaveCount(0);
});
