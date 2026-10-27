// Route test for the Library feature, mapped to the Prompt Lab flow audit rows
// (7 and 15 to 37, plus 54). Each test drives one route end to end in the built
// extension panel. Tests tagged @finding assert the correct behavior for a known
// defect and are expected to fail until that defect is fixed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect, test } from '@playwright/test';

const extensionPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');

const SEED = [
  {
    id: 'alpha', title: 'Alpha handoff', original: 'Write the handoff for {{show}}.', enhanced: 'Write a production handoff for {{show}}.',
    collection: 'Ops', tags: ['ops', 'template'], favorite: true, useCount: 9,
    createdAt: '2026-01-01T12:00:00.000Z', updatedAt: '2026-01-02T12:00:00.000Z',
    metadata: { status: 'active', purpose: 'Show handoff for the night crew', owner: 'Dave' },
    variants: [{ id: 'alpha-v1', label: 'Short form', content: 'Short handoff for {{show}}.' }],
    notes: 'Alpha notes',
    versions: [{ id: 'alpha-old', original: 'Handoff draft.', enhanced: 'Handoff draft.', savedAt: '2026-01-01T12:00:00.000Z' }],
  },
  {
    id: 'bravo', title: 'Bravo checklist', original: 'List the load-in checks.', enhanced: 'List every load-in check.',
    collection: 'Ops', tags: ['ops'], favorite: false, useCount: 2,
    createdAt: '2026-02-01T12:00:00.000Z', updatedAt: '2026-02-02T12:00:00.000Z',
    metadata: { status: 'draft', purpose: 'Load-in checklist' }, variants: [], notes: '', versions: [],
  },
  {
    id: 'charlie', title: 'Charlie notes', original: 'Summarize the meeting.', enhanced: 'Summarize the meeting.',
    collection: '', tags: [], favorite: false, useCount: 0,
    createdAt: '2026-03-01T12:00:00.000Z', updatedAt: '2026-03-02T12:00:00.000Z',
    metadata: {}, variants: [], notes: '', versions: [],
  },
  {
    id: 'delta', title: 'Delta archive', original: 'Archive the research.', enhanced: 'Archive the research notes.',
    collection: 'Research', tags: ['research'], favorite: false, useCount: 5,
    createdAt: '2025-12-01T12:00:00.000Z', updatedAt: '2025-12-02T12:00:00.000Z',
    metadata: { status: 'deprecated', purpose: 'Research archive' }, variants: [], notes: '', versions: [],
  },
];

