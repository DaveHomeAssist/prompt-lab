import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const draft = 'Write a launch brief with a named owner and measurable acceptance criteria.';

async function prepare(page, result = true) {
  await page.addInitScript(({ draft, result }) => {
    if (localStorage.getItem('__graphiteFixture')) return;
    localStorage.setItem('__graphiteFixture', '1');
    localStorage.setItem('pl2-create-layout', JSON.stringify('split'));
    localStorage.setItem('pl_telemetry_consent', 'denied');
    localStorage.setItem('pl2-session-pl2-session', JSON.stringify({
      raw: result ? draft : '', enhanced: result ? draft : '', tab: 'editor', variants: [],
      resultMeta: result ? { schemaVersion: 2, primaryId: 'expanded', selectedCandidateId: 'expanded', candidates: [{ id: 'expanded', content: draft }], changes: [], assumptions: [], reasoning: 'Synthetic visual fixture.' } : null,
    }));
  }, { draft, result });
  await page.route('**/api/**', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetic unavailable service for visual acceptance.' }) }));
  await page.goto('/app/');
  await expect(page.locator('.pl-create-graphite')).toBeVisible();
}

async function pane(page, name) {
  const button = page.getByRole('group', { name: 'Workspace pane' }).getByRole('button', { name, exact: true });
  if (await button.isVisible()) await button.click();
}

async function checkSurface(page, label) {
  // Theme text updates before the existing control background transitions finish.
  await page.locator('.pl-create-graphite').evaluate(async root => {
    const animations = root.getAnimations({ subtree: true })
      .filter(animation => Number.isFinite(animation.effect?.getComputedTiming().endTime));
    await Promise.all(animations.map(animation => animation.finished.catch(() => {})));
  });
  const bounds = await page.evaluate(() => ({ width: document.documentElement.clientWidth, height: document.documentElement.clientHeight, scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight }));
  expect.soft(bounds.scrollWidth, label).toBeLessThanOrEqual(bounds.width);
  expect.soft(bounds.scrollHeight, label).toBeLessThanOrEqual(bounds.height);
  const small = await page.locator('.pl-create-graphite :is(button, select, summary, textarea, input:not([type="hidden"])):visible').evaluateAll(elements => elements.flatMap(element => {
    const target = element.matches('input[type="checkbox"],input[type="radio"]') ? element.closest('label') || element : element;
    const r = target.getBoundingClientRect();
    return r.width < 44 || r.height < 44 ? [{ name: target.textContent.slice(0, 60), width: r.width, height: r.height }] : [];
  }));
  expect.soft(small, `${label} targets`).toEqual([]);
  const axe = await new AxeBuilder({ page }).include('.pl-create-graphite').withRules(['color-contrast']).analyze();
  expect.soft(axe.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => ({ target: n.target, summary: n.failureSummary })) })), `${label} contrast`).toEqual([]);
}

test('flagged Create graphite preserves all palettes, both modes and the responsive shell', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await prepare(page);
  await expect(page.locator('.pl-app-shell')).toHaveAttribute('data-theme', 'light');
  const accents = new Set();
  for (const palette of ['ember', 'ocean', 'forest', 'plum']) {
    await page.getByLabel('Color palette', { exact: true }).selectOption(palette);
    for (const mode of ['light', 'dark']) {
      const toggle = page.getByRole('button', { name: `Switch to ${mode} mode`, exact: true });
      if (await toggle.isVisible()) await toggle.click();
      await expect(page.locator('.pl-create-graphite')).toHaveAttribute('data-create-theme', mode);
      accents.add(await page.locator('.pl-create-graphite').evaluate(el => getComputedStyle(el).getPropertyValue('--pl-brand-ember').trim()));
      for (const [width, height] of [[1440, 900], [375, 812]]) {
        await page.setViewportSize({ width, height });
        await pane(page, 'Source');
        const input = page.getByTestId('prompt-input');
        await input.focus();
        await expect(input).toBeFocused();
        expect(await input.evaluate(el => getComputedStyle(el).outlineStyle)).toBe('solid');
        await checkSurface(page, `${palette}/${mode}/${width} Source`);
        await pane(page, 'Result');
        await expect(page.getByTestId('output-textarea')).toBeVisible();
        await checkSurface(page, `${palette}/${mode}/${width} Result`);
        if (palette === 'ocean') await page.screenshot({ path: testInfo.outputPath(`graphite-${mode}-${width}.png`) });
      }
    }
  }
  expect(accents.size).toBe(8);
  for (const [width, height] of [[768, 1024], [812, 375], [3200, 900]]) {
    await page.setViewportSize({ width, height });
    await pane(page, 'Source');
    await checkSurface(page, `${width} Source`);
    await pane(page, 'Result');
    await checkSurface(page, `${width} Result`);
  }
  await page.reload();
  await expect(page.locator('.pl-create-graphite')).toBeVisible();
  await expect(page.getByLabel('Color palette', { exact: true })).toHaveValue('plum');
  await expect(page.locator('.pl-app-shell')).toHaveAttribute('data-theme', 'dark');
  await page.evaluate(() => localStorage.setItem('pl2-create-layout', JSON.stringify('stacked')));
  await page.reload();
  await expect(page.getByTestId('prompt-input')).toBeVisible();
  await expect(page.locator('.pl-create-graphite')).toHaveCount(0);
  await expect(page.getByLabel('Color palette', { exact: true })).toHaveValue('plum');
});

test('graphite empty and error states retain legible controls', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await prepare(page, false);
  await checkSurface(page, 'Empty light');
  await page.getByTestId('prompt-input').fill(draft);
  await page.getByTestId('refine-action').click();
  await pane(page, 'Result');
  await expect(page.getByRole('alert').first()).toBeVisible();
  await checkSurface(page, 'Error light');
  await page.getByRole('button', { name: 'Switch to dark mode', exact: true }).click();
  await expect(page.locator('.pl-create-graphite')).toHaveAttribute('data-create-theme', 'dark');
  await checkSurface(page, 'Error dark');
  await page.screenshot({ path: testInfo.outputPath('graphite-error-dark-375.png') });
});
