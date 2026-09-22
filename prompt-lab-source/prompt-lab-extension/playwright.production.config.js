import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  // Both production specs run in one pass: the billing surface and the core
  // write/save/reload loop. See docs/VIEWPORT_SHELL_OVERHAUL_PLAN.md Phase 0.
  testMatch: ['production-free-account.spec.js', 'production-core-loop.spec.js'],
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
