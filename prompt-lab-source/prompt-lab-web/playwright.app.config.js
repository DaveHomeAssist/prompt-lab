import { defineConfig } from '@playwright/test';

const port = 4175;
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './tests/app',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  outputDir: '/tmp/promptlab-app-playwright-results',
  reporter: 'line',
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
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
