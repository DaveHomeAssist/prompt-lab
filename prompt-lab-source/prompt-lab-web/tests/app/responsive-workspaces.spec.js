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

const providerPayload = {
  enhanced: 'You are a release verification assistant.\n\nVerify every required surface and report pass or fail with evidence.\n\nAudience: release engineers.',
  variants: [
    { label: 'Tighter', content: 'Verify each release surface and report pass or fail with evidence.' },
    { label: 'Strict JSON', content: '{"task":"verify release","output":"surface verdicts with evidence"}' },
  ],
  notes: 'Mocked hosted response for cross-surface browser verification.',
  change_summary: 'Added a role, a concrete outcome, and an explicit audience.',
  changes: [
    { type: 'added', label: 'Added a verification role.' },
    { type: 'changed', label: 'Made the expected verdict explicit.' },
  ],
  assumptions: [
    { text: 'The prompt is intended for release engineers.', added_text: 'Audience: release engineers.' },
  ],
  reversible_edits: [{
    candidate_id: 'improved',
    label: 'Audience constraint',
    operation: 'add',
    before: '',
    after: 'Audience: release engineers.',
  }],
  reasoning: 'The rewrite is easier to evaluate because the scope and output contract are explicit.',
  tags: ['hosted', 'qa'],
};

function browserSeed() {
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

async function seedLocalState(page) {
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
}

async function mockHostedProxy(page) {
  const requests = [];
  await page.route('**/api/proxy', async (route) => {
    requests.push(route.request().postDataJSON());
    const text = JSON.stringify(providerPayload);
    const body = [
      `data: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text } })}`,
      `data: ${JSON.stringify({ type: 'message_stop' })}`,
      '',
    ].join('\n\n');
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream; charset=utf-8',
      headers: {
        'x-ratelimit-store': 'kv',
        'x-demo-remaining': '2',
      },
      body,
    });
  });
  return requests;
}

async function prepareWorkspace(page, viewport) {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await seedLocalState(page);
  const requests = await mockHostedProxy(page);
  await page.goto('/app/');
  return requests;
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

test.describe('responsive hosted workspaces', () => {
  test.describe.configure({ timeout: 60_000 });

  for (const viewport of viewports) {
    test(`Create, Library, Scratch, and Dual work at ${viewport.width}px`, async ({ page }) => {
      const compact = viewport.width < 720;
      const scratchCompact = viewport.width <= 560;
      const requests = await prepareWorkspace(page, viewport);

      await test.step('verify responsive navigation and initial fit', async () => {
        await expect(page.getByTestId('prompt-input')).toBeVisible();
        await expect(libraryCountLabel(page)).toHaveText('1 saved');
        await expectNavigationContract(page, compact);
        await expectNoHorizontalOverflow(page);
      });

      await test.step('run hosted enhance and inspect candidate controls', async () => {
        await page.getByTestId('prompt-input').fill(`Hosted responsive prompt for ${viewport.name}`);
        await page.getByTestId('refine-action').click();
        await expect.poll(() => requests.length).toBe(1);

        const output = page.getByTestId('output-panel');
        await expect(output).toBeVisible();
        const candidates = output.getByRole('listbox', { name: 'Enhancement candidates' });
        await expect(candidates.getByRole('option')).toHaveCount(3);
        await candidates.getByRole('option').nth(0).focus();
        await candidates.getByRole('option').nth(0).press('ArrowDown');
        await expect(candidates.getByRole('option').nth(1)).toHaveAttribute('aria-selected', 'true');
        await output.getByRole('button', { name: /Original prompt/ }).click();
        await output.getByRole('tablist', { name: 'Result views' }).getByRole('tab', { name: 'Changes' }).click();
        await expect(output.getByRole('tabpanel')).toContainText('Added a verification role.');
        await expectNoHorizontalOverflow(page);
      });

      await test.step('save and find both browser fixtures in Library', async () => {
        await page.getByTestId('save-to-library').last().click();
        const receipt = page.getByRole('region', { name: /Saved “.+” · version 1/ });
        await expect(receipt.getByRole('status')).toHaveText(/Saved “.+” · version 1/);
        await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('pl2-library') || '[]').length)).toBe(2);
        await receipt.getByRole('button', { name: 'View in Library' }).click();

        await expect(page.getByRole('complementary', { name: 'Library views' })).toBeVisible();
        await expect(page.getByRole('region', { name: 'Prompt index' })).toBeVisible();
        await page.getByTestId('library-search').fill('Release verification checklist');
        await expect(page.getByRole('list', { name: 'Saved prompts' })).toContainText('Release verification checklist');
        await expectNoHorizontalOverflow(page);
      });

      await test.step('open the seeded Scratch note and split preview', async () => {
        await openWorkspace(page, 'Scratch', compact);
        const noteIndex = page.getByRole('complementary', { name: 'Scratch note index' });
        await expect(noteIndex).toBeVisible();
        if (scratchCompact) await noteIndex.getByRole('button', { name: /E2E scratch note/ }).click();
        await expect(page.getByRole('region', { name: 'Scratch note workspace' })).toBeVisible();
        await expect(page.getByRole('textbox', { name: 'Scratchpad' })).toHaveValue(/Cross-surface note/);
        await page.getByRole('tablist', { name: 'Scratch editor view' }).getByRole('tab', { name: 'Split' }).click();
        await expect(page.getByLabel('Live Markdown preview')).toContainText('Verification');
        await expectNoHorizontalOverflow(page);
      });

      await test.step('open Dual Pane and exercise its responsive control', async () => {
        await openWorkspace(page, 'Dual Pane', compact);
        const promptList = page.getByRole('listbox', { name: 'Library prompts' });
        await expect(promptList).toBeVisible();
        await expect(promptList.getByRole('option', { name: /Release verification checklist/ })).toBeVisible();
        await expect(page.getByTestId('dual-selected-preview')).toContainText('Release verification assistant');
        if (compact) {
          await page.getByRole('tablist', { name: 'Dual pane mobile view' }).getByRole('tab', { name: 'Write' }).click();
          await expect(page.getByRole('textbox', { name: 'Dual pane prompt editor' })).toBeVisible();
        } else {
          await expect(page.getByRole('textbox', { name: 'Dual pane prompt editor' })).toBeVisible();
          const separator = page.getByRole('separator', { name: 'Resize dual panes' });
          const valueBefore = Number(await separator.getAttribute('aria-valuenow'));
          await separator.focus();
          await separator.press('ArrowRight');
          await expect(separator).toHaveAttribute('aria-valuenow', String(valueBefore + 4));
        }
        await expectNoHorizontalOverflow(page);
      });
    });
  }
});

test('hosted wide shell preserves tab and modal keyboard behavior', async ({ page }) => {
  await prepareWorkspace(page, viewports.find(({ width }) => width === 1180));

  const primary = page.getByRole('tablist', { name: 'Primary workspaces' });
  const createTab = primary.getByRole('tab', { name: 'Create' });
  await createTab.focus();
  await createTab.press('ArrowRight');
  await expect(primary.getByRole('tab', { name: 'Evaluate' })).toBeFocused();
  await expect(primary.getByRole('tab', { name: 'Evaluate' })).toHaveAttribute('aria-selected', 'true');

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
  await expect(palette.getByRole('textbox', { name: 'Search commands' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(palette).toBeHidden();
  await expect(paletteTrigger).toBeFocused();
  await expectNoHorizontalOverflow(page);
});
