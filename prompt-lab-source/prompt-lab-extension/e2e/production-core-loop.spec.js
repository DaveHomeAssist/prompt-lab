import { createClerkClient } from '@clerk/backend';
import { expect, test } from '@playwright/test';
import {
  forbiddenRequestCategory,
  readProductionFreeSmokeConfig,
} from './production-auth.mjs';

// Phase 0 guardrail for docs/VIEWPORT_SHELL_OVERHAUL_PLAN.md.
//
// The previous PromptLab incident was a functional regression while the site
// stayed up. Nothing caught it, because nothing ran against production on a
// schedule and the one production smoke that exists asserts billing copy —
// it never writes, saves or reloads a prompt.
//
// This is the core loop: write → save → find in Library → reload → still
// there. It deliberately performs no enhance, so it needs no provider call,
// costs nothing per run and cannot flake on model latency. The request guard
// from the billing smoke is kept, which additionally proves the write/save
// path is genuinely local-first.
//
// It is kept in its own file rather than bolted onto
// `production-free-account.spec.js` so that a failure here is unambiguous and
// this spec can be disabled without losing billing coverage.

const CLERK_TEARDOWN_TIMEOUT_MS = 15_000;

function withTimeout(promise, description) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${description} exceeded ${CLERK_TEARDOWN_TIMEOUT_MS / 1_000} seconds.`));
    }, CLERK_TEARDOWN_TIMEOUT_MS);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

function reportPhase(phase) {
  console.info(`[production-core-loop] ${phase}`);
}

// Mirrors prompt-lab-web/tests/app/layout-invariant.spec.js, but against the
// real signed-in production app. That local spec proves the shell in a dev
// build; only this proves what users actually get on promptlab.tools.
const LAYOUT_ROUTES = ['#/', '#/library', '#/composer', '#/split', '#/evaluate', '#/compare', '#/scratch'];
const LAYOUT_VIEWPORTS = [
  { width: 768, height: 900 },
  { width: 1440, height: 900 },
];

async function documentOverflow(page) {
  return page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
}

function readSavedEntry(page, marker) {
  return page.evaluate((needle) => {
    const entries = JSON.parse(localStorage.getItem('pl2-library') || '[]');
    const match = entries.find((entry) => (entry?.original || '').includes(needle));
    return match ? { id: match.id, title: match.title } : null;
  }, marker);
}

test('@production signed-in Free account can write, save, and reload a prompt', async ({ page }) => {
  // Headroom for the 14-page layout sweep that runs after the core loop.
  test.setTimeout(180_000);
  const { appUrl, clerkSecretKey, clerkUserId } = readProductionFreeSmokeConfig();
  const clerkClient = createClerkClient({ secretKey: clerkSecretKey });

  // The toolbar's "Save as new prompt" is `quickSave`: it writes straight to
  // the library with a title derived from the text, and does not open the save
  // panel. A per-run marker keeps this run's entry identifiable in that title.
  const marker = `Coreloop${Date.now()}`;
  const promptBody = `${marker} verification body for the production core loop.`;

  reportPhase('revoking stale Agent Task sessions');
  const activeSessions = await clerkClient.sessions.getSessionList({
    userId: clerkUserId,
    status: 'active',
    limit: 100,
  });
  await Promise.all(activeSessions.data
    .filter((session) => session.actor?.type === 'agent')
    .map((session) => clerkClient.sessions.revokeSession(session.id)));

  let agentTask = null;
  let agentSessionId = '';
  const blockedRequests = [];

  // The billing smoke clears storage on every navigation. This one must not:
  // the reload *is* the assertion, so it seeds once and then leaves storage
  // alone for the rest of the run.
  await page.addInitScript(() => {
    if (!localStorage.getItem('__plb_core_loop_booted')) {
      localStorage.clear();
      sessionStorage.clear();
      localStorage.setItem('__plb_core_loop_booted', '1');
    }
    localStorage.setItem('pl_telemetry_consent', 'denied');
    localStorage.setItem('pl2-telemetry', JSON.stringify({
      telemetryEnabled: false,
      pendingEvents: [],
    }));
  });

  await page.route('**/*', async (route) => {
    const category = forbiddenRequestCategory(route.request().url());
    if (!category) {
      await route.continue();
      return;
    }
    blockedRequests.push(`${category}: ${route.request().method()} ${route.request().url()}`);
    await route.abort('blockedbyclient');
  });

  try {
    reportPhase('creating Clerk Agent Task');
    agentTask = await clerkClient.agentTasks.create({
      onBehalfOf: { userId: clerkUserId },
      permissions: '*',
      agentName: 'promptlab-production-core-loop',
      taskDescription: 'Verify the signed-in write, save, and reload loop without provider or billing activity.',
      redirectUrl: appUrl.href,
      sessionMaxDurationInSeconds: 300,
    });

    reportPhase('opening production through the Agent Task');
    await page.goto(agentTask.url, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('tab', { name: 'Library', exact: true })).toBeVisible();

    agentSessionId = await page.evaluate(() => {
      const sessionId = window.Clerk?.session?.id;
      return typeof sessionId === 'string' && sessionId.startsWith('sess_') ? sessionId : '';
    });
    expect(Boolean(agentSessionId), 'The Agent Task must create a disposable Clerk browser session.').toBe(true);

    reportPhase('writing a prompt');
    const input = page.getByTestId('prompt-input');
    await expect(input).toBeVisible();
    await input.fill(promptBody);

    reportPhase('saving the prompt');
    await page.getByRole('button', { name: 'Save as new prompt', exact: true }).click();

    reportPhase('confirming the prompt reached storage');
    await expect
      .poll(
        () => readSavedEntry(page, marker).then((entry) => Boolean(entry)),
        { message: 'The saved prompt must be written to the local library.' },
      )
      .toBe(true);
    const saved = await readSavedEntry(page, marker);

    reportPhase('finding the prompt in Library');
    await page.goto(`${appUrl.href}#/library`, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('library-search').fill(saved.title);
    await expect(page.getByText(saved.title, { exact: true }).first()).toBeVisible();

    reportPhase('reloading and re-checking persistence');
    await page.reload({ waitUntil: 'domcontentloaded' });
    expect(
      await readSavedEntry(page, marker),
      'The saved prompt must survive a reload.',
    ).toMatchObject({ id: saved.id, title: saved.title });
    await page.getByTestId('library-search').fill(saved.title);
    await expect(page.getByText(saved.title, { exact: true }).first()).toBeVisible();

    // Runs last so a layout failure can never mask a core-loop failure above.
    // The saved prompt plus the bundled starter library give the panels enough
    // content to overflow if the shell were unbounded.
    reportPhase('checking the document never scrolls in production');
    const overflowing = [];
    for (const viewport of LAYOUT_VIEWPORTS) {
      await page.setViewportSize(viewport);
      for (const route of LAYOUT_ROUTES) {
        await page.goto(`${appUrl.href}${route}`, { waitUntil: 'domcontentloaded' });
        await expect(page.getByRole('banner')).toBeVisible();
        await page.waitForTimeout(350);
        const overflow = await documentOverflow(page);
        if (overflow > 1) overflowing.push(`${route} @ ${viewport.width}x${viewport.height}: ${overflow}px`);
      }
    }
    expect(
      overflowing,
      'The production app shell must not scroll the document. Scrolling belongs to a panel-local region.',
    ).toEqual([]);

    expect(
      blockedRequests,
      'The core loop must not need providers, billing, Stripe, or telemetry.',
    ).toEqual([]);
  } finally {
    reportPhase('revoking the disposable session');
    if (agentSessionId) {
      await withTimeout(
        clerkClient.sessions.revokeSession(agentSessionId),
        'Clerk Agent Task session revocation',
      );
    } else if (agentTask) {
      await withTimeout(
        clerkClient.agentTasks.revoke(agentTask.agentTaskId),
        'Clerk Agent Task revocation',
      );
    }
  }
});