async function withPanel({ width = 1440, height = 900, seed = SEED, route = '#/library' } = {}, run) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pl-library-routes-'));
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: true, acceptDownloads: true,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  const dialogs = [];
  try {
    await context.addInitScript(({ entries }) => {
      if (sessionStorage.getItem('route-seeded')) return;
      localStorage.setItem('pl2-library', JSON.stringify(entries));
      localStorage.setItem('pl2-collections', JSON.stringify(['Ops', 'Research']));
      localStorage.setItem('pl_telemetry_consent', 'denied');
      localStorage.setItem('pl2-telemetry', JSON.stringify({ consent: 'denied' }));
      sessionStorage.setItem('route-seeded', 'yes');
    }, { entries: seed });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const base = `chrome-extension://${new URL(worker.url()).host}/panel.html`;
    const page = await context.newPage();
    page.on('dialog', dialog => { dialogs.push(dialog.message()); dialog.accept(); });
    await page.setViewportSize({ width, height });
    await page.goto(`${base}${route}`);
    await run({ page, base, dialogs, context });
  } finally {
    await context.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

const results = page => page.getByRole('list', { name: 'Saved prompts' });
const titles = page => results(page).locator('.pl-library-card-title strong').allTextContents();
const heading = page => page.locator('.pl-library-index-heading h2');
const smartView = (page, label) => page.getByRole('navigation', { name: 'Smart views' }).getByRole('button', { name: new RegExp(`^${label}`) });
const inspect = (page, title) => page.getByRole('button', { name: `Inspect ${title}` }).click();
const inspectorTab = (page, label) => page.getByRole('tablist', { name: 'Prompt details' }).getByRole('tab', { name: label, exact: true });
const stored = page => page.evaluate(() => JSON.parse(localStorage.getItem('pl2-library') || '[]'));
const purposeField = page => page.locator('.pl-library-inspector').getByLabel('Purpose');
// Reloads, then returns to #/library. The extension can drop the route on reload
// (see the R07 @finding test), so persistence tests re-enter the Library on purpose.
async function reloadIntoLibrary(page) {
  await page.reload();
  await page.waitForTimeout(400);
  if (!page.url().endsWith('#/library')) await page.evaluate(() => { location.hash = '#/library'; });
  await expect(page).toHaveURL(/#\/library$/);
}

// ── Row 7 · Direct URL navigation ──────────────────────────────────────────
test('R07 direct #/library deep link opens the Library and Back/Forward keep it', async () => withPanel({}, async ({ page }) => {
  await expect(heading(page)).toHaveText('4 prompts');
  await page.evaluate(() => { location.hash = '#/composer'; });
  await expect(page).toHaveURL(/#\/composer$/);
  await expect(results(page)).toBeHidden();
  await page.goBack();
  await expect(page).toHaveURL(/#\/library$/);
  await expect(heading(page)).toHaveText('4 prompts');
  await page.goForward();
  await expect(page).toHaveURL(/#\/composer$/);
}));

test('R07 @finding reloading on #/library stays on the Library once a session exists', async () => withPanel({}, async ({ page }) => {
  await expect(heading(page)).toHaveText('4 prompts');
  await page.waitForTimeout(1000);
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    await page.reload();
    await page.waitForTimeout(600);
    expect(page.url(), `reload ${attempt}`).toMatch(/#\/library$/);
  }
}));

test('R07 #/split/library deep link renders the Library pane', async () => withPanel({ route: '#/split/library' }, async ({ page }) => {
  await expect(page.getByText('Alpha handoff').first()).toBeVisible();
}));

// ── Row 54 · Unknown route ────────────────────────────────────────────────
test('R54 unknown route recovers to Write, explains why, and leaves no dead history entry', async () => withPanel({}, async ({ page }) => {
  await expect(heading(page)).toHaveText('4 prompts');
  await page.evaluate(() => { location.hash = '#/nope'; });
  await expect(page.getByRole('status').filter({ hasText: 'Page not found (/nope)' })).toBeVisible();
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.getByTestId('prompt-input')).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/#\/library$/);
}));

// ── Row 15 · Library overview ─────────────────────────────────────────────
test('R15 overview lists every prompt with title, uses and date', async () => withPanel({}, async ({ page }) => {
  await expect(heading(page)).toHaveText('4 prompts');
  expect(await titles(page)).toEqual(['Charlie notes', 'Bravo checklist', 'Alpha handoff', 'Delta archive']);
  const alpha = results(page).getByRole('listitem').filter({ hasText: 'Alpha handoff' });
  await expect(alpha).toContainText('9 uses');
  // One earlier snapshot plus the current content = 2 versions (V-08).
  await expect(alpha).toContainText('2 ver');
}));

// ── Row 16 · Smart views ──────────────────────────────────────────────────
test('R16 smart views filter or reorder correctly', async () => withPanel({}, async ({ page }) => {
  await smartView(page, 'Favorites').click();
  expect(await titles(page)).toEqual(['Alpha handoff']);
  await smartView(page, 'Templates').click();
  expect(await titles(page)).toEqual(['Alpha handoff']);
  await smartView(page, 'Incomplete').click();
  expect(await titles(page)).toEqual(['Charlie notes']);
  await smartView(page, 'Frequently used').click();
  expect(await titles(page)).toEqual(['Alpha handoff', 'Delta archive', 'Bravo checklist', 'Charlie notes']);
  await smartView(page, 'Recent').click();
  expect(await titles(page)).toEqual(['Charlie notes', 'Bravo checklist', 'Alpha handoff', 'Delta archive']);
}));

test('R16 @finding Frequently used count matches prompts that have uses', async () => withPanel({}, async ({ page }) => {
  await expect(smartView(page, 'Frequently used').locator('small')).toHaveText('3');
}));

// ── Row 17 · Search ───────────────────────────────────────────────────────
test('R17 search matches title, tag and metadata, and the chip clears it', async () => withPanel({}, async ({ page }) => {
  const search = page.getByTestId('library-search');
  await search.fill('bravo');
  expect(await titles(page)).toEqual(['Bravo checklist']);
  await search.fill('research');
  expect(await titles(page)).toEqual(['Delta archive']);
  await search.fill('night crew');
  expect(await titles(page)).toEqual(['Alpha handoff']);
  await search.fill('zzzz-no-match');
  await expect(page.getByText('Nothing here yet')).toBeVisible();
  await page.getByRole('button', { name: 'Remove Search: zzzz-no-match filter' }).click();
  await expect(heading(page)).toHaveText('4 prompts');
}));

// ── Row 18 · Status filtering ─────────────────────────────────────────────
test('R18 status filter isolates draft, active and deprecated', async () => withPanel({}, async ({ page }) => {
  const filter = page.getByLabel('Filter by status');
  await filter.selectOption('draft');
  expect(await titles(page)).toEqual(['Bravo checklist']);
  await filter.selectOption('active');
  expect(await titles(page)).toEqual(['Alpha handoff']);
  await filter.selectOption('deprecated');
  expect(await titles(page)).toEqual(['Delta archive']);
  await filter.selectOption('');
  await expect(heading(page)).toHaveText('4 prompts');
}));

test('R18 @finding status filter can isolate prompts with no status', async () => withPanel({}, async ({ page }) => {
  const labels = await page.getByLabel('Filter by status').locator('option').allTextContents();
  expect(labels.some(label => /not set|no status|unset/i.test(label))).toBe(true);
}));

// ── Row 19 · Sorting ──────────────────────────────────────────────────────
test('R19 every sort option orders the list as labelled', async () => withPanel({}, async ({ page }) => {
  const sort = page.getByLabel('Sort prompts');
  await sort.selectOption('oldest');
  expect(await titles(page)).toEqual(['Delta archive', 'Alpha handoff', 'Bravo checklist', 'Charlie notes']);
  await sort.selectOption('most-used');
  expect(await titles(page)).toEqual(['Alpha handoff', 'Delta archive', 'Bravo checklist', 'Charlie notes']);
  await sort.selectOption('a-z');
  expect(await titles(page)).toEqual(['Alpha handoff', 'Bravo checklist', 'Charlie notes', 'Delta archive']);
  await sort.selectOption('z-a');
  expect(await titles(page)).toEqual(['Delta archive', 'Charlie notes', 'Bravo checklist', 'Alpha handoff']);
  await sort.selectOption('group');
  expect(await titles(page)).toEqual(['Alpha handoff', 'Bravo checklist', 'Delta archive', 'Charlie notes']);
  await sort.selectOption('newest');
  expect(await titles(page)).toEqual(['Charlie notes', 'Bravo checklist', 'Alpha handoff', 'Delta archive']);
}));

test('R19 manual order moves a prompt and survives reload', async () => withPanel({}, async ({ page }) => {
  await page.getByLabel('Sort prompts').selectOption('manual');
  const before = await titles(page);
  await page.getByRole('button', { name: `Move ${before[0]} down` }).click();
  const after = await titles(page);
  expect(after.slice(0, 2)).toEqual([before[1], before[0]]);
  const ids = Object.fromEntries(SEED.map(entry => [entry.title, entry.id]));
  await expect.poll(async () => (await stored(page)).map(entry => entry.id)).toEqual(after.map(title => ids[title]));
  await reloadIntoLibrary(page);
  await expect(heading(page)).toHaveText('4 prompts');
  expect(await titles(page)).toEqual(after);
}));

// ── Row 20 · Layouts ──────────────────────────────────────────────────────
test('R20 all four layouts switch and the choice survives reload', async () => withPanel({}, async ({ page }) => {
  for (const [label, cls] of [['Tile view', 'is-tiles'], ['Compact view', 'is-compact'], ['Gallery view', 'is-gallery'], ['List view', 'is-list']]) {
    await page.getByRole('button', { name: label }).click();
    await expect(page.getByRole('button', { name: label })).toHaveAttribute('aria-pressed', 'true');
    await expect(results(page)).toHaveClass(new RegExp(cls));
  }
  await page.getByRole('button', { name: 'Gallery view' }).click();
  await reloadIntoLibrary(page);
  await expect(results(page)).toHaveClass(/is-gallery/);
}));

// ── Rows 21 and 22 · Collections ──────────────────────────────────────────
test('R21 selecting a collection filters to its prompts and shows a chip', async () => withPanel({}, async ({ page }) => {
  const gate = page.getByRole('button', { name: 'Unlock collections' });
  test.skip(await gate.isVisible(), 'Collections are Pro gated in this build');
  await page.locator('.pl-folder-select', { hasText: 'Ops' }).click();
  expect(await titles(page)).toEqual(['Bravo checklist', 'Alpha handoff']);
  await expect(page.getByRole('button', { name: 'Remove Collection: Ops filter' })).toBeVisible();
}));

test('R22 create, rename and remove a folder without losing prompts', async () => withPanel({}, async ({ page, dialogs }) => {
  const gate = page.getByRole('button', { name: 'Unlock collections' });
  test.skip(await gate.isVisible(), 'Collections are Pro gated in this build');
  await page.getByRole('button', { name: 'Manage collections' }).click();
  await page.getByLabel('New collection name').fill('Archive');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  const row = page.locator('.pl-collection-manage-row').filter({ hasText: /^Archive/ });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Rename / Move' }).click();
  await page.getByLabel('Rename Archive').fill('Vault');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const renamed = page.locator('.pl-collection-manage-row').filter({ hasText: /^Vault/ });
  await expect(renamed).toBeVisible();
  await renamed.getByRole('button', { name: 'Remove folder Vault, keep prompts' }).click();
  await expect(renamed).toBeHidden();
  await expect(heading(page)).toHaveText('4 prompts');
  test.info().annotations.push({ type: 'dialogs', description: JSON.stringify(dialogs) });
}));

// ── Row 23 · Tags ─────────────────────────────────────────────────────────
test('R23 tag cloud filters by tag', async () => withPanel({}, async ({ page }) => {
  await page.locator('.pl-library-tag-cloud').getByRole('button', { name: '#research' }).click();
  expect(await titles(page)).toEqual(['Delta archive']);
  await page.locator('.pl-library-tag-cloud').getByRole('button', { name: '#ops' }).click();
  expect(await titles(page)).toEqual(['Bravo checklist', 'Alpha handoff']);
}));

// ── Row 24 · Combined filters and reset ───────────────────────────────────
test('R24 filters combine, chips remove one at a time, Clear all resets and keeps the selection', async () => withPanel({}, async ({ page }) => {
  await inspect(page, 'Alpha handoff');
  await page.getByTestId('library-search').fill('o');
  await page.getByLabel('Filter by status').selectOption('active');
  expect(await titles(page)).toEqual(['Alpha handoff']);
  await page.getByRole('button', { name: 'Remove Status: active filter' }).click();
  expect((await titles(page)).length).toBeGreaterThan(1);
  await page.getByRole('button', { name: 'Clear all' }).click();
  await expect(heading(page)).toHaveText('4 prompts');
  await expect(page.locator('#prompt-inspector-title')).toHaveText('Alpha handoff');
}));

// ── Row 25 · Inspector ────────────────────────────────────────────────────
test('R25 inspector opens with all seven tabs and closes', async () => withPanel({}, async ({ page }) => {
  await inspect(page, 'Alpha handoff');
  await expect(page.locator('#prompt-inspector-title')).toHaveText('Alpha handoff');
  const tabs = await page.getByRole('tablist', { name: 'Prompt details' }).getByRole('tab').allTextContents();
  expect(tabs).toEqual(['Details', 'Content', 'Variables', 'Variants', 'Notes', 'Tests', 'Version history']);
  await page.getByRole('button', { name: 'Close prompt inspector' }).click();
  await expect(page.locator('#prompt-inspector-title')).toBeHidden();
}));

// ── Row 26 · Edit metadata ────────────────────────────────────────────────
test('R26 Save details persists metadata edits', async () => withPanel({}, async ({ page }) => {
  await inspect(page, 'Bravo checklist');
  await purposeField(page).fill('Edited purpose');
  await page.getByRole('button', { name: 'Save details' }).click();
  await expect.poll(async () => (await stored(page)).find(entry => entry.id === 'bravo')?.metadata?.purpose).toBe('Edited purpose');
  await reloadIntoLibrary(page);
  await inspect(page, 'Bravo checklist');
  await expect(purposeField(page)).toHaveValue('Edited purpose');
}));

test('R26 @finding switching prompts keeps or warns about unsaved details', async () => withPanel({}, async ({ page, dialogs }) => {
  await inspect(page, 'Bravo checklist');
  await purposeField(page).fill('Unsaved purpose');
  await inspect(page, 'Delta archive');
  await inspect(page, 'Bravo checklist');
  const kept = await purposeField(page).inputValue() === 'Unsaved purpose';
  expect(kept || dialogs.length > 0, `draft kept: ${kept}, dialogs: ${JSON.stringify(dialogs)}`).toBe(true);
}));

test('R26 @finding closing the inspector keeps or warns about unsaved details', async () => withPanel({}, async ({ page, dialogs }) => {
  await inspect(page, 'Bravo checklist');
  await purposeField(page).fill('Unsaved purpose');
  await page.getByRole('button', { name: 'Close prompt inspector' }).click();
  await inspect(page, 'Bravo checklist');
  const kept = await purposeField(page).inputValue() === 'Unsaved purpose';
  expect(kept || dialogs.length > 0, `draft kept: ${kept}, dialogs: ${JSON.stringify(dialogs)}`).toBe(true);
}));

test('R26 @finding toggling Favorite in the inspector keeps unsaved details', async () => withPanel({}, async ({ page }) => {
  await inspect(page, 'Alpha handoff');
  await purposeField(page).fill('Unsaved purpose');
  await page.locator('.pl-library-inspector footer').getByRole('button', { name: 'Unfavorite prompt' }).click();
  await expect(purposeField(page)).toHaveValue('Unsaved purpose');
}));

// ── Rows 27 to 30 · Inspector tabs ────────────────────────────────────────
test('R27 Content tab shows original and saved output', async () => withPanel({}, async ({ page }) => {
  await inspect(page, 'Alpha handoff');
  await inspectorTab(page, 'Content').click();
  const panel = page.locator('#library-inspector-panel');
  await expect(panel).toContainText('Write the handoff for {{show}}.');
  await expect(panel).toContainText('Write a production handoff for {{show}}.');
  await expect(panel.getByRole('button', { name: 'Copy original' })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Copy output' })).toBeVisible();
}));

test('R28 Variables, Variants and Notes tabs render seeded content', async () => withPanel({}, async ({ page }) => {
  await inspect(page, 'Alpha handoff');
  const panel = page.locator('#library-inspector-panel');
  await inspectorTab(page, 'Variables').click();
  await expect(panel).toContainText('show');
  await inspectorTab(page, 'Variants').click();
  await expect(panel).toContainText('Short form');
  await inspectorTab(page, 'Notes').click();
  await expect(panel).toContainText('Alpha notes');
  await inspect(page, 'Charlie notes');
  await inspectorTab(page, 'Notes').click();
  await expect(panel).not.toContainText('Alpha notes');
}));

test('R29 Tests tab renders the case manager', async () => withPanel({}, async ({ page }) => {
  await inspect(page, 'Alpha handoff');
  await inspectorTab(page, 'Tests').click();
  await expect(page.locator('#library-inspector-panel')).toBeVisible();
  await expect(page.locator('#library-inspector-panel').getByRole('button').first()).toBeVisible();
}));

test('R30 Version history lists prior versions and the current one', async () => withPanel({}, async ({ page }) => {
  await inspect(page, 'Alpha handoff');
  await inspectorTab(page, 'Version history').click();
  const panel = page.locator('#library-inspector-panel');
  await expect(panel).toContainText('Version 1');
  await expect(panel).toContainText('Current version');
}));

// ── Row 31 · Open in Editor ───────────────────────────────────────────────
test('R31 Open in Editor loads the prompt and shows it stays linked', async () => withPanel({}, async ({ page }) => {
  await inspect(page, 'Bravo checklist');
  await page.getByRole('button', { name: 'Open in Editor' }).click();
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.getByTestId('prompt-input')).toHaveValue('List the load-in checks.');
  // The extension shows the compact breadcrumb; the full context bar is hosted web only.
  await expect(page.getByText('Editing', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save new version' }).first()).toBeVisible();
}));

// ── Row 32 · Quick actions ────────────────────────────────────────────────
test('R32 card Copy, Favorite and inspector Duplicate work', async () => withPanel({}, async ({ page }) => {
  await page.getByRole('button', { name: 'Copy Bravo checklist' }).click();
  await expect(page.getByRole('status').filter({ hasText: /Copied/ })).toBeVisible();
  await page.getByRole('button', { name: 'Favorite Bravo checklist' }).click();
  await expect(page.getByRole('button', { name: 'Unfavorite Bravo checklist' })).toBeVisible();
  await expect.poll(async () => (await stored(page)).find(entry => entry.id === 'bravo')?.favorite).toBe(true);
  await inspect(page, 'Bravo checklist');
  await page.getByRole('button', { name: 'Duplicate prompt' }).click();
  await expect(heading(page)).toHaveText('5 prompts');
}));

// ── Row 33 · Bulk actions ─────────────────────────────────────────────────
test('R33 bulk tag, favorite, duplicate and trash act only on the selection', async () => withPanel({}, async ({ page, dialogs }) => {
  await page.getByLabel('Select Bravo checklist').check();
  await page.getByLabel('Select Charlie notes').check();
  const bar = page.getByRole('toolbar', { name: 'Bulk actions' });
  await expect(bar).toContainText('2 selected');
  const reselect = async () => { await page.getByLabel('Select Bravo checklist').check(); await page.getByLabel('Select Charlie notes').check(); };
  await bar.getByPlaceholder('Type + Enter').fill('bulk');
  await bar.getByPlaceholder('Type + Enter').press('Enter');
  await expect.poll(async () => (await stored(page)).filter(entry => (entry.tags || []).includes('bulk')).map(entry => entry.id).sort()).toEqual(['bravo', 'charlie']);
  await expect(bar).toBeHidden(); // each bulk action clears the selection
  await reselect();
  await bar.getByRole('button', { name: 'Favorite', exact: true }).click();
  await expect.poll(async () => (await stored(page)).filter(entry => entry.favorite).map(entry => entry.id).sort()).toEqual(['alpha', 'bravo', 'charlie']);
  await reselect();
  await bar.getByRole('button', { name: 'Duplicate' }).click();
  await expect(heading(page)).toHaveText('6 prompts');
  await page.getByLabel('Select Alpha handoff').check();
  await page.getByLabel('Select Delta archive').check();
  await page.getByRole('toolbar', { name: 'Bulk actions' }).getByRole('button', { name: 'Move to trash' }).click();
  await expect(heading(page)).toHaveText('4 prompts');
  await expect(page.locator('.pl-trash-link small')).toHaveText('2');
  expect(dialogs.some(message => /Recently Deleted/.test(message)), `dialogs: ${JSON.stringify(dialogs)}`).toBe(true);
}));

// ── Row 34 · Recently Deleted ─────────────────────────────────────────────
test('R34 trash, restore and permanent delete', async () => withPanel({}, async ({ page, dialogs }) => {
  await inspect(page, 'Charlie notes');
  await page.getByRole('button', { name: 'Move prompt to Recently Deleted' }).click();
  await expect(heading(page)).toHaveText('3 prompts');
  await page.getByRole('button', { name: /Recently Deleted/ }).first().click();
  const card = results(page).getByRole('listitem').filter({ hasText: 'Charlie notes' });
  await expect(card).toContainText(/left|Removed today/);
  await card.getByRole('button', { name: 'Restore' }).click();
  await smartView(page, 'All').click();
  await expect(heading(page)).toHaveText('4 prompts');
  await inspect(page, 'Charlie notes');
  await page.getByRole('button', { name: 'Move prompt to Recently Deleted' }).click();
  await page.getByRole('button', { name: /Recently Deleted/ }).first().click();
  await page.getByRole('button', { name: 'Permanently delete Charlie notes' }).click();
  await expect(page.locator('.pl-trash-link small')).toHaveText('0');
  await reloadIntoLibrary(page);
  await expect(heading(page)).toHaveText('3 prompts');
  expect(dialogs.some(message => /cannot be undone/.test(message)), `dialogs: ${JSON.stringify(dialogs)}`).toBe(true);
}));

// ── Rows 35 and 36 · Export then import ───────────────────────────────────
test('R36 then R35 export a workspace and import it into an empty profile', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pl-export-')), 'workspace.json');
  await withPanel({}, async ({ page }) => {
    const exportButton = page.locator('.pl-library-toolbar').getByRole('button', { name: /^Export/ });
    test.skip((await exportButton.textContent()).includes('Pro'), 'Export is Pro gated in this build');
    const [download] = await Promise.all([page.waitForEvent('download'), exportButton.click()]);
    await download.saveAs(file);
  });
  const exported = JSON.parse(fs.readFileSync(file, 'utf8'));
  const exportedTitles = JSON.stringify(exported);
  for (const entry of SEED) expect(exportedTitles).toContain(entry.title);
  await withPanel({ seed: [] }, async ({ page }) => {
    await expect(page.getByText('Nothing here yet')).toBeVisible();
    await page.locator('input[aria-label="Import Prompt Lab workspace"]').setInputFiles(file);
    await page.getByRole('button', { name: 'Apply import' }).click();
    await expect(heading(page)).toHaveText('4 prompts');
  });
});

// ── Row 37 · Starter libraries ────────────────────────────────────────────
test('R37 a starter library loads into the Library', async () => withPanel({}, async ({ page }) => {
  const starters = page.locator('details', { hasText: 'Starter Libraries' });
  test.skip(await starters.count() === 0, 'No starter libraries bundled in this build');
  await starters.locator('summary').click();
  const load = starters.getByRole('button').filter({ hasNotText: /loaded/i }).first();
  await load.click();
  await expect.poll(async () => (await stored(page)).length).toBeGreaterThan(4);
}));

// ── Opening a prompt should not count as editing it ───────────────────────
test('R25 @finding inspecting a prompt leaves its updatedAt and Newest position alone', async () => withPanel({}, async ({ page }) => {
  await inspect(page, 'Delta archive');
  await expect(page.locator('#prompt-inspector-title')).toHaveText('Delta archive');
  await page.waitForTimeout(300);
  const delta = (await stored(page)).find(entry => entry.id === 'delta');
  expect(delta.updatedAt).toBe('2025-12-02T12:00:00.000Z');
  expect(await titles(page)).toEqual(['Charlie notes', 'Bravo checklist', 'Alpha handoff', 'Delta archive']);
}));

// ── Row 56 slice · Library on a phone ─────────────────────────────────────
test('R56 phone width opens the Library, inspects a prompt and returns', async () => withPanel({ width: 390, height: 844, route: '#/' }, async ({ page }) => {
  await page.getByRole('navigation', { name: 'Primary mobile navigation' }).getByRole('button', { name: 'Library', exact: true }).click();
  await expect(page).toHaveURL(/#\/library$/);
  await inspect(page, 'Alpha handoff');
  await expect(page.getByRole('dialog', { name: 'Alpha handoff' })).toBeVisible();
  await page.getByRole('button', { name: 'Back to prompts' }).click();
  await expect(page.getByRole('dialog', { name: 'Alpha handoff' })).toBeHidden();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBe(0);
}));
