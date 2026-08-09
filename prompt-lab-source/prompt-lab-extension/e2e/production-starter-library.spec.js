import { expect, test } from '@playwright/test';

const PRODUCTION_URL = process.env.PROMPT_LAB_PRODUCTION_URL || 'https://promptlab.tools/app/';
const AUTH_STATE_PATH = process.env.PROMPT_LAB_AUTH_STATE;
const SAVE_AUTH_STATE_PATH = process.env.PROMPT_LAB_SAVE_AUTH_STATE;
if (AUTH_STATE_PATH) {
  test.use({ storageState: AUTH_STATE_PATH });
}

const PACK_ID = 'lib_project_prompt_instruments';
const PACK_NAME = "Project Prompt Instruments — Dave's Suite";
const EXPECTED_TITLES = [
  'GOS-P1 · Coupling Map for the gardens[] Refactor',
  'GOS-P2 · Persistence Audit for IndexedDB Migration',
  'GOS-P3 · Determinism Audit for Scoring',
  'GOS-G1 · Trust Boundary for the Authority Slice',
  'GOS-G2 · Reward Derivation — Branches Under Doctrine',
  'GOS-G3 · World-Gen & Scatter Determinism',
  'GOS-G4 · Ship Gate vs. Definition of Done',
  'RB-1 · Seam Analysis for Normalization Ownership',
  'RB-2 · Contract Inventory for the Snapshot Schema',
  'PLB-1 · Trust & Surface of the Extension',
  'TK-1 · Trust Boundary for Open Fetch + Normalization',
  'A2-1 · Offline Reliability',
  'DF-1 · Client-Site Delivery Gate',
  'ST-1 · Checkout Path Audit',
];

function forbiddenRequestCategory(rawUrl) {
  const url = new URL(rawUrl);
  const host = url.hostname.toLowerCase();
  const path = url.pathname.toLowerCase();

  if (host === 'api.anthropic.com' || host.endsWith('.anthropic.com')) return 'Anthropic';
  if (host === 'stripe.com' || host.endsWith('.stripe.com') || host.endsWith('.stripe.network')) return 'Stripe';
  if (/\/(api\/)?(billing|checkout|portal|stripe)(\/|$)/.test(path)) return 'billing';
  if (/\/api\/(proxy|telemetry)(\/|$)/.test(path)) return path.includes('telemetry') ? 'telemetry' : 'provider proxy';
  if (
    host.includes('telemetry')
    || host.includes('google-analytics')
    || host.includes('googletagmanager')
    || host.includes('posthog')
    || host.includes('sentry')
    || host.includes('vercel-insights')
    || path.includes('/_vercel/insights')
    || path.includes('/_vercel/speed-insights')
  ) return 'telemetry';

  return null;
}

async function persistedPackState(page) {
  return page.evaluate(({ packId }) => {
    const loadedPacks = JSON.parse(localStorage.getItem('pl2-loaded-packs') || '[]');
    const library = JSON.parse(localStorage.getItem('pl2-library') || '[]');
    const entries = library.filter((entry) => entry?.metadata?.packId === packId);

    return {
      loaded: loadedPacks.includes(packId),
      count: entries.length,
      titles: entries.map((entry) => entry.title).sort(),
    };
  }, { packId: PACK_ID });
}

async function openLibrary(page) {
  await page.getByRole('tab', { name: 'Library', exact: true }).click();
  await expect(page.getByText('Starter Libraries', { exact: true })).toBeVisible();
}

async function assertInstrumentTitles(page) {
  for (const title of EXPECTED_TITLES) {
    await expect(page.getByText(title, { exact: true })).toBeVisible();
  }
}

