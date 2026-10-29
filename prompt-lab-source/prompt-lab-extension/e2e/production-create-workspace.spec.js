import { createClerkClient } from '@clerk/backend';
import { expect, test as base } from '@playwright/test';
import { forbiddenRequestCategory, readProductionFreeSmokeConfig } from './production-auth.mjs';
import { switchTheme } from '../../prompt-lab-web/tests/app/theme-toggle.js';

const source = 'Write a launch brief.';
const expanded = 'Write a launch brief with three measured outcomes. Assume an experienced audience.';
const rebuilt = 'Plan a launch brief with a named owner and three measurable acceptance criteria.';
const resultMeta = {
  schemaVersion: 2, primaryId: 'expanded', selectedCandidateId: 'expanded',
  candidates: [{ id: 'expanded', content: expanded }, { id: 'rebuilt', content: rebuilt }],
  changes: [{ id: 'scope', label: 'Added measurable output criteria', candidateId: 'expanded' }],
  assumptions: [{ id: 'audience', text: 'The audience is experienced.', addedText: ' Assume an experienced audience.', candidateId: 'expanded' }],
  reasoning: 'Added measurable output criteria and clarified the assumed audience.',
};

// Explicit dispatch only: this acceptance slice adds no scheduled workload.
const test = base.extend({
  qa: [async ({ page }, use) => {
    const config = readProductionFreeSmokeConfig();
    const clerk = createClerkClient({ secretKey: config.clerkSecretKey });
    const owned = { config, clerk, task: null, sessionId: null, mode: 'success', calls: [], blocked: [] };
    try { await use(owned); }
    finally {
      await page.unrouteAll({ behavior: 'ignoreErrors' });
      if (owned.sessionId) {
        await clerk.sessions.revokeSession(owned.sessionId);
        await expect.poll(async () => (await clerk.sessions.getSession(owned.sessionId)).status).toBe('revoked');
        console.info('[Create acceptance] disposable session revocation verified');
      } else if (owned.task) await clerk.agentTasks.revoke(owned.task.agentTaskId);
    }
  }, { timeout: 30_000 }],
});
test.use({ serviceWorkers: 'block' });
test.skip(process.env.PROMPTLAB_CREATE_WORKSPACE_SMOKE !== 'true', 'Explicit Create acceptance dispatch only');

async function authenticate(page, qa, seeded = true) {
  const { config, clerk } = qa;
  page.setDefaultTimeout(15_000);
  page.setDefaultNavigationTimeout(30_000);
  expect((await clerk.sessions.getSessionList({ userId: config.clerkUserId, status: 'active', limit: 100 })).data.length).toBe(0);
  await page.addInitScript(({ origin, source, expanded, resultMeta, seeded }) => {
    if (location.origin !== origin) return;
    if (!localStorage.getItem('__createAcceptance')) {
      localStorage.setItem('__createAcceptance', '1');
      localStorage.setItem('pl2-library', '[]');
      localStorage.setItem('pl2-create-layout', JSON.stringify('split'));
      localStorage.setItem('pl2-session-pl2-session', JSON.stringify({ raw: source, enhanced: seeded ? expanded : '', resultMeta: seeded ? resultMeta : null, variants: [], tab: 'editor' }));
    }
    localStorage.setItem('pl_telemetry_consent', 'denied');
    localStorage.setItem('pl2-telemetry', JSON.stringify({ telemetryEnabled: false, pendingEvents: [] }));
  }, { origin: config.appUrl.origin, source, expanded, resultMeta, seeded });
  await page.route('**/*', async route => {
    const request = route.request();
    if (request.url() === `${config.appUrl.origin}/api/proxy` && request.method() === 'POST') {
      qa.calls.push(qa.mode);
      const payload = JSON.parse(request.postDataJSON().body);
      if (qa.mode === 'cancel') return; // Held until the real Cancel action aborts it.
      const frame = data => `data: ${JSON.stringify(data)}\n\n`;
      const output = JSON.stringify({ title: 'Synthetic launch brief', enhanced: expanded, changes: ['Added measurable output criteria'], reasoning: resultMeta.reasoning, variants: [] });
      if (qa.mode === 'partial') {
        expect(payload.stream).toBe(true);
        await route.fulfill({ status: 200, contentType: 'text/event-stream', body: frame({ type: 'content_block_delta', delta: { text: 'Synthetic partial output retained for recovery.' } }) + frame({ type: 'error', error: { type: 'invalid_request_error', message: 'Synthetic interrupted stream' } }) });
      } else if (payload.stream) {
        await route.fulfill({ status: 200, contentType: 'text/event-stream', body: frame({ type: 'content_block_delta', delta: { text: output } }) + frame({ type: 'message_stop' }) });
      } else await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ type: 'text', text: output }] }) });
      return;
    }
    const category = forbiddenRequestCategory(request.url());
    if (category) { qa.blocked.push(category); await route.abort('blockedbyclient'); }
    else await route.continue();
  });
  qa.task = await clerk.agentTasks.create({ onBehalfOf: { userId: config.clerkUserId }, permissions: '*', agentName: 'promptlab-create-acceptance', taskDescription: 'Verify the approved hosted Create workspace with synthetic local fixtures and intercepted responses only; no model or billing calls.', redirectUrl: config.appUrl.href, sessionMaxDurationInSeconds: 600 });
  await page.goto(qa.task.url, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.pl-create-split')).toBeVisible();
  qa.sessionId = await page.evaluate(() => window.Clerk?.session?.id || '');
  expect(qa.sessionId).toMatch(/^sess_/);
}

