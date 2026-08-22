import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect, test } from '@playwright/test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.resolve(__dirname, '..', 'dist');

const viewports = [
  { name: 'mobile-400', width: 400, height: 860 },
  { name: 'mobile-560', width: 560, height: 900 },
  { name: 'tablet-768', width: 768, height: 900 },
  { name: 'desktop-1180', width: 1180, height: 900 },
];

const compactNavigationLabels = ['Write', 'Library', 'Compose', 'Dual', 'Evaluate', 'Scratch'];
const primaryWorkspaceLabels = ['Create', 'Evaluate', 'Scratch'];
const createViewLabels = ['Write', 'Library', 'Compose', 'Dual Pane'];

const providerResponse = {
  enhanced: [
    'You are a release verification assistant.',
    'Verify the release evidence and report an explicit pass or fail for each required surface.',
    'Audience: release engineers.',
  ].join('\n\n'),
  variants: [
    { label: 'Tighter', content: 'Verify every required release surface and report pass or fail with evidence.' },
    { label: 'Strict JSON', content: '{"task":"verify release","output":"pass-or-fail evidence by surface"}' },
  ],
  notes: 'Mocked provider response for responsive browser verification.',
  change_summary: 'Added a role, a concrete outcome, and an explicit audience.',
  changes: [
    { type: 'added', label: 'Added the release verification role.' },
    { type: 'changed', label: 'Made the expected verdict explicit.' },
  ],
  assumptions: [
    { text: 'The prompt is intended for release engineers.', added_text: 'Audience: release engineers.' },
  ],
  reversible_edits: [
    {
      candidate_id: 'improved',
      label: 'Audience constraint',
      operation: 'add',
      before: '',
      after: 'Audience: release engineers.',
    },
  ],
  reasoning: 'The rewritten prompt is easier to test because its role, scope, and output contract are explicit.',
  tags: ['qa', 'release'],
};

function seededState() {
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  return {
    library: [{
      id: 'responsive-prompt',
      title: 'Release verification checklist',
      original: 'Verify the release.',
      enhanced: 'Verify release evidence and report pass or fail.',
      variants: [],
      notes: 'Known browser-test fixture.',
      tags: ['qa'],
      collection: 'Operations',
      useCount: 3,
      versions: [],
      testCases: [],
      createdAt: nowIso,
      updatedAt: nowIso,
      metadata: { purpose: 'Verify releases', status: 'active' },
    }],
    scratch: {
      revision: 1,
      activePadId: 'e2e-note',
      tombstones: {},
      pads: [{
        id: 'e2e-note',
        name: 'E2E scratch note',
        content: '# Verification\n\nCross-surface note',
        createdAt: now,
        updatedAt: now,
        timestamp: now,
        pinned: true,
        status: 'working',
        color: 'orange',
        tags: ['qa'],
        linkedPrompts: [],
      }],
    },
  };
}

async function seedLocalState(context) {
  const seed = seededState();
  await context.addInitScript((state) => {
    localStorage.setItem('pl2-telemetry', JSON.stringify({ consent: 'denied' }));
    localStorage.setItem('pl_telemetry_consent', 'denied');
    localStorage.setItem('pl2-billing', JSON.stringify({
      plan: 'pro',
      status: 'active',
      productName: 'Prompt Lab Pro',
    }));
    localStorage.setItem('pl2-library', JSON.stringify(state.library));
    localStorage.setItem('pl2-collections', JSON.stringify(['Operations']));
    localStorage.setItem('pl2-pads-schema-version', '4');
    localStorage.setItem('pl2-pads', JSON.stringify(state.scratch));
  }, seed);
}

async function launchMockedExtension(viewport) {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), `prompt-lab-${viewport.name}-`));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: true,
    timeout: 15_000,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

  await seedLocalState(context);
  let serviceWorker = context.serviceWorkers()[0];
  if (!serviceWorker) serviceWorker = await context.waitForEvent('serviceworker', { timeout: 15_000 });
  const extensionId = new URL(serviceWorker.url()).host;
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  await page.setViewportSize({ width: viewport.width, height: viewport.height });

  await page.goto(`chrome-extension://${extensionId}/panel.html`, { timeout: 15_000 });
  await page.evaluate((response) => {
    const originalSendMessage = chrome.runtime.sendMessage.bind(chrome.runtime);
    window.__promptLabRequests = [];
    chrome.runtime.sendMessage = (message, callback) => {
      window.__promptLabRequests.push(message);
      if (message?.type === 'MODEL_REQUEST') {
        const payload = {
          content: [{ type: 'text', text: JSON.stringify(response) }],
          provider: 'mock-provider',
          model: message.payload?.model || 'mock-model',
          usage: { input: 42, output: 24, total: 66 },
        };
        setTimeout(() => callback?.({ data: payload }), 0);
        return;
      }
      return originalSendMessage(message, callback);
    };
  }, providerResponse);

  return {
    context,
    page,
    async cleanup() {
      await context.close();
      fs.rmSync(userDataDir, { recursive: true, force: true });
    },
  };
}

