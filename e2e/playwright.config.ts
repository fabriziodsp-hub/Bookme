import { defineConfig, devices } from '@playwright/test';

const PORT = process.env.E2E_PORT ?? '4310';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1, // tests share one seeded database
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  timeout: 45_000,
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: 'disabled' } },
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
  },
  projects: [
    // Real WebKit (Safari engine) when installed (CI); otherwise iPhone viewport on Chromium.
    { name: 'iphone', use: { ...devices['iPhone 13'], browserName: process.env.E2E_WEBKIT ? 'webkit' : 'chromium' } },
    { name: 'android', use: { ...devices['Pixel 7'] } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 900 } } },
  ],
  webServer: {
    command: 'node start.mjs',
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
