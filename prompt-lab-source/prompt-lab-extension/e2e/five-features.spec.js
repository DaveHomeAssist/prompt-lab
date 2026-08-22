import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect, test } from '@playwright/test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.resolve(__dirname, '..', 'dist');
const viewports = [
  { name: 'mobile-400', width: 400, height: 860 },
  { name: 'tablet-768', width: 768, height: 900 },
];

async function launch(viewport) {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), `prompt-lab-five-${viewport.name}-`));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: true,
    timeout: 15_000,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15_000 });
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await page.addInitScript(() => {
    localStorage.setItem('pl2-telemetry', JSON.stringify({ consent: 'denied' }));
    localStorage.setItem('pl_telemetry_consent', 'denied');
    localStorage.setItem('pl2-billing', JSON.stringify({ plan: 'pro', status: 'active', productName: 'Prompt Lab Pro' }));
    localStorage.setItem('pl2-library', JSON.stringify([{
      id: 'ci-prompt',
      title: 'Release Brief',
      original: 'Write a release brief.',
      enhanced: 'Write a concise release brief with three verified facts.',
      tags: ['qa'],
      collection: 'Prompt CI',
      versions: [],
      testCases: [],
      metadata: { suite: { verdict: 'pass', passed: 3, failed: 0, total: 3, lastRunAt: new Date().toISOString() } },
    }]));
  });
  await page.goto(`chrome-extension://${new URL(worker.url()).host}/panel.html`, { timeout: 15_000 });
  await page.evaluate(() => {
    const original = chrome.runtime.sendMessage.bind(chrome.runtime);
    window.__fiveFeatureRequests = [];
    chrome.runtime.sendMessage = (message, callback) => {
      window.__fiveFeatureRequests.push(message);
      if (message?.type === 'CAPTURE_CONTEXT') {
        callback?.({ ok: true, capture: { selection: 'Captured product context', title: 'Demo page', url: 'https://example.com/demo' } });
        return;
      }
      if (message?.type === 'MODEL_REQUEST') {
        callback?.({ data: { provider: 'mock', model: 'mock-model', content: [{ type: 'text', text: 'Mock arena response' }] } });
        return;
      }
      if (message?.type === 'GET_PROVIDER_SETTINGS') {
        callback?.({ providers: [{ provider: 'mock', model: 'mock-model' }] });
        return;
      }
      return original(message, callback);
    };
  });
  return { page, context, userDataDir };
}

async function openWorkspace(page, viewport, label) {
  if (viewport.width < 720) {
    await page.getByRole('navigation', { name: 'Primary mobile navigation' })
      .getByRole('button', { name: label, exact: true })
      .click();
    return;
  }

  if (label === 'Evaluate') {
    await page.getByRole('tablist', { name: 'Primary workspaces' })
      .getByRole('tab', { name: 'Evaluate', exact: true })
      .click();
    return;
  }

  await page.getByRole('tablist', { name: 'Primary workspaces' })
    .getByRole('tab', { name: 'Create', exact: true })
    .click();
  await page.getByRole('tablist', { name: 'Create views' })
    .getByRole('tab', { name: label, exact: true })
    .click();
}

for (const viewport of viewports) {
  test(`five-feature workflow is operable at ${viewport.width}px`, async () => {
    const { page, context, userDataDir } = await launch(viewport);
    try {
      // Capture Page
      await expect(page.getByRole('button', { name: 'Capture Page' })).toBeVisible();
      await page.getByTestId('prompt-input').fill('Draft');
      await page.getByRole('button', { name: 'Capture Page' }).click();
      await expect(page.getByTestId('prompt-input')).toContainText('Captured product context');

      // Prompt CI suite evidence + Pack Studio
      await page.getByTestId('nav-library').click();
      await expect(page.getByRole('button', { name: 'Inspect Release Brief' })).toContainText('✓ suite');
      await page.getByRole('button', { name: 'Open pack studio' }).click();
      await expect(page.getByText('Pack Studio', { exact: true })).toBeVisible();
      await expect(page.getByText('Publish a pack', { exact: true })).toBeVisible();

      // Model Arena scales beyond A/B without invoking a real provider.
      await openWorkspace(page, viewport, 'Evaluate');
      if (viewport.width < 720) {
        await page.getByRole('button', { name: 'Compare View' }).click();
      } else {
        await page.getByRole('tablist', { name: 'Evaluate views' }).getByRole('tab', { name: 'Compare' }).click();
      }
      await expect(page.getByText(/Model Arena · 2 variants/)).toBeVisible();
      await page.getByRole('button', { name: '+ Variant' }).click();
      await expect(page.getByText(/Model Arena · 3 variants/)).toBeVisible();

      // Chain Lab can be built and opened from the existing composer workflow.
      await openWorkspace(page, viewport, 'Compose');
      if (viewport.width < 720) {
        await page.getByRole('tablist', { name: 'Composer views' }).getByRole('tab', { name: /Library \(1\)/ }).click();
      }
      await page.getByRole('button', { name: /Add (Starter|Block|Popular)/ }).first().click();
      if (viewport.width < 720) {
        await page.getByRole('tablist', { name: 'Composer views' }).getByRole('tab', { name: /Canvas \(1\)/ }).click();
      }
      await page.getByRole('button', { name: 'Save as Chain' }).click();
      await expect(page.getByRole('paragraph').filter({ hasText: 'Chain Lab' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Run Chain' })).toBeVisible();
    } finally {
      await context.close();
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }
  });
}