async function expectNoHorizontalOverflow(page) {
  const overflow = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    body: document.body.scrollWidth - document.body.clientWidth,
  }));
  expect(overflow, 'the document must not create a horizontal page scrollbar').toEqual({ document: 0, body: 0 });
}

function libraryCountLabel(page) {
  return page.getByRole('banner').getByText(/^\d+ saved$/);
}

async function expectNavigationContract(page, compact) {
  if (compact) {
    const nav = page.getByRole('navigation', { name: 'Primary mobile navigation' });
    await expect(nav).toBeVisible();
    await expect(page.getByRole('tablist', { name: 'Primary workspaces' })).toHaveCount(0);
    await expect(nav.getByRole('button')).toHaveText(compactNavigationLabels);
    expect(await page.evaluate(() => {
      const main = document.querySelector('#prompt-lab-main');
      const nav = document.querySelector('[aria-label="Primary mobile navigation"]');
      return Boolean(main && nav && (main.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING));
    }), 'compact navigation should follow the main workspace in DOM order').toBe(true);
    return;
  }

  await expect(page.getByRole('navigation', { name: 'Primary mobile navigation' })).toHaveCount(0);
  const primary = page.getByRole('tablist', { name: 'Primary workspaces' });
  const createViews = page.getByRole('tablist', { name: 'Create views' });
  await expect(primary.getByRole('tab')).toHaveText(primaryWorkspaceLabels);
  await expect(createViews.getByRole('tab')).toHaveText(createViewLabels);
}

async function openWorkspace(page, label, compact) {
  if (compact) {
    await page.getByRole('navigation', { name: 'Primary mobile navigation' })
      .getByRole('button', { name: label === 'Dual Pane' ? 'Dual' : label, exact: true })
      .click();
    return;
  }

  if (['Evaluate', 'Scratch'].includes(label)) {
    await page.getByRole('tablist', { name: 'Primary workspaces' })
      .getByRole('tab', { name: label, exact: true })
      .click();
    return;
  }

  await page.getByRole('tablist', { name: 'Primary workspaces' })
    .getByRole('tab', { name: 'Create', exact: true })
    .click();
  await page.getByRole('tablist', { name: 'Create views' })
    .getByRole('tab', { name: label, exact: true })
    .click();
}

