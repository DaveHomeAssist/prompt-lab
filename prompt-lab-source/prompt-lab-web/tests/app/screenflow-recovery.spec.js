import { expect, test } from '@playwright/test';

const PRIOR = 'Displaced draft must survive the shared import.';
const SHARED = 'Incoming shared prompt must have its own identity.';

async function prepare(page) {
  await page.addInitScript(({ prior }) => {
    localStorage.setItem('pl_telemetry_consent', 'denied');
    if (!sessionStorage.getItem('screenflow-seeded')) {
      sessionStorage.setItem('screenflow-seeded', '1');
      localStorage.setItem('pl2-library', JSON.stringify([{ id: 'prior', title: 'Prior prompt', original: 'Saved prior body', enhanced: '', currentVersionId: 'prior-v1', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }]));
      localStorage.setItem('pl2-session-pl2-session', JSON.stringify({ raw: prior, enhanced: '', variants: [], notes: '', editingId: 'prior', editingVersionId: 'prior-v1', saveTitle: 'Prior prompt', tab: 'editor' }));
    }
    const write = Storage.prototype.setItem;
    window.failDraftCheckpoint = false;
    Storage.prototype.setItem = function (key, value) {
      if (window.failDraftCheckpoint && key === 'pl2-session-pl2-session') throw new DOMException('Fixture quota', 'QuotaExceededError');
      return write.call(this, key, value);
    };
  }, { prior: PRIOR });
  await page.route('**/api/**', route => route.fulfill({ status: 503, json: { error: 'Offline fixture' } }));
}

