import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { createClerkClient } from '@clerk/backend';
import { expect, test } from '@playwright/test';
import { forbiddenRequestCategory, readProductionFreeSmokeConfig } from './production-auth.mjs';
import { downloadFreeWorkspace, isFreeFeatureGated } from './production-export.mjs';

test.use({ serviceWorkers: 'block', acceptDownloads: true });

async function openView(page, name, width) {
  if (width < 720) await page.getByRole('navigation', { name: 'Primary mobile navigation' }).getByRole('button', { name, exact: true }).click();
  else await page.getByRole('tablist', { name: 'Workspaces' }).getByRole('tab', { name, exact: true }).click();
}

async function storedState(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('prompt_lab_local', 4);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Synthetic profile database was blocked.'));
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(['eval_runs', 'test_cases'], 'readonly');
      const runs = tx.objectStore('eval_runs').getAll();
      const cases = tx.objectStore('test_cases').getAll();
      tx.oncomplete = () => {
        db.close();
        resolve({ library: JSON.parse(localStorage.getItem('pl2-library') || '[]'),
          collections: JSON.parse(localStorage.getItem('pl2-collections') || '[]'),
          runs: runs.result, testCases: cases.result });
      };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }));
}

const initialWorkspace = {
  product: 'Prompt Lab', schemaVersion: 2, collections: ['Ops', 'Other'],
  library: [
    { id: 'qa-alpha', title: 'QA Alpha', collection: 'Ops', metadata: { owner: 'Avery', purpose: 'Navigation', status: 'active' } },
    { id: 'qa-hidden', title: 'QA Hidden', collection: 'Other' },
    { id: 'qa-beta', title: 'QA Beta', collection: 'Ops', metadata: { packLoadedAt: '2026-09-05T00:00:00Z' } },
    { id: 'qa-child', title: 'QA Child', collection: '' },
  ].map(row => ({ ...row, original: `${row.title} instructions`, enhanced: `${row.title} improved`,
    tags: [row.id === 'qa-alpha' ? 'qa-active' : 'qa-library'], currentVersionId: `${row.id}-v1`,
    createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z' })),
};

async function showLibraryDrawer(page) {
  const toggle = page.getByRole('button', { name: 'Show Library drawer', exact: true });
  if (await toggle.isVisible()) await toggle.click();
}

for (const viewport of [{ width: 375, height: 812 }, { width: 1440, height: 900 }]) {
  test(`@production signed-in Library navigation and import at ${viewport.width}px`, async ({ page }) => {
    test.setTimeout(150_000);
    page.setDefaultTimeout(15_000);
    const { appUrl, clerkSecretKey, clerkUserId } = readProductionFreeSmokeConfig();
    const clerk = createClerkClient({ secretKey: clerkSecretKey });
    const sessions = await clerk.sessions.getSessionList({ userId: clerkUserId, status: 'active', limit: 100 });
    expect(sessions.data, 'The dedicated QA account must not have an active session.').toHaveLength(0);
    let task;
    let sessionId;
    const blocked = [];
    await page.route('**/*', async route => {
      const category = forbiddenRequestCategory(route.request().url());
      if (category) { blocked.push(category); await route.abort('blockedbyclient'); }
      else await route.continue();
    });
    await page.addInitScript(origin => {
      if (location.origin !== origin) return;
      // Each Playwright test has a fresh, nonpersistent browser context. Seed
      // only an empty store to suppress bundled examples; all records below
      // enter through the real file-import UI, without a fake Pro entitlement.
      if (!localStorage.getItem('__plb_library_qa')) {
        if (localStorage.getItem('pl2-library')) throw new Error('QA context unexpectedly contains Library data.');
        localStorage.setItem('pl2-library', '[]');
        localStorage.setItem('__plb_library_qa', '1');
      }
      localStorage.setItem('pl_telemetry_consent', 'denied');
      localStorage.setItem('pl2-telemetry', JSON.stringify({ telemetryEnabled: false, pendingEvents: [] }));
    }, appUrl.origin);
    const selectFile = data => page.getByLabel('Import Prompt Lab workspace', { exact: true }).setInputFiles({
      name: 'synthetic-library.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)),
    });
    const dialog = page.getByRole('dialog', { name: 'Review Library import' });
    try {
      task = await clerk.agentTasks.create({
        onBehalfOf: { userId: clerkUserId }, permissions: '*', agentName: 'promptlab-production-library',
        taskDescription: 'Verify local Library navigation and synthetic file import/export without inference or purchases.',
        redirectUrl: appUrl.href, sessionMaxDurationInSeconds: 300,
      });
      await page.goto(task.url, { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('tab', { name: 'Library', exact: true })).toBeVisible();
      sessionId = await page.evaluate(() => window.Clerk?.session?.id || '');
      expect(sessionId).toMatch(/^sess_/);
      await page.setViewportSize(viewport);
      await openView(page, 'Library', viewport.width);
      console.info(`[production-library ${viewport.width}] authenticated; importing synthetic workspace`);
      await selectFile(initialWorkspace);
      await dialog.getByRole('button', { name: 'Apply import', exact: true }).click();
      await expect(dialog).toHaveCount(0);
      const list = page.getByRole('list', { name: 'Saved prompts' });
      await expect(list.getByRole('listitem')).toHaveCount(4);
      await expect(list.getByRole('listitem').first()).toContainText('QA Beta');

      // Verify the deployed inspector using only this disposable synthetic profile.
      await page.getByRole('button', { name: 'Inspect QA Alpha', exact: true }).click();
      const details = page.locator('#library-inspector-panel');
      const saveDetails = page.locator('.pl-library-inspector').getByRole('button', { name: 'Save details', exact: true });
      const saveBox = await saveDetails.boundingBox();
      const titleBox = await details.getByLabel('Title', { exact: true }).boundingBox();
      expect(saveBox.y + saveBox.height).toBeLessThanOrEqual(titleBox.y);
      await details.getByLabel('Purpose', { exact: true }).fill('Navigation and inspector placement');
      await details.evaluate(node => { node.scrollTop = node.scrollHeight; });
      expect(await saveDetails.evaluate(node => {
        const action = node.getBoundingClientRect(), panel = node.closest('aside').getBoundingClientRect();
        return action.top >= panel.top - 1 && action.bottom <= panel.bottom + 1;
      })).toBe(true);
      await saveDetails.click();
      await expect(saveDetails).toBeDisabled();
      await page.reload();
      await expect(page.getByTestId('global-new-prompt')).toBeVisible();
      await page.getByRole('button', { name: 'Inspect QA Alpha', exact: true }).click();
      await expect(page.locator('#library-inspector-panel').getByLabel('Purpose', { exact: true })).toHaveValue('Navigation and inspector placement');
      await page.getByRole('button', { name: 'Close prompt inspector', exact: true }).click();
      console.info(`[production-library ${viewport.width}] top Save details, sticky reachability and metadata reload passed`);

      // Artwork acceptance uses only this disposable browser's synthetic Library.
      const artworkTrigger = page.getByRole('button', { name: 'Change artwork for QA Alpha', exact: true });
      for (const view of ['List view', 'Tile view', 'Compact view', 'Gallery view']) {
        await page.getByRole('button', { name: view, exact: true }).click();
        await artworkTrigger.focus(); await artworkTrigger.press('Enter');
        const artworkDialog = page.getByRole('dialog', { name: 'Artwork for QA Alpha', exact: true });
        await artworkDialog.getByLabel('Prompt artwork emoji').fill('👩🏽‍💻');
        await artworkDialog.getByRole('button', { name: 'Apply', exact: true }).click();
        await expect(artworkDialog).toHaveCount(0); await expect(artworkTrigger).toBeFocused();
        expect((await storedState(page)).library.find(row => row.id === 'qa-alpha').metadata.artwork.emoji).toBe('👩🏽‍💻');
        await artworkTrigger.click(); await page.keyboard.press('Escape');
        await expect(artworkDialog).toHaveCount(0); await expect(artworkTrigger).toBeFocused();
      }
      await page.getByRole('button', { name: 'List view', exact: true }).click();
      await page.getByRole('button', { name: 'Change artwork for QA Beta', exact: true }).click();
      const reuseDialog = page.getByRole('dialog', { name: 'Artwork for QA Beta', exact: true });
      await reuseDialog.getByRole('button', { name: 'Pin recent 👩🏽‍💻', exact: true }).click();
      await expect(reuseDialog.getByRole('button', { name: 'Unpin recent 👩🏽‍💻', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await reuseDialog.getByRole('button', { name: 'Use recent 👩🏽‍💻', exact: true }).click();
      await reuseDialog.getByRole('button', { name: 'Apply', exact: true }).click();
      await expect(reuseDialog).toHaveCount(0);
      expect((await storedState(page)).library.find(row => row.id === 'qa-beta').metadata.artwork.emoji).toBe('👩🏽‍💻');
      expect((await storedState(page)).library.find(row => row.id === 'qa-beta').metadata.artwork).not.toHaveProperty('pinned');
      await page.getByRole('button', { name: 'Change artwork for QA Beta', exact: true }).click();
      await reuseDialog.getByRole('button', { name: 'Remove recent 👩🏽‍💻', exact: true }).click();
      await expect(reuseDialog.getByRole('button', { name: 'Use recent 👩🏽‍💻', exact: true })).toHaveCount(0);
      await reuseDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      expect((await storedState(page)).library.find(row => row.id === 'qa-beta').metadata.artwork.emoji).toBe('👩🏽‍💻');
      await openView(page, 'Write', viewport.width);
      const promptsToggle = page.getByRole('button', { name: 'Prompts', exact: true });
      if (await promptsToggle.getAttribute('aria-pressed') !== 'true') await promptsToggle.click();
      const promptPanel = page.getByRole('complementary', { name: 'Prompts beside Write' });
      await promptPanel.getByRole('searchbox', { name: 'Search prompts beside Write' }).fill('avery navigation');
      await expect(promptPanel.getByRole('button', { name: 'Open QA Alpha in Write', exact: true })).toBeVisible();
      await expect(promptPanel.getByRole('button', { name: 'Open QA Beta in Write', exact: true })).toHaveCount(0);
      await expect(promptPanel.getByRole('button', { name: 'Open QA Alpha in Write', exact: true })).toContainText('👩🏽‍💻');
      await promptPanel.getByRole('button', { name: 'Favorites', exact: true }).click();
      await promptPanel.getByRole('button', { name: 'Search All prompts', exact: true }).click();
      await expect(promptPanel.getByRole('searchbox', { name: 'Search prompts beside Write' })).toHaveValue('avery navigation');
      await expect(promptPanel.getByRole('button', { name: 'Open QA Alpha in Write', exact: true })).toBeVisible();
      await promptPanel.getByRole('searchbox', { name: 'Search prompts beside Write' }).fill('unmatched synthetic search');
      await promptPanel.getByRole('button', { name: 'Clear search', exact: true }).click();
      await expect(promptPanel.getByRole('searchbox', { name: 'Search prompts beside Write' })).toBeFocused();
      await expect(promptPanel.getByRole('button', { name: /^Open QA .* in Write$/ })).toHaveCount(4);
      await promptPanel.getByRole('button', { name: 'Close side panel', exact: true }).click();
      await openView(page, 'Library', viewport.width);

      await showLibraryDrawer(page);
      await page.getByRole('button', { name: '#qa-active', exact: true }).click();
      await expect(list.getByRole('listitem')).toHaveCount(1);
      await expect(list).toContainText('QA Alpha');
      await page.getByRole('combobox', { name: 'Filter by status', exact: true }).selectOption('draft');
      await expect(list.getByRole('listitem')).toHaveCount(0);
      await page.getByRole('combobox', { name: 'Filter by status', exact: true }).selectOption('active');
      await openView(page, 'Write', viewport.width);
      await openView(page, 'Library', viewport.width);
      await expect(page.getByRole('combobox', { name: 'Filter by status', exact: true })).toHaveValue('active');
      await expect(list.getByRole('listitem')).toHaveCount(1);
      await expect(list).toContainText('QA Alpha');
      await page.getByRole('button', { name: 'Clear all', exact: true }).click();
      await expect(list.getByRole('listitem')).toHaveCount(4);

      await page.getByTestId('library-search').fill('avery navigation');
      await expect(list.getByRole('listitem')).toHaveCount(1);
      await expect(list).toContainText('QA Alpha');
      await openView(page, 'Compose', viewport.width);
      if (viewport.width < 720) await page.getByRole('tablist', { name: 'Composer views' }).getByRole('tab', { name: /Library/ }).click();
      await page.getByRole('textbox', { name: 'Filter composer library' }).fill('avery navigation');
      await expect(page.getByText('QA Alpha', { exact: true }).filter({ visible: true }).first()).toBeVisible();
      await expect(page.getByText('QA Beta', { exact: true })).toHaveCount(0);
      await openView(page, 'Library', viewport.width);
      await page.getByTestId('library-search').fill('');
      await showLibraryDrawer(page);
      const collectionsGated = isFreeFeatureGated('collections');
      if (collectionsGated) {
        const beforeGate = await storedState(page);
        await page.getByRole('button', { name: 'Collections Pro feature', exact: true }).click();
        const gate = page.getByRole('dialog', { name: 'Collections is a Pro feature', exact: true });
        await expect(gate).toBeVisible();
        await gate.getByRole('button', { name: 'Close billing modal', exact: true }).click();
        expect(await storedState(page)).toEqual(beforeGate);
        if (viewport.width < 720) await page.getByRole('button', { name: 'Close Library drawer', exact: true }).click();
        // Collection names remain searchable on Free; keep the filtered-order
        // assertion without granting the fixture a synthetic Pro entitlement.
        await page.getByTestId('library-search').fill('Ops');
      } else {
        await page.getByRole('button', { name: /^Ops\s*2$/ }).click();
      }
      await page.getByRole('combobox', { name: 'Sort prompts', exact: true }).selectOption('manual');
      await expect(list.getByRole('listitem')).toHaveCount(2);
      const move = page.getByRole('button', { name: 'Move QA Beta up', exact: true });
      await move.focus();
      await move.press('Enter');
      await expect(list.getByRole('listitem').first()).toContainText('QA Beta');
      await expect.poll(async () => (await storedState(page)).library.map(row => row.id)).toEqual(['qa-beta', 'qa-alpha', 'qa-hidden', 'qa-child']);
      if (collectionsGated) {
        await page.getByTestId('library-search').fill('');
        expect((await storedState(page)).library.filter(row => row.collection === 'Ops')).toHaveLength(2);
        console.info(`[production-library ${viewport.width}] Free collection gate verified; folder removal not exercised`);
      } else {
        await showLibraryDrawer(page);
        await page.getByRole('button', { name: 'Manage collections', exact: true }).click();
        await page.getByRole('button', { name: 'Remove folder Ops, keep prompts', exact: true }).click();
        await showLibraryDrawer(page);
        await expect(page.getByRole('button', { name: /^All prompts/ })).toHaveAttribute('aria-current', 'page');
        await expect.poll(async () => (await storedState(page)).library.some(row => row.collection === 'Ops')).toBe(false);
        console.info(`[production-library ${viewport.width}] active collection removal passed`);
      }
      await expect(list.getByRole('listitem')).toHaveCount(4);
      const closeDrawer = page.getByRole('button', { name: 'Close Library drawer', exact: true });
      if (await closeDrawer.isVisible()) await closeDrawer.click();
      console.info(`[production-library ${viewport.width}] shared search, keyboard reorder and current Free collection policy passed`);

      const baseline = await storedState(page);
      const alpha = baseline.library.find(row => row.id === 'qa-alpha');
      const beta = baseline.library.find(row => row.id === 'qa-beta');
      const incoming = {
        product: 'Prompt Lab', schemaVersion: 2,
        library: [
          { ...beta, id: 'qa-duplicate', title: 'QA Duplicate alias', currentVersionId: 'qa-duplicate-v1' },
          { id: 'qa-replacement', title: alpha.title, original: 'QA replacement body', enhanced: 'QA replacement body', currentVersionId: 'qa-replacement-v1' },
          { id: 'qa-keep', title: beta.title, original: 'QA keep both body', enhanced: 'QA keep both body' },
          { id: 'qa-imported-child', title: 'QA Imported child', original: 'QA imported child body', enhanced: 'QA imported child body', metadata: {
            followUpOrigin: { sourceKind: 'run-output', sourcePromptId: 'qa-replacement', sourcePromptVersionId: 'qa-replacement-v1', sourceRunId: 'qa-imported-run', generationProvider: 'fixture', generationModel: 'synthetic' },
          } },
        ],
        runs: [
          { id: 'qa-imported-run', promptId: 'qa-replacement', promptVersionId: 'qa-replacement-v1', testCaseId: 'qa-imported-case', output: 'Synthetic replacement output', status: 'success' },
          { id: 'qa-duplicate-run', promptId: 'qa-duplicate', promptVersionId: 'qa-duplicate-v1', output: 'Synthetic duplicate output', status: 'success' },
        ],
        testCases: [{ id: 'qa-imported-case', promptId: 'qa-replacement', input: 'Synthetic case input' }],
      };
      await selectFile(incoming);
      await expect(dialog.getByRole('heading', { name: 'Review Library import' })).toBeFocused();
      await expect(dialog.getByRole('button', { name: 'Apply import', exact: true })).toBeDisabled();
      await expect(dialog.getByRole('combobox', { name: 'Conflict action for QA Duplicate alias' })).toHaveValue('skip');
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      expect(await storedState(page)).toEqual(baseline);
      await selectFile(incoming);
      await dialog.getByRole('combobox', { name: 'Conflict action for QA Alpha' }).selectOption('replace');
      await dialog.getByRole('combobox', { name: 'Conflict action for QA Beta' }).selectOption('keep');
      await dialog.getByRole('button', { name: 'Apply import', exact: true }).click();
      await expect(dialog).toHaveCount(0);

      const verifyImported = state => {
        expect(state.library).toHaveLength(6);
        const replaced = state.library.find(row => row.id === alpha.id);
        expect(replaced.enhanced).toBe('QA replacement body');
        expect(replaced.versions.some(row => row.enhanced === alpha.enhanced)).toBe(true);
        expect(state.library.find(row => row.id === beta.id)).toEqual(beta);
        const kept = state.library.find(row => row.enhanced === 'QA keep both body');
        expect(kept).toBeDefined();
        expect(kept.id).not.toBe(beta.id);
        expect(state.runs.find(row => row.id === 'qa-imported-run')).toMatchObject({ promptId: alpha.id, promptVersionId: replaced.currentVersionId, testCaseId: 'qa-imported-case' });
        expect(state.runs.find(row => row.id === 'qa-duplicate-run')).toMatchObject({ promptId: beta.id, promptVersionId: beta.currentVersionId });
        expect(state.testCases.find(row => row.id === 'qa-imported-case')?.promptId).toBe(alpha.id);
        expect(state.library.find(row => row.id === 'qa-imported-child')?.metadata.followUpOrigin).toMatchObject({ sourcePromptId: alpha.id, sourcePromptVersionId: replaced.currentVersionId, sourceRunId: 'qa-imported-run' });
      };
      verifyImported(await storedState(page));
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      const download = await downloadFreeWorkspace(page);
      if (download) {
        const bytes = fs.readFileSync(await download.path());
        const exported = JSON.parse(bytes.toString());
        expect(exported.schemaVersion).toBe(2);
        verifyImported(exported);
        console.info(`[production-library ${viewport.width}] actual export SHA256 ${createHash('sha256').update(bytes).digest('hex')}; mapped associations passed`);
      }
      await page.getByRole('button', { name: 'Close settings', exact: true }).click();
      await page.reload({ waitUntil: 'domcontentloaded' });
      await openView(page, 'Library', viewport.width);
      verifyImported(await storedState(page));
      expect(blocked, 'Library operations must not request inference, purchase or telemetry.').toEqual([]);
      console.info(`[production-library ${viewport.width}] reload preserved mapped Library/history/test-case/provenance records`);
    } finally {
      if (sessionId) await clerk.sessions.revokeSession(sessionId);
      else if (task) await clerk.agentTasks.revoke(task.agentTaskId);
      console.info(`[production-library ${viewport.width}] disposable session revoked`);
    }
  });
}
