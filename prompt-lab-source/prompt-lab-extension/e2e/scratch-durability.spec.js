import { chromium, expect, test } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// Fast shared-UI coverage. Installed Windows acceptance owns WebView2 and installer proof.
test('Scratch strict save failure, retry and three browser restarts', async ({}, testInfo) => {
  test.setTimeout(60_000);
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'scratch-durable-probe-'));
  const extension = path.resolve('dist');
  let context;
  let page;
  const open = async () => {
    context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium', headless: true,
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    });
    await context.addInitScript(() => { window.__TAURI_INTERNALS__ = {}; });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    page = await context.newPage();
    await page.route('**/api/**', route => route.abort());
    await page.goto(`chrome-extension://${new URL(worker.url()).host}/panel.html`);
    await page.getByTestId('nav-scratch').click();
    await page.getByRole('textbox', { name: 'Scratchpad', exact: true }).waitFor();
  };
  try {
    await open();
    await expect.poll(() => page.getByTestId('scratch-save-status').getAttribute('data-save-state')).toMatch(/idle|saved/);
    await page.evaluate(() => {
      window.probe = { fail: true, completed: 0, aborted: 0, premature: [], watch: false, events: [] };
      const transact = IDBDatabase.prototype.transaction;
      IDBDatabase.prototype.transaction = function(...args) {
        const tx = transact.apply(this, args);
        // Observe before the app handler resolves its save promise. A later
        // listener can run after the promise microtasks have rendered Saved.
        tx.addEventListener('complete', () => {
          if (tx.__scratchProbe) {
            window.probe.completed++;
            window.probe.events.push({ type: 'complete', at: performance.now() });
          }
        });
        return tx;
      };
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function(value, ...args) {
        if (this.transaction.db.name === 'prompt_lab_durable' && value.id === 'scratch') {
          this.transaction.__scratchProbe = true;
          window.probe.events.push({ type: 'put', at: performance.now() });
          if (window.probe.fail) {
            window.probe.aborted++;
            queueMicrotask(() => this.transaction.abort());
          }
        }
        return put.call(this, value, ...args);
      };
      new MutationObserver(() => {
        const status = document.querySelector('[data-testid=scratch-save-status]');
        if (window.probe.watch && !window.probe.completed
          && (status?.dataset.saveState === 'saved' || status?.textContent.trim().startsWith('Saved'))) {
          window.probe.premature.push({ state: status.dataset.saveState, label: status.textContent });
        }
      }).observe(document.body, { childList: true, characterData: true, subtree: true, attributes: true });
    });
    const editor = () => page.getByRole('textbox', { name: 'Scratchpad', exact: true });
    await editor().fill('Survives development restart');
    await page.evaluate(() => { window.probe.watch = true; });
    await expect(page.getByTestId('scratch-save-status')).toHaveAttribute('data-save-state', 'error');
    await expect(editor()).toHaveValue('Survives development restart');
    await page.evaluate(() => { window.probe.fail = false; });
    await page.getByRole('button', { name: 'Retry saving', exact: true }).click();
    await expect(page.getByTestId('scratch-save-status')).toHaveAttribute('data-save-state', 'saved');
    const result = await page.evaluate(() => window.probe);
    await testInfo.attach('Scratch transaction ordering', {
      body: JSON.stringify(result, null, 2), contentType: 'application/json',
    });
    await page.screenshot({ path: testInfo.outputPath('scratch-durable-saved.png') });
    expect(result.premature).toEqual([]);
    expect(result.aborted).toBeGreaterThan(0);
    expect(result.completed).toBeGreaterThan(0);
    // Keep the committed revision but roll back only the mirror body. WebView2
    // can leave this partial snapshot even after the strict journal completed.
    const tornMirror = await page.evaluate(() => {
      const state = JSON.parse(localStorage.getItem('pl2-pads'));
      const revision = localStorage.getItem('pl2-scratch-journal-revision');
      state.pads[0].content = 'Synthetic stale mirror body';
      localStorage.setItem('pl2-pads', JSON.stringify(state));
      return { revision, after: localStorage.getItem('pl2-scratch-journal-revision') };
    });
    expect(tornMirror.after).toBe(tornMirror.revision);
    for (let restart = 0; restart < 3; restart++) {
      await context.close();
      await open();
      await expect(editor()).toHaveValue('Survives development restart');
    }
  } finally {
    await context?.close();
    await fs.rm(profile, { recursive: true, force: true });
  }
});
