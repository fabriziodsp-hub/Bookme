import { expect, type APIRequestContext, type Page } from '@playwright/test';

export const SLUG = 'salon-beispiel';
export const OWNER = { email: 'maria@salon-beispiel.example.com', password: 'demo-passwort-2026' };

/** Skip the logo splash (it is tested separately). */
export async function noSplash(page: Page) {
  await page.addInitScript(() => sessionStorage.setItem('salon.splashSeen', '1'));
}

export async function login(page: Page, who = OWNER) {
  await noSplash(page);
  await page.goto(`/${SLUG}/team`);
  await page.getByLabel('E-Mail').fill(who.email);
  await page.getByLabel('Passwort').fill(who.password);
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await expect(page.getByRole('link', { name: 'Kalender' })).toBeVisible();
}

export const H = { 'x-requested-with': 'salon' };

/** Calendar data through the API with the page's session cookie. */
export async function calendar(req: APIRequestContext, date: string) {
  const r = await req.get(`/api/staff/calendar?from=${date}&days=1`, { headers: H });
  expect(r.ok()).toBeTruthy();
  return (await r.json()) as { appointments: { id: string; start: number; end: number; date: string; stylistId: string; status: string; customer: { lastName: string }; blocks: { start: number; end: number; kind: string }[] }[]; stylists: { id: string; displayName: string }[] };
}

export async function chooseService(page: Page, service: RegExp, adult = true) {
  await page.getByRole('radio', { name: 'Damen' }).click();
  await page.getByRole('radio', { name: adult ? 'Volljährig (ab 18)' : 'Minderjährig (unter 18)' }).click();
  await page.getByRole('radio', { name: service }).click();
}
