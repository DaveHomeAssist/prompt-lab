import { defineConfig } from '@playwright/test';

const port = 4174;
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './tests/landing',
  testMatch: '**/*.spec.js',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 2,
  outputDir: process.env.CI ? 'test-results' : '/tmp/promptlab-landing-playwright-results',
  timeout: 15_000,
  expect: {
    timeout: 5_000,
  },
  reporter: process.env.CI ? [['line'], ['html', { open: 'never' }]] : 'line',
  use: {
    baseURL,
    browserName: 'chromium',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'off',
  },
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${port}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
