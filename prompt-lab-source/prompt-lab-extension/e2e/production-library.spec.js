import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { createClerkClient } from '@clerk/backend';
import { expect, test } from '@playwright/test';
import { forbiddenRequestCategory, readProductionFreeSmokeConfig } from './production-auth.mjs';

test.use({ serviceWorkers: 'block', acceptDownloads: true });

async function openView(page, name, width) {
  if (width < 720) await page.getByRole('navigation', { name: 'Primary mobile navigation' }).getByRole('button', { name, exact: true }).click();
  else await page.getByRole('tablist', { name: 'Create views' }).getByRole('tab', { name, exact: true }).click();
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
    { id: 'qa-alpha', title: 'QA Alpha', collection: 'Ops', metadata: { owner: 'Avery', purpose: 'Navigation' } },
    { id: 'qa-hidden', title: 'QA Hidden', collection: 'Other' },
    { id: 'qa-beta', title: 'QA Beta', collection: 'Ops', metadata: { packLoadedAt: '2026-09-05T00:00:00Z' } },
    { id: 'qa-child', title: 'QA Child', collection: '' },
  ].map(row => ({ ...row, original: `${row.title} instructions`, enhanced: `${row.title} improved`,
    tags: ['qa-library'], currentVersionId: `${row.id}-v1`,
    createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z' })),
};

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
      await page.getByRole('button', { name: /^Ops\s*2$/ }).click();
      await page.getByRole('combobox', { name: 'Sort prompts', exact: true }).selectOption('manual');
      await expect(list.getByRole('listitem')).toHaveCount(2);
      const move = page.getByRole('button', { name: 'Move QA Beta up', exact: true });
      await move.focus();
      await move.press('Enter');
      await expect(list.getByRole('listitem').first()).toContainText('QA Beta');
      expect((await storedState(page)).library.map(row => row.id)).toEqual(['qa-beta', 'qa-alpha', 'qa-hidden', 'qa-child']);
      await page.getByRole('button', { name: 'Manage collections', exact: true }).click();
      await page.getByRole('button', { name: 'Delete collection Ops', exact: true }).click();
      await expect(list.getByRole('listitem')).toHaveCount(4);
      await expect(page.getByRole('button', { name: /^All prompts/ })).toHaveAttribute('aria-current', 'page');
      expect((await storedState(page)).library.some(row => row.collection === 'Ops')).toBe(false);
      console.info(`[production-library ${viewport.width}] shared search, keyboard reorder and collection cleanup passed`);

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
        expect(state.library.find(row => row.enhanced === 'QA keep both body')?.id).not.toBe(beta.id);
        expect(state.runs.find(row => row.id === 'qa-imported-run')).toMatchObject({ promptId: alpha.id, promptVersionId: replaced.currentVersionId, testCaseId: 'qa-imported-case' });
        expect(state.runs.find(row => row.id === 'qa-duplicate-run')).toMatchObject({ promptId: beta.id, promptVersionId: beta.currentVersionId });
        expect(state.testCases.find(row => row.id === 'qa-imported-case')?.promptId).toBe(alpha.id);
        expect(state.library.find(row => row.id === 'qa-imported-child')?.metadata.followUpOrigin).toMatchObject({ sourcePromptId: alpha.id, sourcePromptVersionId: replaced.currentVersionId, sourceRunId: 'qa-imported-run' });
      };
      verifyImported(await storedState(page));
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      const downloadPromise = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Export Library', exact: true }).click();
      const download = await downloadPromise;
      const bytes = fs.readFileSync(await download.path());
      const exported = JSON.parse(bytes.toString());
      expect(exported.schemaVersion).toBe(2);
      verifyImported(exported);
      console.info(`[production-library ${viewport.width}] actual export SHA256 ${createHash('sha256').update(bytes).digest('hex')}; cancel, Skip/Replace/Keep both and mapped associations passed`);
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
