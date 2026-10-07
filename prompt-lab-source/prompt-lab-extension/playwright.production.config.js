import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  // The authenticated shell uses disposable QA sessions. Follow-up coverage
  // intercepts provider responses and never performs real inference.
  testMatch: ['production-free-account.spec.js', 'production-core-loop.spec.js', 'production-follow-up.spec.js'],
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: 'line',
  outputDir: 'test-results/production-smoke',
  use: {
    browserName: 'chromium',
    headless: true,
    screenshot: 'off',
    trace: 'off',
    video: 'off',
  },
});
