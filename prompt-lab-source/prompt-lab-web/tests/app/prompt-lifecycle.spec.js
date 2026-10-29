import { expect, test } from '@playwright/test';
import { switchTheme } from './theme-toggle.js';

const source = 'Write a release checklist with owners and clear acceptance criteria.';
const result = 'Create a release checklist. For every item name its owner, verification command, expected result and rollback action.';
const readLibrary = page => page.evaluate(() => JSON.parse(localStorage.getItem('pl2-library') || '[]'));

async function prepare(page, layout) {
  await page.addInitScript(({ layout, source, result }) => {
    if (sessionStorage.getItem('__lifecycleFixture')) return;
    sessionStorage.setItem('__lifecycleFixture', '1');
    localStorage.setItem('pl2-create-layout', JSON.stringify(layout));
    localStorage.setItem('pl_telemetry_consent', 'denied');
    localStorage.setItem('pl2-library', '[]');
    localStorage.setItem('pl2-session-pl2-session', JSON.stringify({
      raw: source, enhanced: result, variants: [], tab: 'editor',
      resultMeta: { schemaVersion: 2, primaryId: 'expanded', selectedCandidateId: 'expanded',
        candidates: [{ id: 'expanded', content: result }], changes: [], assumptions: [], reasoning: 'Synthetic lifecycle fixture.' },
    }));
  }, { layout, source, result });
  // No model, account, analytics or billing requests leave this test.
  await page.route('**/api/**', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }));
  await page.goto('/app/');
  await expect(page.getByTestId('global-new-prompt')).toBeVisible();
}

async function showResult(page) {
  const switcher = page.getByRole('group', { name: 'Workspace pane' });
  const resultButton = switcher.getByRole('button', { name: 'Result', exact: true });
  if (await resultButton.isVisible()) await resultButton.click();
}

async function fits(page) {
  expect(await page.evaluate(() => ({
    height: document.documentElement.scrollHeight <= document.documentElement.clientHeight,
    width: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  }))).toEqual({ height: true, width: true });
  const button = page.getByTestId('global-new-prompt');
  expect(await button.evaluate(el => {
    const r = el.getBoundingClientRect();
    return r.x >= 0 && r.y >= 0 && r.right <= innerWidth && r.bottom <= innerHeight
      && el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
  })).toBe(true);
}

for (const layout of ['stacked', 'split']) for (const width of [1440, 375]) {
  test(`${layout} lifecycle retains identity, versions, separate save and undo at ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
    await prepare(page, layout);
    const context = page.getByRole('region', { name: 'Editing context' });
    await expect(context).toHaveAttribute('data-editing-mode', 'new');
    await expect(context.getByTestId('refinement-identity')).toContainText('Refine keeps this draft');
    await showResult(page);
    await page.getByLabel('More result actions', { exact: true }).click();
    await page.getByRole('button', { name: 'Library details', exact: true }).click();
    await page.getByLabel('Title', { exact: true }).fill('My release checklist');
    await page.getByRole('button', { name: 'Close save panel' }).click();
    await page.getByLabel('More result actions', { exact: true }).click();
    await page.getByRole('button', { name: 'Library details', exact: true }).click();
    await expect(page.getByLabel('Title', { exact: true })).toHaveValue('My release checklist');
    await page.getByRole('button', { name: 'Close save panel' }).click();
    await page.getByTestId('save-to-library').click();
    await expect(context).toHaveAttribute('data-editing-mode', 'editing');
    const first = (await readLibrary(page))[0];
    expect(first.id).toBeTruthy();
    expect(first.title).toBe('My release checklist');
    await expect(context).toContainText('Save adds a new version');
    await expect(page.getByRole('button', { name: 'New Prompt', exact: true })).toHaveCount(1);

    await page.route('**/api/proxy', route => route.fulfill({
      status: 200, contentType: 'text/event-stream',
      body: `data: ${JSON.stringify({ type: 'content_block_delta', delta: { text: JSON.stringify({
        enhanced: `${result} Include a named rollback owner.`,
        changes: ['Assign the rollback step to a named owner.'],
        reasoning: 'Makes the recovery step actionable by requiring a responsible owner for each rollback.',
        variants: [],
      }) } })}\n\ndata: ${JSON.stringify({ type: 'message_stop' })}\n\n`,
    }));
    const sourceButton = page.getByRole('group', { name: 'Workspace pane' }).getByRole('button', { name: 'Source', exact: true });
    if (await sourceButton.isVisible()) await sourceButton.click();
    await page.getByTestId('refine-action').click();
    await expect(page.getByTestId('refine-action')).toBeEnabled();
    await showResult(page);
    await expect(page.getByTestId('output-textarea')).toHaveValue(`${result} Include a named rollback owner.`);
    expect(await readLibrary(page)).toEqual([first]);
    await page.getByTestId('save-to-library').click();
    await expect.poll(async () => (await readLibrary(page))[0].versions.length).toBe(first.versions.length + 1);
    const versioned = (await readLibrary(page))[0];
    expect(versioned.id).toBe(first.id);
    expect(versioned.title).toBe('My release checklist');
    await page.getByLabel('More result actions', { exact: true }).click();
    await page.getByRole('button', { name: 'Save as new prompt', exact: true }).click();
    await expect.poll(async () => (await readLibrary(page)).length).toBe(2);
    const separate = (await readLibrary(page)).find(entry => entry.id !== first.id);
    expect(separate.id).toBeTruthy();
    expect((await readLibrary(page)).find(entry => entry.id === first.id)).toEqual(versioned);

    await page.getByTestId('global-new-prompt').click();
    await page.getByRole('dialog', { name: 'Start a new prompt?' }).getByRole('button', { name: 'Start new prompt', exact: true }).click();
    await expect(context).toHaveAttribute('data-editing-mode', 'new');
    await expect(page.getByTestId('prompt-input')).toHaveValue('');
    await page.getByRole('button', { name: 'Undo reset', exact: true }).click();
    await expect(context).toHaveAttribute('data-editing-mode', 'editing');
    await showResult(page);
    await page.getByTestId('output-textarea').fill(`${result} Verify the independently saved copy.`);
    await page.getByTestId('save-to-library').click();
    expect((await readLibrary(page)).find(entry => entry.id === first.id)).toEqual(versioned);
    expect((await readLibrary(page)).find(entry => entry.id === separate.id).enhanced).toContain('independently saved copy');
    await fits(page);
    await page.screenshot({ path: testInfo.outputPath(`saved-${layout}-${width}.png`) });
  });
}

for (const [width, height] of [[1440, 900], [375, 812], [844, 390], [320, 256], [3840, 1080]]) {
  test(`New Prompt stays in the header across routes and themes at ${width}x${height}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height });
    await prepare(page, 'split');
    for (const theme of ['light', 'dark']) {
      if (theme === 'dark') await switchTheme(page, 'dark');
      for (const route of ['/', '/split', '/library', '/evaluate', '/scratch']) {
        await page.evaluate(route => { location.hash = route; }, route);
        const button = page.getByRole('button', { name: 'New Prompt', exact: true });
        await expect(button).toHaveCount(1);
        await expect(button).toBeVisible();
        expect(await button.evaluate(el => Boolean(el.closest('header')))).toBe(true);
        if (route === '/split') await expect(page.getByRole('region', { name: 'Editing context' })).toBeVisible();
        await fits(page);
        if (route === '/' || route === '/split') expect(await page.locator('#prompt-lab-main').evaluate(el => el.clientHeight)).toBeGreaterThan(80);
      }
    }
    await page.screenshot({ path: testInfo.outputPath(`header-${width}.png`) });
  });
}
