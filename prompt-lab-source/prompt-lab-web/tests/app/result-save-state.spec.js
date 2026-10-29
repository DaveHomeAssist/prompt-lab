import { expect, test } from '@playwright/test';
import { switchTheme } from './theme-toggle.js';

for (const [width, height] of [[375, 812], [768, 1024], [844, 390], [1440, 900], [3840, 1080]]) {
  test(`long result keeps Save and its acknowledged status together at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height });
    await page.addInitScript(() => {
      localStorage.setItem('pl2-create-layout', JSON.stringify('split'));
      localStorage.setItem('pl_telemetry_consent', 'denied');
      localStorage.setItem('pl2-session-pl2-session', JSON.stringify({
        raw: 'Write a deployment acceptance plan.', enhanced: 'Review every release requirement.\n'.repeat(150), tab: 'editor', variants: [], saveTitle: 'Acceptance plan',
        resultMeta: { schemaVersion: 2, primaryId: 'expanded', selectedCandidateId: 'expanded', candidates: [
          { id: 'expanded', content: 'Review every release requirement.\n'.repeat(150) }, { id: 'refined', content: 'Refined result.' }, { id: 'rebuilt', content: 'Rebuilt result.' },
        ], assumptions: [{ id: 'a1', text: 'Review assumption one', candidateId: 'expanded' }, { id: 'a2', text: 'Review assumption two', candidateId: 'expanded' }], reversibleEdits: Array.from({ length: 5 }, (_, i) => ({ id: `edit${i}`, candidateId: 'expanded', before: 'old', after: 'new', label: `Review edit ${i}` })) },
      }));
      const original = Storage.prototype.setItem;
      window.__failLibrarySave = false;
      Storage.prototype.setItem = function (key, value) {
        if (window.__failLibrarySave && key === 'pl2-library') throw new DOMException('Synthetic storage full', 'QuotaExceededError');
        return original.call(this, key, value);
      };
    });
    await page.route('**/api/**', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Offline acceptance fixture"}' }));
    await page.goto('/app/');
    const resultSwitch = page.getByRole('group', { name: 'Workspace pane' }).getByRole('button', { name: 'Result', exact: true });
    if (await resultSwitch.isVisible()) await resultSwitch.click();
    const pane = page.locator('#create-result-pane');
    const bar = page.locator('.pl-result-commit-bar');
    const save = page.getByTestId('save-to-library');
    await expect(save).toBeVisible();
    for (const mode of ['light', 'dark']) {
      if (await page.locator('.pl-app-shell').getAttribute('data-theme') !== mode) await switchTheme(page, mode);
      await page.getByRole('region', { name: 'Result review content' }).evaluate(el => { el.scrollTop = el.scrollHeight; });
      const bounds = await save.boundingBox();
      const paneBounds = await pane.boundingBox();
      expect(bounds.y).toBeGreaterThanOrEqual(paneBounds.y);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(paneBounds.y + paneBounds.height + 1);
      await expect(bar).toContainText('Selected: Expanded');
      const dimensions = await page.evaluate(() => ({ x: document.documentElement.scrollWidth - document.documentElement.clientWidth, y: document.documentElement.scrollHeight - document.documentElement.clientHeight }));
      expect(dimensions).toEqual({ x: 0, y: 0 });
      await page.screenshot({ path: testInfo.outputPath(`result-review-${mode}-${width}.png`) });
    }
    await page.evaluate(() => { window.__failLibrarySave = true; });
    await save.click();
    await expect(bar).toContainText('Save failed. Your result is still here. Retry saving.');
    await page.evaluate(() => { window.__failLibrarySave = false; });
    await save.click();
    await expect(bar).toContainText(/Saved Expanded to .+version 1/);
    await expect(bar).not.toContainText('Current result has unsaved changes.');
    const editor = page.getByLabel('Expanded candidate');
    await editor.fill('Later change after the acknowledged save.');
    await expect(bar).toContainText('Current result has unsaved changes.');
    await editor.press('ControlOrMeta+s');
    await expect(bar).toContainText(/Saved Expanded to .+version 2/);
    await expect(bar).not.toContainText('Current result has unsaved changes.');
    await editor.fill('A change saved after keyboard retry.');
    await page.evaluate(() => { window.__failLibrarySave = true; });
    await save.click();
    await expect(bar).toContainText('Save failed.');
    await page.evaluate(() => { window.__failLibrarySave = false; });
    await editor.press('ControlOrMeta+s');
    await expect(bar).toContainText(/Saved Expanded to .+version 3/);
    await expect(bar).not.toContainText('Save failed.');
    await expect(bar).not.toContainText('Current result has unsaved changes.');
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('pl2-library'))[0].enhanced)).toBe('A change saved after keyboard retry.');
    await page.screenshot({ path: testInfo.outputPath(`result-save-${width}.png`) });
  });
}
