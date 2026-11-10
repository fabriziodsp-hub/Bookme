// Lighthouse (mobile preset) against the production build. Fails below 90 in performance or accessibility.
// Usage: start the e2e server (node start.mjs) and run `pnpm --filter @salon/e2e lighthouse`.
import { chromium } from '@playwright/test';
import * as chromeLauncher from 'chrome-launcher';
import lighthouse from 'lighthouse';
import { writeFileSync } from 'node:fs';

const base = process.env.LH_URL ?? `http://localhost:${process.env.E2E_PORT ?? 4310}`;
const pages = ['/salon-beispiel', '/salon-beispiel/buchen', '/salon-beispiel/impressum'];
const chrome = await chromeLauncher.launch({ chromePath: chromium.executablePath(), chromeFlags: ['--headless=new', '--no-sandbox'] });
let failed = false;
const rows = [];
try {
  for (const p of pages) {
    const r = await lighthouse(`${base}${p}`, { port: chrome.port, output: 'html', onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'] });
    const s = Object.fromEntries(Object.entries(r.lhr.categories).map(([k, v]) => [k, Math.round((v.score ?? 0) * 100)]));
    rows.push({ page: p, ...s });
    writeFileSync(`lighthouse-${p.replace(/\W+/g, '_')}.html`, r.report);
    if (s.performance < 90 || s.accessibility < 90) failed = true;
  }
} finally {
  await chrome.kill();
}
console.table(rows);
process.exit(failed ? 1 : 0);
