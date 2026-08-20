import { expect, test } from '@playwright/test';

const viewports = [
  { name: 'mobile-400', width: 400, height: 860 },
  { name: 'mobile-560', width: 560, height: 900 },
  { name: 'tablet-768', width: 768, height: 900 },
  { name: 'desktop-1180', width: 1180, height: 900 },
];

const compactNavigationLabels = ['Write', 'Library', 'Compose', 'Dual', 'Evaluate', 'Scratch'];
const primaryWorkspaceLabels = ['Create', 'Evaluate', 'Scratch'];
const createViewLabels = ['Write', 'Library', 'Compose', 'Dual Pane'];

function browserSeed() {
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  return {
    library: [{
      id: 'desktop-responsive-prompt',
      title: 'Desktop release checklist',
      original: 'Verify the desktop release.',
      enhanced: 'Verify the desktop release and report pass or fail with evidence.',
      variants: [],
      notes: 'Known desktop browser-test fixture.',
      tags: ['qa'],
      collection: 'Operations',
      useCount: 2,
      versions: [],
      testCases: [],
      createdAt: nowIso,
      updatedAt: nowIso,
      metadata: { purpose: 'Verify desktop releases', status: 'active' },
    }],
    scratch: {
      revision: 1,
      activePadId: 'desktop-e2e-note',
      tombstones: {},
      pads: [{
        id: 'desktop-e2e-note',
        name: 'Desktop E2E note',
        content: '# Desktop verification\n\nShared workspace note',
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

async function prepareDesktop(page, viewport) {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  const seed = browserSeed();
  await page.addInitScript((state) => {
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
  await page.goto('/');
}

async function expectNoHorizontalOverflow(page) {
  const overflow = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    body: document.body.scrollWidth - document.body.clientWidth,
  }));
  expect(overflow, 'the desktop document must not create a horizontal page scrollbar').toEqual({ document: 0, body: 0 });
}

async function expectNavigationContract(page, compact) {
  if (compact) {
    const nav = page.getByRole('navigation', { name: 'Primary mobile navigation' });
    await expect(nav).toBeVisible();
    await expect(page.getByRole('tablist', { name: 'Primary workspaces' })).toHaveCount(0);
    await expect(nav.getByRole('button')).toHaveText(compactNavigationLabels);
    return;
  }

  await expect(page.getByRole('navigation', { name: 'Primary mobile navigation' })).toHaveCount(0);
  await expect(page.getByRole('tablist', { name: 'Primary workspaces' }).getByRole('tab')).toHaveText(primaryWorkspaceLabels);
  await expect(page.getByRole('tablist', { name: 'Create views' }).getByRole('tab')).toHaveText(createViewLabels);
}

async function openWorkspace(page, label, compact) {
  if (compact) {
    await page.getByRole('navigation', { name: 'Primary mobile navigation' })
      .getByRole('button', { name: label === 'Dual Pane' ? 'Dual' : label, exact: true })
      .click();
    return;
  }

  if (label === 'Scratch') {
    await page.getByRole('tablist', { name: 'Primary workspaces' })
      .getByRole('tab', { name: 'Scratch', exact: true })
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
  test(`desktop shared shell is responsive at ${viewport.width}px`, async ({ page }) => {
    const compact = viewport.width < 720;
    const scratchCompact = viewport.width <= 560;
    await prepareDesktop(page, viewport);

    await expect(page.getByTestId('prompt-input')).toBeVisible();
    await expect(page.getByRole('banner').getByText('1 saved', { exact: true })).toBeVisible();
    await expectNavigationContract(page, compact);
    await expectNoHorizontalOverflow(page);

    await openWorkspace(page, 'Library', compact);
    await expect(page.getByRole('complementary', { name: 'Library views' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Prompt index' })).toBeVisible();
    await expect(page.getByRole('list', { name: 'Saved prompts' })).toContainText('Desktop release checklist');
    await expectNoHorizontalOverflow(page);

    await openWorkspace(page, 'Scratch', compact);
    const noteIndex = page.getByRole('complementary', { name: 'Scratch note index' });
    await expect(noteIndex).toBeVisible();
    if (scratchCompact) await noteIndex.getByRole('button', { name: /Desktop E2E note/ }).click();
    await expect(page.getByRole('textbox', { name: 'Scratchpad' })).toHaveValue(/Shared workspace note/);
    await page.getByRole('tablist', { name: 'Scratch editor view' }).getByRole('tab', { name: 'Split' }).click();
    await expect(page.getByLabel('Live Markdown preview')).toContainText('Desktop verification');
    await expectNoHorizontalOverflow(page);

    await openWorkspace(page, 'Dual Pane', compact);
    await expect(page.getByRole('listbox', { name: 'Library prompts' })).toBeVisible();
    await expect(page.getByTestId('dual-selected-preview')).toContainText('Desktop release checklist');
    if (compact) {
      await page.getByRole('tablist', { name: 'Dual pane mobile view' }).getByRole('tab', { name: 'Write' }).click();
    } else {
      const separator = page.getByRole('separator', { name: 'Resize dual panes' });
      const valueBefore = Number(await separator.getAttribute('aria-valuenow'));
      await separator.focus();
      await separator.press('ArrowRight');
      await expect(separator).toHaveAttribute('aria-valuenow', String(valueBefore + 4));
    }
    await expect(page.getByRole('textbox', { name: 'Dual pane prompt editor' })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    if (viewport.width === 1180) {
      const shortcutTrigger = page.getByRole('button', { name: 'Keyboard shortcuts' });
      await shortcutTrigger.focus();
      await shortcutTrigger.click();
      const dialog = page.getByRole('dialog', { name: 'Keyboard Shortcuts' });
      await expect(dialog).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(shortcutTrigger).toBeFocused();
    }
  });
}
