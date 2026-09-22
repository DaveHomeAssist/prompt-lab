import { expect, test } from '@playwright/test';

// Phase 0 guardrail for docs/VIEWPORT_SHELL_OVERHAUL_PLAN.md.
//
// `responsive-workspaces.spec.js` already saves a prompt and finds it in
// Library, but it never reloads, so nothing asserted that a saved prompt
// actually survives. Prompt Lab is local-first: "saved" means written to
// localStorage and read back on the next boot, and only a reload proves it.
//
// This is the PR-time twin of `prompt-lab-extension/e2e/production-core-loop.spec.js`.
// It exercises the same flow against the local build, so a broken core loop
// fails review rather than waiting for the next scheduled production run.
//
// No enhance is performed, so the loop needs no provider call.

// The toolbar's "Save as new prompt" is `quickSave`, which writes straight to
// the library with a title derived from the text — it does not open the save
// panel. The marker keeps this run's entry identifiable in the derived title.
const MARKER = 'Coreloopfixture';
const PROMPT_BODY = `${MARKER} verification body for the core loop persistence check.`;

async function denyTelemetry(page) {
  await page.addInitScript(() => {
    localStorage.setItem('pl_telemetry_consent', 'denied');
    localStorage.setItem('pl2-telemetry', JSON.stringify({
      telemetryEnabled: false,
      pendingEvents: [],
    }));
  });
}

function readSavedEntry(page, marker) {
  return page.evaluate((needle) => {
    const entries = JSON.parse(localStorage.getItem('pl2-library') || '[]');
    const match = entries.find((entry) => (entry?.original || '').includes(needle));
    return match ? { id: match.id, title: match.title } : null;
  }, marker);
}

test('a saved prompt survives a reload', async ({ page }) => {
  await denyTelemetry(page);

  const providerRequests = [];
  await page.route('**/api/proxy', async (route) => {
    providerRequests.push(route.request().url());
    await route.abort('blockedbyclient');
  });

  await page.goto('/app/');

  await test.step('write and save a prompt', async () => {
    await page.getByTestId('prompt-input').fill(PROMPT_BODY);
    await page.getByRole('button', { name: 'Save as new prompt', exact: true }).click();
  });

  const saved = await test.step('the prompt reaches local storage', async () => {
    await expect
      .poll(() => readSavedEntry(page, MARKER).then((entry) => Boolean(entry)))
      .toBe(true);
    return readSavedEntry(page, MARKER);
  });

  await test.step('the prompt is listed in Library', async () => {
    await page.goto('/app/#/library');
    await page.getByTestId('library-search').fill(saved.title);
    await expect(page.getByText(saved.title, { exact: true }).first()).toBeVisible();
  });

  await test.step('the prompt is still there after a reload', async () => {
    await page.reload();

    // Storage is the contract; the list is how the user sees it. Check both.
    expect(
      await readSavedEntry(page, MARKER),
      'a saved prompt must survive a reload — this is what "saved" means in a local-first app',
    ).toMatchObject({ id: saved.id, title: saved.title });

    await page.getByTestId('library-search').fill(saved.title);
    await expect(page.getByText(saved.title, { exact: true }).first()).toBeVisible();
  });

  expect(providerRequests, 'saving a prompt must not call a provider').toEqual([]);
});
