import { expect, test } from '@playwright/test';
import { switchTheme } from './theme-toggle.js';

// Slice 2 of the October intake: Prompts beside Write (All, Recent and
// Favorites), the resizable Library drawer and the wider inspector.

const DAY = 24 * 60 * 60 * 1000;

async function seed(page) {
  await page.addInitScript(({ DAY }) => {
    if (sessionStorage.getItem('__writeSideFixture')) return;
    sessionStorage.setItem('__writeSideFixture', '1');
    const now = Date.now();
    const iso = daysAgo => new Date(now - daysAgo * DAY).toISOString();
    const prompt = (id, title, extra) => ({ id, title, original: `${title} draft.`, enhanced: `${title} improved.`, collection: '', tags: [], versions: [], ...extra });
    localStorage.setItem('pl2-library', JSON.stringify([
      prompt('weekly', 'Weekly status update', { favorite: true, collection: 'Ops', createdAt: iso(9), updatedAt: iso(6), lastAccessedAt: iso(1), useCount: 2 }),
      prompt('release', 'Release checklist', { createdAt: iso(5), updatedAt: iso(2), useCount: 0 }),
      prompt('reply', 'Customer reply', { favorite: true, createdAt: iso(4), updatedAt: iso(4), useCount: 1 }),
      prompt('brief', 'Research brief', { createdAt: iso(8), updatedAt: iso(7), lastAccessedAt: iso(3), useCount: 4 }),
    ]));
    localStorage.setItem('pl2-collections', JSON.stringify(['Ops']));
    localStorage.setItem('pl_telemetry_consent', 'denied');
    localStorage.setItem('pl2-telemetry', JSON.stringify({ consent: 'denied' }));
  }, { DAY });
  // No model, account, analytics or billing requests leave this test.
  await page.route('**/api/**', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }));
}

async function fits(page) {
  expect(await page.evaluate(() => ({
    height: document.documentElement.scrollHeight <= document.documentElement.clientHeight,
    width: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  }))).toEqual({ height: true, width: true });
}

const libraryTitles = page => page.getByRole('list', { name: 'Saved prompts' }).getByRole('button', { name: /^Inspect / })
  .evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label').replace(/^Inspect /, '')));
const sideTitles = page => page.getByRole('complementary', { name: 'Prompts beside Write' }).getByRole('button', { name: /^Open .* in Write$/ })
  .evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label').replace(/^Open /, '').replace(/ in Write$/, '')));

