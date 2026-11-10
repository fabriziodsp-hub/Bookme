import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { H, login, noSplash, SLUG } from './helpers';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

test('homepage: salon info from the data, live opening status, booking one tap away (D-052)', async ({ page }) => {
  await noSplash(page);
  await page.goto(`/${SLUG}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Salon Beispiel' })).toBeVisible();
  // frozen clock: Monday 07:00 → opens at 08:00
  await expect(page.getByText('Heute ab 08:00 Uhr geöffnet')).toBeVisible();
  const services = page.locator('section[aria-labelledby="h-svc"]');
  await expect(services.getByRole('heading', { name: 'Haarschnitt' })).toBeVisible();
  await expect(services).toContainText('30–45 Min.');
  await expect(page.locator('.h-hours [aria-current="date"]')).toContainText('Montag');
  await expect(page.getByRole('link', { name: /Route planen/ })).toHaveAttribute('href', /google\.com\/maps\/search/);
  await expect(page.getByRole('heading', { name: 'Über uns' })).toHaveCount(0); // no text yet → hidden
  await page.getByRole('link', { name: 'Termin buchen' }).first().click();
  await expect(page).toHaveURL(new RegExp(`/${SLUG}/buchen$`));
  await expect(page.getByRole('heading', { name: 'Für wen?' })).toBeVisible();
});

test('homepage passes axe in every theme, also with reduced motion', async ({ page }) => {
  await noSplash(page);
  for (const [scheme, contrast] of [['light', false], ['dark', false], ['dark', true]] as const) {
    await page.addInitScript(([s, c]) => localStorage.setItem('salon.viewPrefs.v1', JSON.stringify({ scheme: s, contrast: c, textScale: 100, reducedMotion: true })), [scheme, contrast] as const);
    await page.goto(`/${SLUG}`);
    await expect(page.locator('section[aria-labelledby="h-svc"]')).toBeVisible();
    // with reduced motion the sections are shown without waiting for the scroll animation
    await expect(page.locator('section[aria-labelledby="h-svc"]')).toHaveCSS('opacity', '1');
    const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    expect(r.violations.map((v) => `${v.id}: ${v.nodes[0]?.target.join(' ')}`), `${scheme}${contrast ? '+contrast' : ''}`).toEqual([]);
  }
});

test('owner texts and the opt-in team appear on the homepage (public name only)', async ({ page, browser }) => {
  test.skip(test.info().project.name !== 'desktop', 'changes shared salon data – one project is enough');
  await login(page);
  await page.request.put('/api/staff/admin/homepage', { headers: H, data: { tagline: 'Schnitt mit Liebe', about: 'Seit 2010 in Musterstadt.' } });
  const staff = (await (await page.request.get('/api/staff/admin/staff', { headers: H })).json()).staff as { id: string; displayName: string }[];
  const sophie = staff.find((s) => s.displayName.startsWith('Sophie'))!;
  await page.request.put(`/api/staff/admin/staff/${sophie.id}/public`, { headers: H, data: { show: true, publicName: 'Sophie' } });

  const client = await browser.newPage();
  await noSplash(client);
  await client.goto(`/${SLUG}`);
  await expect(client.getByText('Schnitt mit Liebe')).toBeVisible();
  await expect(client.getByRole('heading', { name: 'Über uns' })).toBeVisible();
  const team = client.locator('section[aria-labelledby="h-team"]');
  await expect(team).toContainText('Sophie');
  await expect(team).not.toContainText('Lang'); // never the full name
  await client.close();

  // clean up for the other tests
  await page.request.put(`/api/staff/admin/staff/${sophie.id}/public`, { headers: H, data: { show: false, publicName: 'Sophie' } });
  await page.request.put('/api/staff/admin/homepage', { headers: H, data: { tagline: '', about: '' } });
});