for (const [width, height] of [[1440, 900], [375, 812]]) {
  test(`shared import saves separately and restores the displaced draft at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await prepare(page);
    const payload = Buffer.from(JSON.stringify({ title: 'Shared fixture', original: SHARED })).toString('base64');
    await page.goto(`/app/#share=${payload}`);
    const dialog = page.getByRole('dialog', { name: 'Save as new prompt' });
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId('prompt-input')).toHaveValue(SHARED);
    await expect.poll(() => page.evaluate(() => Array.isArray(JSON.parse(localStorage.getItem('pl2-library')).find(row => row.id === 'prior')?.versions))).toBe(true);
    const before = await page.evaluate(() => JSON.parse(localStorage.getItem('pl2-library')).find(row => row.id === 'prior'));
    await dialog.getByTestId('save-to-library').click();
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('pl2-library')).length)).toBe(2);
    const rows = await page.evaluate(() => JSON.parse(localStorage.getItem('pl2-library')));
    expect(rows.find(row => row.id === 'prior')).toEqual(before);
    expect(rows.find(row => row.id !== 'prior').original).toBe(SHARED);
    await expect(page.locator('#save-receipt-title')).toBeVisible();
    await page.getByRole('button', { name: 'Restore previous draft', exact: true }).click();
    await expect(page.getByTestId('prompt-input')).toHaveValue(PRIOR);
    await expect(page.locator('#save-receipt-title')).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId('prompt-input')).toHaveValue(PRIOR);
  });

  test(`immediate refresh and failed checkpoint recovery at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await prepare(page);
    await page.goto('/app/');
    const input = page.getByTestId('prompt-input');
    await expect(input).toHaveValue(PRIOR);
    await input.fill('Latest edit before immediate refresh.');
    await page.reload();
    await expect(input).toHaveValue('Latest edit before immediate refresh.');
    await page.evaluate(() => { window.failDraftCheckpoint = true; });
    await input.fill('Retain this draft after storage failure.');
    await expect(page.getByRole('alert').filter({ hasText: 'Draft recovery could not be saved' })).toBeVisible();
    expect(await page.evaluate(() => ({ x: document.documentElement.scrollWidth > document.documentElement.clientWidth, y: document.documentElement.scrollHeight > document.documentElement.clientHeight }))).toEqual({ x: false, y: false });
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('pl2-session-pl2-session')).raw)).toBe('Latest edit before immediate refresh.');
    expect(await page.evaluate(() => { const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; })).toBe(true);
    await page.evaluate(() => { window.failDraftCheckpoint = false; });
    await page.getByRole('button', { name: 'Retry draft recovery', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Draft recovery could not be saved' })).toHaveCount(0);
    await page.reload();
    await expect(input).toHaveValue('Retain this draft after storage failure.');
    expect(await page.evaluate(() => ({ x: document.documentElement.scrollWidth > document.documentElement.clientWidth, y: document.documentElement.scrollHeight > document.documentElement.clientHeight }))).toEqual({ x: false, y: false });
  });
}

for (const width of [1440, 375]) {
  test(`batch cancellation remains reachable after navigation at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await prepare(page);
    await page.addInitScript(() => localStorage.setItem('pl2-billing', JSON.stringify({ plan: 'pro', status: 'active', lastVerifiedAt: new Date().toISOString(), lastValidatedAt: new Date().toISOString() })));
    let requests = 0;
    let releaseSecond;
    const second = new Promise(resolve => { releaseSecond = resolve; });
    await page.route('**/api/proxy', async route => {
      if (route.request().method() !== 'POST') return route.fulfill({ json: { models: [{ id: 'claude-sonnet-4-6', label: 'Fixture model' }] } });
      requests += 1;
      if (requests === 2) await second;
      await route.fulfill({ json: { model: 'claude-sonnet-4-6', content: [{ type: 'text', text: JSON.stringify({ enhanced: 'Completed fixture output', variants: [], notes: '' }) }] } }).catch(() => {});
    });
    await page.goto('/app/');
    await expect(page.getByTestId('prompt-input')).toBeVisible();
    await page.evaluate(async () => {
      const db = await new Promise((resolve, reject) => { const req = indexedDB.open('prompt_lab_local', 4); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
      const tx = db.transaction('test_cases', 'readwrite');
      for (let i = 1; i <= 3; i += 1) tx.objectStore('test_cases').put({ id: `case-${i}`, promptId: 'prior', title: `Case ${i}`, input: `Summarize synthetic fixture ${i}`, expectedTraits: [], expectedExclusions: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
      db.close();
      window.dispatchEvent(new CustomEvent('pl:records-changed'));
    });
    const menu = page.getByTestId('editor-more-actions');
    if (await menu.isVisible()) await menu.locator('summary').click();
    const run = page.getByRole('button', { name: 'Test Enhancer', exact: true });
    await expect(run).toBeEnabled();
    await run.click();
    await expect.poll(() => requests).toBe(2);
    await page.evaluate(() => { window.location.hash = '#/library'; });
    await expect(page.getByTestId('library-search')).toBeVisible();
    await page.getByRole('button', { name: 'Stop batch', exact: true }).click();
    releaseSecond();
    await expect(page.locator('aside[role="status"]').filter({ hasText: 'Batch stopped: 1/3 completed' })).toBeVisible();
    expect(requests).toBe(2);
    expect(await page.evaluate(() => ({ x: document.documentElement.scrollWidth > document.documentElement.clientWidth, y: document.documentElement.scrollHeight > document.documentElement.clientHeight }))).toEqual({ x: false, y: false });
    const rows = await page.evaluate(async () => {
      const db = await new Promise(resolve => { const req = indexedDB.open('prompt_lab_local', 4); req.onsuccess = () => resolve(req.result); });
      return new Promise(resolve => { const req = db.transaction('eval_runs').objectStore('eval_runs').getAll(); req.onsuccess = () => { db.close(); resolve(req.result); }; });
    });
    expect(rows.filter(row => row.status === 'success')).toHaveLength(1);
    expect(rows.filter(row => row.status === 'canceled')).toHaveLength(1);
    await page.reload();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('pl2-library')).find(row => row.id === 'prior').metadata.suite)).toMatchObject({ status: 'canceled', completed: 1, total: 3, verdict: null });
  });
}
