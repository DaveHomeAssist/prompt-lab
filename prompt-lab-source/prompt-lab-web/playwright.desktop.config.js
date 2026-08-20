import { defineConfig } from '@playwright/test';

const port = 4176;
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './tests/desktop',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  outputDir: '/tmp/promptlab-desktop-playwright-results',
  reporter: 'line',
  use: {
    baseURL,
    browserName: 'chromium',
    channel: 'chrome',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'off',
  },
  webServer: {
    command: `npm --prefix ../prompt-lab-desktop run build && ../prompt-lab-desktop/node_modules/.bin/vite preview ../prompt-lab-desktop --host 127.0.0.1 --port ${port}`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