async function pane(page, name) {
  // Clerk remounts the signed-in shell after reload; isVisible alone does not wait.
  await expect(page.locator('.pl-create-split')).toBeVisible();
  const control = page.getByRole('group', { name: 'Workspace pane' }).getByRole('button', { name, exact: true });
  if (await control.isVisible()) await control.click();
}
const library = page => page.evaluate(() => JSON.parse(localStorage.getItem('pl2-library') || '[]'));
const session = page => page.evaluate(() => JSON.parse(localStorage.getItem('pl2-session-pl2-session') || '{}'));

for (const width of [1440, 375]) {
  test(`@production Dual Pane shortcut saves the current draft and version at ${width}`, async ({ page, qa }) => {
    await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
    await authenticate(page, qa);
    await page.evaluate(() => { location.hash = '/split/write'; });
    const editor = page.getByLabel('Dual pane prompt editor');
    const firstBody = 'Production shortcut fixture. Preserve this current draft in Library.';
    await editor.fill(firstBody);
    await expect(page.locator('.pl-dual-autosave-status')).toHaveText('Draft saved');
    expect(await library(page)).toEqual([]);
    await editor.press('Control+s');
    await expect.poll(async () => (await library(page))[0]?.enhanced).toBe(firstBody);
    const first = (await library(page))[0];
    const updatedBody = `${firstBody} Retain the same identity when adding a version.`;
    await editor.fill(updatedBody);
    await expect(page.locator('.pl-dual-autosave-status')).toHaveText('Draft saved');
    expect((await library(page))[0]).toEqual(first);
    await editor.press('Control+s');
    await expect.poll(async () => (await library(page))[0]?.enhanced).toBe(updatedBody);
    const updated = (await library(page))[0];
    expect(await library(page)).toHaveLength(1);
    expect(updated.id).toBe(first.id);
    expect(updated.versions).toHaveLength(first.versions.length + 1);
    await expect(page.getByRole('region', { name: 'Editing context' })).toContainText('No unsaved changes');
    await expect.poll(async () => (await session(page)).editingVersionId).toBe(updated.currentVersionId);
    await page.reload();
    await expect(editor).toHaveValue(updatedBody);
    expect((await library(page))[0]).toMatchObject({ id: first.id, enhanced: updatedBody, currentVersionId: updated.currentVersionId });
    expect(qa.calls).toEqual([]);
    expect(qa.blocked).toEqual([]);
    console.info(`[Save acceptance] ${width}px draft acknowledgement, shortcut new/version save, same identity, accurate feedback and reload passed`);
  });
}

async function reachable(locator) {
  await locator.scrollIntoViewIfNeeded();
  return locator.evaluate(element => {
    const r = element.getBoundingClientRect();
    const x = r.x + r.width / 2, y = r.y + r.height / 2;
    const hit = document.elementFromPoint(x, y);
    return x >= 0 && y >= 0 && x < innerWidth && y < innerHeight && (hit === element || element.contains(hit));
  });
}

async function checkTargets(page, label) {
  const smallTargets = await page.locator('.pl-create-split :is(button, select, summary, input:not([type="hidden"])):visible').evaluateAll(elements => elements.flatMap(element => {
    const target = element.matches('input[type="checkbox"], input[type="radio"]') ? element.closest('label') || element : element;
    const r = target.getBoundingClientRect();
    return r.width < 44 || r.height < 44 ? [{ name: element.getAttribute('aria-label') || target.textContent.trim().slice(0, 70), width: r.width, height: r.height }] : [];
  }));
  console.info(`[Create targets ${label}] ${JSON.stringify(smallTargets)}`);
  expect.soft(smallTargets, `${label}: 44px interactive targets`).toEqual([]);
}

