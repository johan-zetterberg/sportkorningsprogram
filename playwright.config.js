import { defineConfig } from '@playwright/test';

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
  }
});