test('Prompts beside Write list the same prompts as the Library smart views', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await seed(page);
  await page.goto('/app/#/library');
  const views = page.getByRole('navigation', { name: 'Smart views' });
  const expected = {};
  for (const [view, name] of [['all', /^All prompts/], ['recent', /^Recent/], ['favorites', /^Favorites/]]) {
    await views.getByRole('button', { name }).click();
    expected[view] = await libraryTitles(page);
  }
  expect(expected.favorites).toEqual(['Customer reply', 'Weekly status update']);
  expect(expected.recent.slice(0, 2)).toEqual(['Weekly status update', 'Release checklist']);

  for (const theme of ['light', 'dark']) {
    await page.evaluate(() => { location.hash = '/'; });
    if (theme === 'dark') await switchTheme(page, 'dark');
    const toggle = page.getByRole('button', { name: 'Prompts', exact: true });
    if (await toggle.getAttribute('aria-pressed') !== 'true') await toggle.click();
    const panel = page.getByRole('complementary', { name: 'Prompts beside Write' });
    await expect(panel).toBeVisible();
    for (const [view, label] of [['all', 'All'], ['recent', 'Recent'], ['favorites', 'Favorites']]) {
      await panel.getByRole('group', { name: 'Prompt list' }).getByRole('button', { name: label, exact: true }).click();
      await expect.poll(() => sideTitles(page), { message: `${view} in ${theme}` }).toEqual(expected[view]);
    }
    await fits(page);
    await page.screenshot({ path: testInfo.outputPath(`write-prompts-${theme}.png`) });
  }

  // The chosen list survives a reload, and opening a prompt loads it into Write.
  await page.reload();
  const panel = page.getByRole('complementary', { name: 'Prompts beside Write' });
  await expect(panel.getByRole('button', { name: 'Favorites', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await panel.getByRole('button', { name: 'Open Customer reply in Write' }).click();
  await expect(page.getByRole('region', { name: 'Editing context' })).toContainText('Customer reply');
  await panel.getByRole('button', { name: 'Recent', exact: true }).click();
  await expect.poll(() => sideTitles(page)).toEqual(expect.arrayContaining(['Customer reply']));
  expect((await sideTitles(page))[0]).toBe('Customer reply');
});

for (const size of [{ width: 768, height: 900 }, { width: 375, height: 812 }, { width: 320, height: 256 }, { width: 3840, height: 1080 }]) {
  test(`Prompts beside Write open without page overflow at ${size.width}x${size.height}`, async ({ page }, testInfo) => {
    await page.setViewportSize(size);
    await seed(page);
    await page.addInitScript(() => {
      localStorage.setItem('pl2-write-side-view', JSON.stringify('favorites'));
    });
    await page.goto('/app/');
    const toggle = page.getByRole('button', { name: 'Prompts', exact: true });
    // Short phone windows hide the toggles; the shortcut still opens the panel.
    const toggleShown = await toggle.isVisible();
    if (toggleShown) await toggle.click();
    else await page.keyboard.press('Control+Backslash');
    const panel = page.getByRole('complementary', { name: 'Prompts beside Write' });
    await expect(panel).toBeVisible();
    await expect(panel.getByRole('searchbox', { name: 'Search prompts beside Write' })).toBeInViewport();
    await panel.getByRole('button', { name: 'Close side panel' }).click({ trial: true });
    await expect(panel.getByRole('button', { name: 'Favorites', exact: true })).toHaveAttribute('aria-pressed', 'true');
    if (size.height >= 400) await expect(panel.getByRole('button', { name: 'Open Customer reply in Write' })).toBeInViewport();
    await fits(page);
    const box = await panel.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(size.width);
    await page.screenshot({ path: testInfo.outputPath(`write-prompts-${size.width}.png`) });
    if (size.width < 1100) {
      // The floating panel took focus when it opened, so Escape closes it and
      // focus goes back to the toggle.
      await expect(panel.getByRole('button', { name: 'Favorites', exact: true })).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(panel).toBeHidden();
      if (toggleShown) await expect(toggle).toBeFocused();
    }
  });
}

async function openInspector(page) {
  await page.goto('/app/#/library');
  await page.getByRole('button', { name: 'Inspect Release checklist' }).click();
  await expect(page.getByRole('heading', { name: 'Release checklist' })).toBeVisible();
}

const layout = page => page.evaluate(() => {
  const workspace = document.querySelector('.pl-library-workspace');
  const rail = document.querySelector('.pl-library-rail');
  return {
    workspace: workspace.clientWidth,
    rail: rail && !rail.hidden ? rail.getBoundingClientRect().width : 0,
    index: document.querySelector('.pl-library-index').getBoundingClientRect().width,
    inspector: document.querySelector('.pl-library-inspector').getBoundingClientRect().width,
  };
});
const expectedCap = ({ workspace, rail }) => Math.max(260, Math.floor(Math.min(960, workspace * 0.7, workspace - rail - 448)));

for (const size of [{ width: 1440, height: 900 }, { width: 1920, height: 1080 }, { width: 3840, height: 1080 }]) {
  test(`the Library inspector reaches its wider cap by keyboard and pointer at ${size.width}x${size.height}`, async ({ page }, testInfo) => {
    await page.setViewportSize(size);
    await seed(page);
    await openInspector(page);
    const handle = page.getByRole('separator', { name: 'Resize prompt inspector' });
    const grip = handle.locator('span');
    const restingGrip = await grip.evaluate(el => getComputedStyle(el).backgroundColor);
    await handle.hover();
    await expect.poll(() => grip.evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe(restingGrip);

    await handle.focus();
    await page.keyboard.press('End');
    let measured = await layout(page);
    const cap = expectedCap(measured);
    if (size.width >= 1920) expect(cap).toBe(960);
    await expect(handle).toHaveAttribute('aria-valuenow', String(cap));
    measured = await layout(page);
    expect(Math.abs(measured.inspector - cap)).toBeLessThanOrEqual(1);
    expect(measured.index).toBeGreaterThanOrEqual(415);
    await fits(page);

    await page.keyboard.press('Home');
    await expect(handle).toHaveAttribute('aria-valuenow', '260');
    const box = await handle.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(5, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();
    await expect(handle).toHaveAttribute('aria-valuenow', String(cap));
    measured = await layout(page);
    expect(Math.abs(measured.inspector - cap)).toBeLessThanOrEqual(1);
    expect(measured.index).toBeGreaterThanOrEqual(415);
    await fits(page);
    await page.screenshot({ path: testInfo.outputPath(`library-inspector-${size.width}.png`) });
  });
}

test('the Library drawer resizes by pointer and keyboard, persists, and resets on double-click', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await seed(page);
  await openInspector(page);
  const handle = page.getByRole('separator', { name: 'Resize Library drawer' });
  const start = (await layout(page)).rail;
  expect(Math.round(start)).toBe(192);
  const box = await handle.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 80, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
  const dragged = (await layout(page)).rail;
  expect(dragged).toBeGreaterThan(start + 60);
  await handle.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(handle).toHaveAttribute('aria-valuenow', String(Math.round(dragged) - 24));
  await fits(page);

  await page.reload();
  await expect(handle).toHaveAttribute('aria-valuenow', String(Math.round(dragged) - 24));
  expect(Math.round((await layout(page)).rail)).toBe(Math.round(dragged) - 24);
  await handle.dblclick();
  await expect.poll(async () => Math.round((await layout(page)).rail)).toBe(192);
  expect(await page.evaluate(() => localStorage.getItem('pl2-library-drawer-width'))).toBe('null');
  await page.screenshot({ path: testInfo.outputPath('library-drawer.png') });
});

for (const width of [375, 1440]) {
  test(`Write search survives closing and switching tabs at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 812 }); await seed(page); await page.goto('/app/');
    const toggle = page.getByRole('button', { name: 'Prompts', exact: true });
    await toggle.click();
    const panel = page.getByRole('complementary', { name: 'Prompts beside Write' });
    const search = panel.getByRole('searchbox');
    await search.fill('weekly ops');
    await expect.poll(() => sideTitles(page)).toEqual(['Weekly status update']);
    await panel.getByRole('button', { name: 'Close side panel' }).click(); await toggle.click();
    await expect(search).toHaveValue('weekly ops');
    await expect.poll(() => sideTitles(page)).toEqual(['Weekly status update']);
    await panel.getByRole('tab', { name: 'Scratch', exact: true }).click();
    await page.getByRole('complementary', { name: 'Scratch notes beside Write' }).getByRole('tab', { name: 'Prompts', exact: true }).click();
    await expect(search).toHaveValue('weekly ops');
    await search.press('Escape'); await expect(search).toHaveValue(''); await expect(panel).toBeVisible();
  });
}