test('@production Project Prompt Instruments starter library loads and persists', async ({ page }) => {
  test.setTimeout(SAVE_AUTH_STATE_PATH ? 6 * 60_000 : 60_000);
  const requestedUrl = new URL(PRODUCTION_URL);
  const productionOrigin = new URL(PRODUCTION_URL).origin;
  const forbiddenRequests = [];
  const failedRequests = [];
  const failedApplicationResponses = [];
  const consoleErrors = [];
  const pageErrors = [];

  await page.addInitScript(() => {
    if (!sessionStorage.getItem('promptlab-production-smoke-initialized')) {
      localStorage.removeItem('pl2-library');
      localStorage.removeItem('pl2-collections');
      localStorage.removeItem('pl2-loaded-packs');
      localStorage.setItem('pl2-legacy-web-library-checked', 'true');
      sessionStorage.setItem('promptlab-production-smoke-initialized', 'true');
    }

    localStorage.setItem('pl2-billing', JSON.stringify({
      plan: 'pro',
      status: 'owner',
      billingPeriod: 'owner',
      lastValidatedAt: new Date().toISOString(),
    }));
    localStorage.setItem('pl_telemetry_consent', 'denied');
    localStorage.setItem('pl2-telemetry', JSON.stringify({
      telemetryEnabled: false,
      pendingEvents: [],
    }));
  });
  await page.route('**/*', async (route) => {
    const request = route.request();
    const category = forbiddenRequestCategory(request.url());
    if (!category) {
      await route.continue();
      return;
    }

    forbiddenRequests.push(`${category}: ${request.method()} ${request.url()}`);
    await route.fulfill({ status: 204, body: '' });
  });

  page.on('requestfailed', (request) => {
    failedRequests.push(`${request.method()} ${request.url()} — ${request.failure()?.errorText || 'unknown error'}`);
  });
  page.on('response', (response) => {
    if (response.url().startsWith(productionOrigin) && response.status() >= 400) {
      failedApplicationResponses.push(`${response.status()} ${response.request().method()} ${response.url()}`);
    }
  });
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto(PRODUCTION_URL, { waitUntil: 'domcontentloaded' });
  const currentUrl = new URL(page.url());
  expect(currentUrl.origin).toBe(requestedUrl.origin);
  expect(currentUrl.pathname.replace(/\/+$/, '')).toBe(requestedUrl.pathname.replace(/\/+$/, ''));
  const libraryTab = page.getByRole('tab', { name: 'Library', exact: true });
  const destination = await Promise.race([
    libraryTab.waitFor({ state: 'visible', timeout: 15_000 }).then(() => 'app'),
    page.getByRole('heading', { name: 'Sign in to Prompt Lab' }).waitFor({ state: 'visible', timeout: 15_000 }).then(() => 'auth'),
  ]);
  if (destination === 'auth' && !SAVE_AUTH_STATE_PATH) {
    throw new Error(
      'Production authentication is required. Set PROMPT_LAB_AUTH_STATE to an authorized '
      + 'Playwright storage-state JSON file, or set PROMPT_LAB_SAVE_AUTH_STATE and run headed.',
    );
  }
  if (destination === 'auth') {
    console.log('\n[production-smoke] Complete the Clerk sign-in in Chromium; the test will resume automatically.');
    await libraryTab.waitFor({ state: 'visible', timeout: 5 * 60_000 });
    await page.context().storageState({ path: SAVE_AUTH_STATE_PATH });
  }

  await openLibrary(page);

  const packTitle = page.getByText(PACK_NAME, { exact: true });
  await expect(packTitle).toBeVisible();
  const packCard = packTitle.locator('xpath=ancestor::div[.//button][1]');
  await expect(packCard.getByText('14 prompts', { exact: true })).toBeVisible();
  await packCard.getByRole('button', { name: 'Load', exact: true }).click();
  await expect(packCard.getByRole('button', { name: /^Loaded/ })).toBeVisible();

  await assertInstrumentTitles(page);
  await expect.poll(() => persistedPackState(page)).toEqual({
    loaded: true,
    count: EXPECTED_TITLES.length,
    titles: [...EXPECTED_TITLES].sort(),
  });

  await page.reload({ waitUntil: 'domcontentloaded' });
  await openLibrary(page);
  await expect(page.getByText(PACK_NAME, { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Loaded/ })).toBeVisible();
  await assertInstrumentTitles(page);
  await expect.poll(() => persistedPackState(page)).toEqual({
    loaded: true,
    count: EXPECTED_TITLES.length,
    titles: [...EXPECTED_TITLES].sort(),
  });

  await page.waitForTimeout(1_000);
  expect(forbiddenRequests, 'No paid-provider, billing, or telemetry request may leave the browser').toEqual([]);
  expect(failedRequests, 'No browser request may fail').toEqual([]);
  expect(failedApplicationResponses, 'No application response may return HTTP 4xx/5xx').toEqual([]);
  expect(consoleErrors, 'No browser console errors').toEqual([]);
  expect(pageErrors, 'No uncaught page errors').toEqual([]);
});
