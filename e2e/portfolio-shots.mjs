// Portfolio screenshots (not part of the test suite). Needs `node start.mjs` running on :4310 (fresh seed).
import { chromium, devices } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const B = 'http://localhost:4310';
const S = 'salon-beispiel';
const OUT = process.argv[2] ?? '/tmp/claude-0/portfolio';
mkdirSync(OUT, { recursive: true });
const shots = [];
const log = (m) => console.log(m);
async function shot(page, name, caption, opts = {}) {
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))));
  await page.waitForTimeout(250);
  const path = `${OUT}/${name}.png`;
  if (opts.locator) await opts.locator.screenshot({ path });
  else await page.screenshot({ path, fullPage: !!opts.full });
  shots.push({ name, caption, device: opts.device });
  log(`✓ ${name}`);
}
async function step(name, fn) {
  try { await fn(); } catch (e) { log(`✗ ${name}: ${e.message.split('\n')[0]}`); }
}

const br = await chromium.launch({ args: ['--lang=de-DE'] });
const phone = { ...devices['Pixel 7'], deviceScaleFactor: 2, locale: 'de-DE', timezoneId: 'Europe/Berlin' };
const desk = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5, locale: 'de-DE', timezoneId: 'Europe/Berlin' };
const noSplash = (p) => p.addInitScript(() => sessionStorage.setItem('salon.splashSeen', '1'));

// ---------- client (phone) ----------
const c = await br.newContext(phone);
const cp = await c.newPage();
await noSplash(cp);
let manageUrl = null;

await step('client-start', async () => {
  await cp.goto(`${B}/${S}/buchen`);
  await cp.getByRole('radio', { name: 'Damen' }).click();
  await cp.getByRole('radio', { name: 'Volljährig (ab 18)' }).click();
  await shot(cp, '01-kunde-leistungen', 'Kundin wählt ohne Konto: für wen, volljährig, dann die Leistung – mit Dauer und Preis.', { device: 'phone' });
});
await step('client-calendar', async () => {
  await cp.getByRole('radio', { name: /^Schnitt & Farbe – Ansatz 45/ }).click();
  await cp.getByRole('button', { name: 'Nächste Woche' }).click();
  await cp.locator('.cal-slot').first().waitFor();
  await cp.locator('.duration, .dbar, [aria-label*="Dauer"]').first().scrollIntoViewIfNeeded().catch(() => undefined);
  await cp.getByRole('heading', { name: /Dauer/ }).first().scrollIntoViewIfNeeded();
  await shot(cp, '02-kunde-wochenkalender', 'Dauerbalken (belegt / Einwirkzeit) und Wochenkalender: nur passende freie Startzeiten, Pause und Ruhetag sichtbar.', { device: 'phone' });
});
await step('client-month', async () => {
  await cp.getByRole('button', { name: /Datum im Monatskalender wählen/ }).click();
  await cp.getByRole('dialog').waitFor();
  await shot(cp, '03-kunde-monat', 'Monatsübersicht: Punkte an Tagen mit freien Terminen, „Nächster freier Termin“.', { device: 'phone' });
  await cp.keyboard.press('Escape');
});
await step('client-list', async () => {
  await cp.getByRole('button', { name: 'Liste' }).click();
  await cp.getByRole('button', { name: /Uhr frei$/ }).first().scrollIntoViewIfNeeded();
  await shot(cp, '04-kunde-liste', 'Listenansicht als barrierefreie Alternative zum Raster (Screenreader, große Schrift).', { device: 'phone' });
});
await step('client-details', async () => {
  await cp.getByRole('button', { name: /Uhr frei$/ }).first().click();
  await cp.getByLabel('Vorname').fill('Erika');
  await cp.getByLabel('Nachname').fill('Beispiel');
  await cp.getByLabel(/^E-Mail/).fill('erika.beispiel@example.com');
  await cp.getByRole('checkbox', { name: /Datenschutzhinweise gelesen/ }).check();
  await cp.getByRole('button', { name: 'Termin anfragen' }).scrollIntoViewIfNeeded();
  await shot(cp, '05-kunde-daten', 'Nur nötige Daten, Datenschutzhinweis, optionaler Geburtstagsrabatt (nur Monat, Einwilligung).', { device: 'phone' });
});
await step('client-result', async () => {
  await cp.getByRole('button', { name: 'Termin anfragen' }).click();
  await cp.getByRole('heading', { name: /Anfrage gesendet/ }).waitFor({ timeout: 20000 });
  manageUrl = await cp.getByRole('link', { name: /Termin ansehen, verschieben oder absagen/ }).getAttribute('href');
  await cp.evaluate(() => window.scrollTo(0, 0));
  await shot(cp, '06-kunde-anfrage', 'Anfrage gesendet: der Termin ist reserviert, der Salon bestätigt. Verwaltung per Link, ohne Konto.', { device: 'phone' });
});
await step('client-balayage', async () => {
  const p = await c.newPage();
  await p.goto(`${B}/${S}/buchen`);
  await p.getByRole('radio', { name: 'Damen' }).click();
  await p.getByRole('radio', { name: 'Volljährig (ab 18)' }).click();
  await p.getByRole('radio', { name: /^Balayage/ }).click();
  await p.getByRole('button', { name: /Datum im Monatskalender wählen/ }).click();
  await p.getByRole('dialog').getByRole('button', { name: 'Nächster freier Termin' }).click();
  await p.locator('.cal-slot').first().click();
  await p.getByText(/Ausfallgebühr:/).scrollIntoViewIfNeeded();
  await shot(p, '07-kunde-balayage', 'Balayage: nur 08:00/13:00 buchbar, Ausfallgebühr aus dem typischen Schaden berechnet, Zustimmung Pflicht.', { device: 'phone' });
  await p.close();
});

