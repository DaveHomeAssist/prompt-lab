import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect, test } from '@playwright/test';

// "Batch test-case runs" had no reachable way to create a case: the only form
// lived in a Library sidebar that is never mounted. This drives the real flow
// from the Library workspace: add, edit, persist, run from Create, delete.

const extensionPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const surfaces = [{ name: 'extension', url: null }];
if (process.env.PL_COMPAT_WEB_URL) surfaces.push({ name: 'local-web', url: process.env.PL_COMPAT_WEB_URL });
if (process.env.PL_COMPAT_DESKTOP_URL) surfaces.push({ name: 'desktop-frontend', url: process.env.PL_COMPAT_DESKTOP_URL });

async function openView(page, name, width) {
  if (width < 720) await page.getByRole('navigation', { name: 'Primary mobile navigation' }).getByRole('button', { name, exact: true }).click();
  else await page.getByRole('tablist', { name: 'Create views' }).getByRole('tab', { name, exact: true }).click();
}

async function openTestsTab(page, width) {
  await openView(page, 'Library', width);
  await page.getByRole('button', { name: 'Inspect Alpha prompt' }).click();
  await page.getByRole('tab', { name: 'Tests' }).click();
  return page.getByRole('region', { name: 'Test cases' });
}

// Read the persisted rows rather than trusting what the page renders.
const readStoredCases = (page) => page.evaluate(() => new Promise((resolve, reject) => {
  const open = indexedDB.open('prompt_lab_local');
  open.onerror = () => reject(open.error);
  open.onsuccess = () => {
    const db = open.result;
    if (!db.objectStoreNames.contains('test_cases')) { db.close(); resolve([]); return; }
    const request = db.transaction('test_cases', 'readonly').objectStore('test_cases').getAll();
    request.onsuccess = () => {
      db.close();
      resolve(request.result.map(({ promptId, title, input, expectedTraits, expectedExclusions }) => (
        { promptId, title, input, expectedTraits, expectedExclusions })));
    };
    request.onerror = () => reject(request.error);
  };
}));

for (const surface of surfaces) for (const width of [400, 1180]) {
  test(`${surface.name} Library Tests tab manages test cases at ${width}px`, async () => {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'promptlab-test-cases-'));
    const context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium', headless: true,
      args: surface.url ? [] : [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });
    try {
      let url = surface.url;
      if (!url) {
        const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
        url = `chrome-extension://${new URL(worker.url()).host}/panel.html`;
      }
      const page = await context.newPage();
      page.setDefaultTimeout(8000);
      await page.setViewportSize({ width, height: 1000 });
      await page.route('**/api/proxy', route => route.abort());
      await page.addInitScript(() => {
        localStorage.setItem('pl_telemetry_consent', 'denied');
        if (!localStorage.getItem('test-cases-seeded')) {
          localStorage.setItem('pl2-library', JSON.stringify([{
            id: 'alpha', title: 'Alpha prompt', collection: '', original: 'Summarize the incident report.',
            enhanced: 'Summarize the incident report in five bullet points.', tags: ['verification'],
            currentVersionId: 'alpha-v1', createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z', metadata: {},
          }]));
          localStorage.setItem('test-cases-seeded', 'true');
        }
      });
      await page.goto(url);

      // The control that was missing: reachable from the Library for a saved prompt.
      let cases = await openTestsTab(page, width);
      await expect(cases).toContainText('Test Cases (0)');
      await expect(page.getByText('Open the prompt in Evaluate to add cases')).toHaveCount(0);
      await cases.getByRole('button', { name: 'Add Case' }).click();

      // Create
      await page.getByLabel('Test case title').fill('Executive brevity');
      await page.getByLabel('Test case prompt input').fill('Summarize the Q3 outage report for the board.');
      await page.getByLabel('Expected traits').fill('bullet points, executive');
      await page.getByRole('button', { name: 'Save Case' }).click();
      await expect(cases).toContainText('Test Cases (1)');
      await expect(cases).toContainText('Executive brevity');
      await expect(cases).toContainText('Expect: bullet points, executive');
      await expect.poll(() => readStoredCases(page)).toEqual([{
        promptId: 'alpha', title: 'Executive brevity', input: 'Summarize the Q3 outage report for the board.',
        expectedTraits: ['bullet points', 'executive'], expectedExclusions: [],
      }]);

      // Edit updates the same record in place
      await cases.getByRole('button', { name: 'Edit' }).click();
      await expect(page.getByLabel('Test case title')).toHaveValue('Executive brevity');
      await page.getByLabel('Expected exclusions').fill('jargon');
      await page.getByRole('button', { name: 'Update Case' }).click();
      await expect(cases).toContainText('Avoid: jargon');
      await expect.poll(() => readStoredCases(page)).toEqual([expect.objectContaining({ title: 'Executive brevity', expectedExclusions: ['jargon'] })]);

      // Survives a reload
      await page.reload();
      cases = await openTestsTab(page, width);
      await expect(cases).toContainText('Test Cases (1)');
      await expect(cases).toContainText('Avoid: jargon');

      // Run Cases in Create stays disabled with no cases; with this one it runs. No
      // provider is configured here, so the batch records the case as failed; what
      // matters is that it accepted and attempted the saved case.
      await page.getByRole('button', { name: 'Open in Editor' }).click();
      const runCases = page.getByRole('button', { name: 'Run Cases', exact: true });
      await expect(runCases).toBeEnabled();
      await runCases.click();
      await expect(page.getByText(/Ran \d+\/1 test cases/)).toBeVisible({ timeout: 20_000 });

      // Delete
      cases = await openTestsTab(page, width);
      page.once('dialog', dialog => dialog.accept());
      await cases.getByRole('button', { name: 'Delete' }).click();
      await expect(cases).toContainText('Test Cases (0)');
      await expect.poll(() => readStoredCases(page)).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    } finally {
      await context.close();
      fs.rmSync(profile, { recursive: true, force: true });
    }
  });
}