test('@production Create Slice 1 viewport, editing and accessibility acceptance', async ({ page, qa }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await authenticate(page, qa);
  const output = page.getByTestId('output-textarea');
  const save = page.getByTestId('save-to-library');
  await expect(save).toHaveText(/Save as new prompt.*Expanded/);
  await page.getByRole('button', { name: 'Open library details', exact: true }).click();
  await page.getByLabel('Title', { exact: true }).fill('Synthetic custom launch brief');
  await page.getByRole('button', { name: 'Close save panel' }).click();
  await page.getByRole('button', { name: 'Open library details', exact: true }).click();
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Synthetic custom launch brief');
  await page.getByRole('button', { name: 'Close save panel' }).click();
  await save.click();
  await expect.poll(async () => (await library(page)).length).toBe(1);
  await expect(save).toHaveText(/Save new version.*Expanded/);
  const saved = (await library(page))[0];
  expect(saved.title).toBe('Synthetic custom launch brief');
  await expect.poll(() => session(page)).toMatchObject({ editingId: saved.id });
  const baseline = await library(page);

  for (const [width, height] of [[1440, 900], [375, 812], [400, 800], [768, 1024]]) {
    await page.setViewportSize({ width, height });
    for (const theme of ['light', 'dark']) {
      if (await page.locator('.pl-app-shell').getAttribute('data-theme') !== theme) await switchTheme(page, theme);
      await expect(page.locator('.pl-app-shell')).toHaveAttribute('data-theme', theme);
      await pane(page, 'Result');
      await expect(output).toBeVisible();
      const dimensions = await page.evaluate(() => {
        const root = document.documentElement;
        return { width: root.clientWidth, scrollWidth: root.scrollWidth, height: root.clientHeight, scrollHeight: root.scrollHeight };
      });
      expect.soft(dimensions.scrollWidth, `${width} ${theme}: document width`).toBeLessThanOrEqual(dimensions.width);
      expect.soft(dimensions.scrollHeight, `${width} ${theme}: document height`).toBeLessThanOrEqual(dimensions.height);
      await checkTargets(page, `${width} ${theme} Result`);
      console.info(`[Create ${width}x${height} ${theme}] ${JSON.stringify({ dimensions })}`);
      expect.soft(await reachable(save), `${width} ${theme}: primary Save reachable`).toBe(true);
      await expect(page.locator('.pl-create-split .pl-primary-button:visible').filter({ hasText: /Save (?:new version|as new prompt)/ })).toHaveCount(1);
      if (width === 1440) {
        await expect(page.getByTestId('prompt-input')).toBeVisible();
        const left = await page.locator('#create-source-pane').boundingBox();
        const right = await page.locator('#create-result-pane').boundingBox();
        expect.soft(left.x + left.width <= right.x, 'Source and Result do not overlap').toBe(true);
      } else {
        await expect(page.getByRole('group', { name: 'Workspace pane' })).toBeVisible();
        await expect(page.getByTestId('prompt-input')).toBeHidden();
        await pane(page, 'Source');
        expect.soft(await reachable(page.getByTestId('refine-action')), `${width} ${theme}: Refine reachable`).toBe(true);
        await pane(page, 'Result');
      }
      await pane(page, 'Source');
      const options = page.getByText(/Generation options ·/);
      await options.click();
      await checkTargets(page, `${width} ${theme} Source with options`);
      await options.click();
      await pane(page, 'Result');
    }
  }
  expect(await library(page)).toEqual(baseline);
  const candidates = page.getByRole('listbox', { name: 'Enhancement candidates' });
  const primary = candidates.getByRole('option').first();
  await primary.focus();
  await page.keyboard.press('End');
  await expect(candidates.getByRole('option').last()).toBeFocused();
  await expect(output).toHaveValue(rebuilt);
  await output.fill(`${rebuilt} Retain this candidate edit.`);
  await primary.focus();
  await page.keyboard.press('Home');
  await expect(output).toHaveValue(expanded);
  await page.getByRole('tab', { name: 'Prompt', exact: true }).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('tab', { name: 'Changes', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Prompt', exact: true })).toBeFocused();
  const focus = await page.getByRole('tab', { name: 'Prompt', exact: true }).evaluate(el => ({ visible: el.matches(':focus-visible'), outline: getComputedStyle(el).outlineStyle, shadow: getComputedStyle(el).boxShadow }));
  expect.soft(focus.visible && (focus.outline !== 'none' || focus.shadow !== 'none'), 'Keyboard focus is visible').toBe(true);
  await pane(page, 'Source');
  await page.getByTestId('prompt-input').fill(`${source} Retain this source edit.`);
  await pane(page, 'Result');
  await candidates.getByRole('option').last().click();
  await expect(output).toHaveValue(`${rebuilt} Retain this candidate edit.`);
  await expect(save).toHaveText(/Save new version.*Rebuilt/);
  await primary.click();
  await expect(page.getByTestId('review-assumptions')).toHaveText(/Review assumptions.*1/);
  await page.getByTestId('review-assumptions').click();
  await expect(page.getByRole('heading', { name: 'Review what the model inferred' })).toBeFocused();
  await page.locator('.pl-reversible-list').getByRole('button', { name: 'Revert', exact: true }).click();
  await expect(output).toHaveValue('Write a launch brief with three measured outcomes.');
  await expect(page.getByTestId('output-panel').getByRole('status')).toContainText('Expanded selected');
  await save.click();
  await expect.poll(async () => (await library(page))[0].versions.length).toBe(saved.versions.length + 1);
  await pane(page, 'Source');
  await expect(page.getByRole('region', { name: 'Editing context' })).toContainText('No unsaved changes');
  const edited = await library(page);
  expect(edited[0].id).toBe(saved.id);
  await expect.poll(() => session(page)).toMatchObject({ raw: `${source} Retain this source edit.`, enhanced: 'Write a launch brief with three measured outcomes.', editingId: saved.id });
  await page.reload();
  console.info(`[Create reload] mounted workspaces before readiness: ${await page.locator('.pl-create-split').count()}`);
  await pane(page, 'Result');
  await expect(output).toBeVisible();
  await expect(candidates.getByRole('option')).toHaveCount(2);
  await expect(output).toHaveValue('Write a launch brief with three measured outcomes.');
  expect(await library(page)).toEqual(edited);
  await candidates.getByRole('option').last().click();
  await expect(output).toHaveValue(`${rebuilt} Retain this candidate edit.`);
  expect(qa.calls).toEqual([]);
  expect(qa.blocked).toEqual([]);
  console.info('[Create acceptance] seeded candidates; real pane/candidate/tab edits, assumption reversal, version acknowledgement and reload passed; no provider requests');
});

test('@production Create Slice 1 Cancel, partial failure and retry', async ({ page, qa }) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 375, height: 812 });
  await authenticate(page, qa, false);
  // A held ReadableStream lets the real parser paint a chunk before Cancel.
  // Only this one synthetic proxy request is intercepted inside the browser.
  await page.evaluate(() => {
    const originalFetch = window.fetch;
    let pending = true;
    window.__createStreamCalls = 0;
    window.__createStreamAborted = false;
    window.fetch = (input, init = {}) => {
      if (pending && new URL(typeof input === 'string' ? input : input.url, location.href).pathname === '/api/proxy') {
        pending = false;
        window.__createStreamCalls++;
        const body = new ReadableStream({ start(controller) {
          const data = { type: 'content_block_delta', delta: { text: 'Synthetic streaming output visible before cancellation.' } };
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`));
          init.signal.addEventListener('abort', () => {
            window.__createStreamAborted = true;
            controller.error(new DOMException('Synthetic request cancelled', 'AbortError'));
          }, { once: true });
        } });
        return Promise.resolve(new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }));
      }
      return originalFetch(input, init);
    };
  });
  qa.mode = 'cancel';
  await page.getByTestId('refine-action').click();
  await expect(page.getByTestId('result-pane-run-bar').getByRole('status')).toHaveText('Streaming…');
  await expect(page.getByText('Synthetic streaming output visible before cancellation.', { exact: true })).toBeVisible();
  const cancel = page.getByTestId('result-pane-run-bar').getByRole('button', { name: 'Cancel', exact: true });
  expect(await reachable(cancel)).toBe(true);
  await cancel.click();
  expect(await page.evaluate(() => window.__createStreamAborted)).toBe(true);
  await expect(cancel).toBeHidden();
  await expect(page.getByText('Generation cancelled.', { exact: true })).toBeVisible();
  await pane(page, 'Source');
  await expect(page.getByTestId('prompt-input')).toHaveValue(source);
  qa.mode = 'partial';
  await page.getByTestId('refine-action').click();
  await expect(page.getByText('Incomplete response — request failed', { exact: true })).toBeVisible();
  await expect(page.getByText('Synthetic partial output retained for recovery.', { exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('Recovery');
  await pane(page, 'Source');
  await expect(page.getByTestId('prompt-input')).toHaveValue(source);
  qa.mode = 'success';
  await page.getByTestId('refine-action').click();
  await expect(page.getByTestId('output-textarea')).toHaveValue(expanded);
  await expect(page.getByText('Incomplete response — request failed', { exact: true })).toBeHidden();
  await expect(page.getByTestId('output-panel').getByRole('status')).toContainText('Enhancement complete');
  await page.getByTestId('save-to-library').click();
  await expect.poll(async () => (await library(page)).length).toBe(1);
  expect(await page.evaluate(() => window.__createStreamCalls)).toBe(1);
  expect(qa.calls).toEqual(['partial', 'success']);
  expect(qa.blocked).toEqual([]);
  console.info('[Create acceptance] reachable Cancel, preserved source, incomplete-stream recovery, synthetic successful retry and acknowledged Save passed');
});
