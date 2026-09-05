import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect, test } from '@playwright/test';

const extensionPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
for (const width of [400, 1180]) {
  test(`follow-up source, independent saving and reload at ${width}px`, async () => {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'promptlab-followup-'));
    const context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium', headless: true,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });
    try {
      const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
      await worker.evaluate(async () => {
        await chrome.storage.session.set({ 'pl2-session': { raw: 'Original instructions', enhanced: 'Enhanced instructions', editingId: 'parent', saveTitle: 'Parent prompt', tab: 'editor' } });
      });
      const page = await context.newPage();
      await page.setViewportSize({ width, height: 1000 });
      await page.addInitScript(() => {
        localStorage.setItem('pl_telemetry_consent', 'denied');
        if (!localStorage.getItem('followup-fixture-seeded')) {
          localStorage.setItem('pl2-library', JSON.stringify([{ id: 'parent', title: 'Parent prompt', original: 'Original instructions', enhanced: 'Enhanced instructions', currentVersionId: 'parent-v1' }]));
          localStorage.setItem('pl2-eval-run-fallback', JSON.stringify([{ id: 'source-run', promptId: 'parent', promptVersionId: 'parent-v1', promptTitle: 'Parent prompt', mode: 'ab', status: 'success', input: 'Original instructions', output: 'Actual answer from the saved run', model: 'source-model', provider: 'fixture', createdAt: '2026-09-05T00:00:00.000Z' }]));
          localStorage.setItem('followup-fixture-seeded', 'true');
        }
        indexedDB.open = () => { throw new Error('Fixture fallback'); };
        const original = chrome.runtime.sendMessage.bind(chrome.runtime);
        window.__followupRequests = [];
        chrome.runtime.sendMessage = (message, callback) => {
          if (message?.type === 'MODEL_REQUEST') {
            window.__followupRequests.push(message);
            callback({ data: { provider: 'fixture', model: 'suggestion-model', content: [{ text: JSON.stringify({ suggestions: [{ title: 'Next analysis', prompt: 'Analyze the next step from the saved answer.' }] }) }] } });
            return;
          }
          if (message?.type === 'MODEL_ABORT') { callback?.({ ok: true }); return; }
          return original(message, callback);
        };
      });
      await page.goto(`chrome-extension://${new URL(worker.url()).host}/panel.html`);
      const panel = page.getByTestId('follow-up-panel');
      await expect(panel).toBeVisible();
      await panel.getByRole('combobox', { name: 'Follow-up source' }).selectOption('source-run');
      await panel.getByTestId('suggest-follow-ups').click();
      await expect(panel.getByText('Next analysis', { exact: true })).toBeVisible();
      expect(await page.evaluate(() => window.__followupRequests[0].payload.messages[0].content)).toBe('Actual answer from the saved run');
      await panel.getByRole('button', { name: 'View source output', exact: true }).click();
      await expect(panel.getByText('Actual answer from the saved run', { exact: true })).toBeVisible();
      await page.waitForFunction(() => JSON.parse(localStorage.getItem('pl2-library')).find(row => row.id === 'parent')?.completeness);
      const parentBefore = await page.evaluate(() => JSON.parse(localStorage.getItem('pl2-library')).find(row => row.id === 'parent'));
      await page.evaluate(() => {
        const original = Storage.prototype.setItem;
        window.__failFollowupSave = true;
        Storage.prototype.setItem = function (key, value) {
          if (window.__failFollowupSave && key === 'pl2-library') throw new DOMException('Fixture quota', 'QuotaExceededError');
          return original.call(this, key, value);
        };
      });
      await panel.getByRole('button', { name: 'Save to Library', exact: true }).click();
      await expect(panel.getByRole('button', { name: 'Save to Library', exact: true })).toBeEnabled();
      expect(await page.evaluate(() => JSON.parse(localStorage.getItem('pl2-library')).length)).toBe(1);
      await page.evaluate(() => { window.__failFollowupSave = false; });
      await panel.getByRole('button', { name: 'Save to Library', exact: true }).click();
      await expect(panel.getByRole('button', { name: 'Saved to Library', exact: true })).toBeDisabled();
      const library = await page.evaluate(() => JSON.parse(localStorage.getItem('pl2-library')));
      expect(library).toHaveLength(2);
      expect(library.find(row => row.id === 'parent')).toEqual(parentBefore);
      expect(library.find(row => row.id !== 'parent').metadata.followUpOrigin).toMatchObject({ sourcePromptId: 'parent', sourceRunId: 'source-run', generationModel: 'suggestion-model' });
      await panel.getByRole('button', { name: 'Use in editor', exact: true }).click();
      await expect(page.getByTestId('prompt-input')).toHaveValue('Analyze the next step from the saved answer.');
      await expect(page.getByRole('region', { name: 'Follow-up provenance' }).first()).toBeVisible();
      await expect.poll(async () => worker.evaluate(async () => (await chrome.storage.session.get('pl2-session'))['pl2-session']?.followUpOrigin?.sourceRunId)).toBe('source-run');
      await page.reload();
      await expect(page.getByTestId('prompt-input')).toHaveValue('Analyze the next step from the saved answer.');
      await expect(page.getByRole('region', { name: 'Follow-up provenance' }).first()).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    } finally {
      await context.close();
      fs.rmSync(profile, { recursive: true, force: true });
    }
  });
}