// ---------- staff (desktop) ----------
const d = await br.newContext(desk);
const dp = await d.newPage();
await noSplash(dp);
await dp.clock.install({ time: new Date('2026-11-02T06:00:00Z') });
await dp.goto(`${B}/${S}/team`);
await dp.getByLabel('E-Mail').fill('maria@salon-beispiel.example.com');
await dp.getByLabel('Passwort').fill('demo-passwort-2026');
await dp.getByRole('button', { name: 'Anmelden' }).click();
await dp.locator('.blk').first().waitFor();
await dp.clock.fastForward('03:22:00');

await step('staff-team', async () => {
  await dp.getByRole('button', { name: 'Heute', exact: true }).click();
  await dp.waitForTimeout(600);
  await shot(dp, '08-team-tagesansicht', 'Team-Ansicht: eine Spalte pro Friseurin, Phasen (Einwirkzeit gelb = Friseurin frei), Linie der aktuellen Uhrzeit.', { device: 'desktop' });
});
await step('staff-drag', async () => {
  const blk = dp.locator('.blk.first').filter({ hasText: 'Clara Wagner' }).first();
  const g = blk.locator('.grip');
  const b = await g.boundingBox();
  await dp.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await dp.mouse.down();
  await dp.mouse.move(b.x + b.width / 2, b.y + b.height / 2 + 30, { steps: 4 });
  await dp.mouse.move(b.x + b.width / 2, b.y + b.height / 2 + 70 * 1.8, { steps: 8 });
  await dp.waitForTimeout(300);
  await shot(dp, '09-drag-and-drop', 'Drag & drop im 5-Minuten-Raster mit Live-Prüfung: Ziel in der Mittagspause → rot mit Begründung, wird nicht gespeichert.', { device: 'desktop' });
  await dp.mouse.up();
});
await step('staff-panel', async () => {
  await dp.clock.fastForward('00:00:07'); // let the drag toast fade out
  await dp.locator('.blk.first').filter({ hasText: 'Clara Krüger' }).first().click();
  await dp.locator('.panel').waitFor();
  await shot(dp, '10-termin-panel', 'Termin-Panel: jede Phase per Tastatur/Buttons änderbar (Alternative zu Drag & drop), Rückgängig, Status, Kundenkarte.', { device: 'desktop' });
});
await step('staff-requests', async () => {
  await dp.goto(`${B}/${S}/team/anfragen`);
  const item = dp.locator('article').filter({ hasText: 'Erika Beispiel' });
  await item.locator('textarea').fill('Bitte 10 Minuten früher da sein, wir besprechen die Farbe vorab.');
  await item.scrollIntoViewIfNeeded();
  await shot(dp, '12-anfragen', 'Anfragen-Eingang: bestätigen, ablehnen oder Rücksprache – mit Notiz, die die Kundin per E-Mail und auf ihrer Terminseite sieht.', { device: 'desktop' });
  await item.getByRole('button', { name: 'Annehmen' }).click();
  await dp.waitForTimeout(800);
});
await step('staff-settings', async () => {
  await dp.goto(`${B}/${S}/team/einstellungen`);
  await dp.getByRole('heading', { name: /Preis/ }).first().waitFor();
  await shot(dp, '13-einstellungen', 'Inhaberin: eigene Preisliste, Öffnungszeiten mit Konfliktvorschau, Farbthema (kontrastgeprüft), Team-Konten.', { device: 'desktop' });
});

// ---------- client sees the decision ----------
await step('client-manage', async () => {
  if (!manageUrl) throw new Error('no manage link');
  await cp.goto(manageUrl.startsWith('http') ? manageUrl : `${B}${manageUrl}`);
  await cp.getByText('Notiz vom Salon').waitFor();
  await shot(cp, '14-kunde-terminseite', 'Terminseite der Kundin: bestätigt, Notiz vom Salon, verschieben/absagen und „Zum Kalender hinzufügen“ (Apple, Google, Outlook).', { device: 'phone', full: true });
});

