import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5500';

export default defineConfig({
  testDir: './tests',
  testMatch: 'browser-smoke.spec.js',
  timeout: 120000,
  expect: {
    timeout: 10000
  },
  use: {
    baseURL,
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  },
  // A desktop and a phone. The phone runs the tests tagged @mobile (pages,
  // dialogs, layout); every other test runs on the desktop only
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] }, grepInvert: /@mobile-only/ },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, grep: /@mobile/ }
  ],
  // Startar den lokala webbservern om ingen redan kör på porten.
  webServer: process.env.PLAYWRIGHT_BASE_URL ? undefined : {
    command: 'node scripts/static-server.mjs 5500',
    url: baseURL,
    reuseExistingServer: true
  }
});