for (const viewport of viewports) {
  test(`shared workspaces remain usable at ${viewport.width}px`, async () => {
    const compact = viewport.width < 720;
    const scratchCompact = viewport.width <= 560;
    const { page, cleanup } = await test.step('launch mocked extension', () => launchMockedExtension(viewport));
    try {
      await test.step('verify navigation shape, order, and page fit', async () => {
        await expect(page.getByTestId('prompt-input')).toBeVisible();
        await expect(page.getByTestId('refine-action')).toBeVisible();
        await expect(libraryCountLabel(page)).toHaveText('1 saved');
        await expectNavigationContract(page, compact);
        await expectNoHorizontalOverflow(page);
      });

      await test.step('enhance and inspect the post-enhance workspace', async () => {
        await page.getByTestId('prompt-input').fill(`Responsive prompt for ${viewport.name}`);
        await page.getByTestId('refine-action').click();
        await expect.poll(() => page.evaluate(() => window.__promptLabRequests.length)).toBe(1);

        const output = page.getByTestId('output-panel');
        await expect(output).toBeVisible({ timeout: 15_000 });
        const candidates = output.getByRole('listbox', { name: 'Enhancement candidates' });
        await expect(candidates.getByRole('option')).toHaveCount(3);
        await expect(candidates.getByRole('option').nth(0)).toContainText('Improved');
        await expect(candidates.getByRole('option').nth(1)).toContainText('Tighter');
        await expect(candidates.getByRole('option').nth(2)).toContainText('Strict JSON');

        const improved = candidates.getByRole('option').nth(0);
        await improved.focus();
        await improved.press('ArrowDown');
        await expect(candidates.getByRole('option').nth(1)).toHaveAttribute('aria-selected', 'true');
        await expect(output.getByRole('tablist', { name: 'Result views' }).getByRole('tab', { name: 'Improved' })).toBeVisible();

        const originalToggle = output.getByRole('button', { name: /Original prompt/ });
        await originalToggle.click();
        await expect(originalToggle).toHaveAttribute('aria-expanded', 'true');
        await output.getByRole('tablist', { name: 'Result views' }).getByRole('tab', { name: 'Changes' }).click();
        await expect(output.getByRole('tabpanel')).toContainText('Added the release verification role.');
        await expectNoHorizontalOverflow(page);
      });

      await test.step('save with an explicit receipt and locate prompts in Library', async () => {
        await page.getByTestId('save-to-library').last().click();
        const receipt = page.getByRole('region', { name: /Saved “.+” · version 1/ });
        await expect(receipt.getByRole('status')).toHaveText(/Saved “.+” · version 1/);
        await expect(receipt.getByRole('button', { name: 'View in Library' })).toBeVisible();
        await expect(receipt.getByRole('button', { name: 'New prompt' })).toBeVisible();
        await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('pl2-library') || '[]').length)).toBe(2);

        await receipt.getByRole('button', { name: 'View in Library' }).click();
        await expect(page.getByRole('complementary', { name: 'Library views' })).toBeVisible();
        await expect(page.getByRole('region', { name: 'Prompt index' })).toBeVisible();
        await page.getByTestId('library-search').fill('Release verification checklist');
        await expect(page.getByRole('list', { name: 'Saved prompts' })).toContainText('Release verification checklist');
        await expectNoHorizontalOverflow(page);
      });

      await test.step('use the responsive Scratch workspace', async () => {
        await openWorkspace(page, 'Scratch', compact);
        const noteIndex = page.getByRole('complementary', { name: 'Scratch note index' });
        await expect(noteIndex).toBeVisible();
        if (scratchCompact) {
          await noteIndex.getByRole('button', { name: /E2E scratch note/ }).click();
        }
        await expect(page.getByRole('region', { name: 'Scratch note workspace' })).toBeVisible();
        await expect(page.getByRole('textbox', { name: 'Scratchpad' })).toHaveValue(/Cross-surface note/);
        await page.getByRole('tablist', { name: 'Scratch editor view' }).getByRole('tab', { name: 'Split' }).click();
        await expect(page.getByLabel('Live Markdown preview')).toContainText('Verification');
        await expectNoHorizontalOverflow(page);
      });

      await test.step('use Dual Pane at the current breakpoint', async () => {
        await openWorkspace(page, 'Dual Pane', compact);
        const promptList = page.getByRole('listbox', { name: 'Library prompts' });
        await expect(promptList).toBeVisible();
        await expect(promptList.getByRole('option', { name: /Release verification checklist/ })).toBeVisible();
        await expect(page.getByTestId('dual-selected-preview')).toContainText('Release verification assistant');

        if (compact) {
          const mobileViews = page.getByRole('tablist', { name: 'Dual pane mobile view' });
          await expect(mobileViews).toBeVisible();
          await mobileViews.getByRole('tab', { name: 'Write' }).click();
          await expect(page.getByRole('textbox', { name: 'Dual pane prompt editor' })).toBeVisible();
        } else {
          await expect(page.getByRole('tablist', { name: 'Dual pane mobile view' })).toBeHidden();
          await expect(page.getByRole('textbox', { name: 'Dual pane prompt editor' })).toBeVisible();
          const separator = page.getByRole('separator', { name: 'Resize dual panes' });
          const valueBefore = Number(await separator.getAttribute('aria-valuenow'));
          await separator.focus();
          await separator.press('ArrowRight');
          await expect(separator).toHaveAttribute('aria-valuenow', String(valueBefore + 4));
        }
        await expectNoHorizontalOverflow(page);
      });
    } finally {
      await cleanup();
    }
  });
}

test('wide navigation and modal keyboard behavior remains accessible', async () => {
  const viewport = viewports.find(({ width }) => width === 1180);
  const { page, cleanup } = await launchMockedExtension(viewport);
  try {
    const primary = page.getByRole('tablist', { name: 'Primary workspaces' });
    const createTab = primary.getByRole('tab', { name: 'Create' });
    await createTab.focus();
    await createTab.press('ArrowRight');
    await expect(primary.getByRole('tab', { name: 'Evaluate' })).toHaveAttribute('aria-selected', 'true');
    await expect(primary.getByRole('tab', { name: 'Evaluate' })).toBeFocused();

    await primary.getByRole('tab', { name: 'Create' }).click();
    const shortcutTrigger = page.getByRole('button', { name: 'Keyboard shortcuts' });
    await shortcutTrigger.focus();
    await shortcutTrigger.click();
    const shortcuts = page.getByRole('dialog', { name: 'Keyboard Shortcuts' });
    await expect(shortcuts).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(shortcuts).toBeHidden();
    await expect(shortcutTrigger).toBeFocused();

    const paletteTrigger = page.getByRole('button', { name: '⌘K', exact: true });
    await paletteTrigger.focus();
    await paletteTrigger.click();
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    const search = palette.getByRole('textbox', { name: 'Search commands' });
    await expect(search).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(palette).toBeHidden();
    await expect(paletteTrigger).toBeFocused();
    await expectNoHorizontalOverflow(page);
  } finally {
    await cleanup();
  }
});