// ---------- staff (phone) ----------
const m = await br.newContext(phone);
const mp = await m.newPage();
await noSplash(mp);
await mp.clock.install({ time: new Date('2026-11-02T06:00:00Z') });
await step('staff-phone', async () => {
  await mp.goto(`${B}/${S}/team`);
  await mp.getByLabel('E-Mail').fill('sophie@salon-beispiel.example.com');
  await mp.getByLabel('Passwort').fill('demo-passwort-2026');
  await mp.getByRole('button', { name: 'Anmelden' }).click();
  await mp.locator('.blk').first().waitFor();
  await mp.clock.fastForward('03:22:00');
  await mp.getByRole('button', { name: 'Heute', exact: true }).click();
  await mp.waitForTimeout(600);
  await shot(mp, '15-team-handy', 'Handy: „Mein Tag“ der angemeldeten Friseurin, Navigation unten, „Neuer Termin“ als schwebender Button.', { device: 'phone' });
});

await step('card-phone', async () => {
  await mp.locator('.blk.first').first().click();
  await mp.getByRole('link', { name: /Kundenkarte öffnen/ }).click();
  await mp.locator('#ce-color').fill('Majirel 7.1 30 g + 8.0 10 g, 6 % 1:1,5 – 35 Min.');
  await mp.getByRole('region', { name: 'Farbrezepturen' }).getByRole('button', { name: 'Hinzufügen' }).click();
  await mp.getByText('Majirel 7.1').waitFor();
  await mp.locator('#ce-note').fill('Mag den Nacken kurz, Seiten länger lassen.');
  await mp.getByRole('region', { name: 'Notizen' }).getByRole('button', { name: 'Hinzufügen' }).click();
  await mp.getByText('Nacken kurz').waitFor();
  await mp.evaluate(() => window.scrollTo(0, 0));
  await shot(mp, '11a-kundenkarte', 'Kundenkarte (nur Team): Kontakt, kommende und vergangene Termine – vergangene sind gesperrt und bleiben in der Historie.', { device: 'phone' });
  await mp.getByRole('heading', { name: 'Farbrezepturen' }).evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await mp.evaluate(() => window.scrollBy(0, -12));
  await shot(mp, '11b-kundenkarte-rezeptur', 'Farbrezepturen und Team-Notizen mit Autor und Datum; Allergien erst nach ausdrücklicher Einwilligung (Art. 9 DSGVO) freigeschaltet.', { device: 'phone' });
});

// ---------- accessibility / theming ----------
await step('view-menu', async () => {
  const p = await c.newPage();
  await p.goto(`${B}/${S}/buchen`);
  await p.getByRole('button', { name: 'Ansicht' }).click();
  await p.getByRole('button', { name: /125 %/ }).click();
  await p.getByRole('button', { name: 'Hell' }).click();
  await shot(p, '16-ansicht', 'Menü „Ansicht“ für alle Besucher: Textgröße, hell/dunkel, hoher Kontrast, Bewegung reduzieren (WCAG 2.2 AA).', { device: 'phone' });
  await p.keyboard.press('Escape');
  await p.getByRole('radio', { name: 'Herren' }).click();
  await p.getByRole('radio', { name: 'Volljährig (ab 18)' }).click();
  await p.getByRole('radio', { name: /^Haarschnitt/ }).click();
  await p.getByRole('button', { name: 'Nächste Woche' }).click();
  await p.locator('.cal-slot').first().scrollIntoViewIfNeeded();
  await shot(p, '17-hell-125', 'Gleiche Seite hell mit 125 % Text – Herren-Haarschnitt 30′; jedes Salon-Thema wird automatisch auf Kontrast geprüft.', { device: 'phone' });
  await p.close();
});

// ---------- platform admin ----------
await step('admin', async () => {
  const a = await br.newContext(desk);
  const ap = await a.newPage();
  await noSplash(ap);
  await ap.goto(`${B}/admin`);
  await ap.getByLabel('E-Mail').fill('admin@plattform.example.com');
  await ap.getByLabel('Passwort').fill('demo-passwort-2026');
  await ap.getByRole('button', { name: 'Anmelden' }).click();
  await ap.waitForTimeout(1200);
  await shot(ap, '18-plattform-admin', 'Plattform-Betrieb: mehrere Salons (Mandanten), Logo-Upload nur durch Betreiber (SVG wird bereinigt), Aktivierung.', { device: 'desktop' });
});

await br.close();
const fs = await import('node:fs');
fs.writeFileSync(`${OUT}/shots.json`, JSON.stringify(shots, null, 2));
log(`${shots.length} screenshots in ${OUT}`);
