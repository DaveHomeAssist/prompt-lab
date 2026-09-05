import { expect, test } from '@playwright/test';

// M-1: the hosted app's Content-Security-Policy is a <meta> tag in
// app/index.html, so it is the real production policy. Its static test only
// checked that script-src and connect-src named the Clerk host, and the policy
// passed while three other directives quietly fell back to `default-src 'self'`
// and broke the sign-in surface.
//
// These probes run inside the actually-served /app/ page, so Chromium
// adjudicates the real policy. Each one mirrors something @clerk/clerk-react
// 5.x does when <SignIn/> mounts. Assertions are made only on
// `securitypolicyviolation` events, which fire before any network request —
// so an offline or rate-limited CI runner cannot turn this into a false
// failure.

const SMOKE_EMAIL = process.env.PROMPTLAB_SMOKE_EMAIL;
const SMOKE_PASSWORD = process.env.PROMPTLAB_SMOKE_PASSWORD;

async function trackCspViolations(page) {
  await page.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', (event) => {
      window.__cspViolations.push({
        directive: event.effectiveDirective || event.violatedDirective,
        blockedURI: event.blockedURI,
      });
    });
  });
  return () => page.evaluate(() => window.__cspViolations || []);
}

test('hosted app CSP admits every resource class the Clerk sign-in surface needs', async ({ page }) => {
  const readViolations = await trackCspViolations(page);
  await page.goto('/app/');

  await page.evaluate(async () => {
    // 1. @clerk/shared starts its session worker from a blob URL and warns
    //    "Cannot create worker from blob. Consider adding worker-src blob:; to your CSP".
    try {
      const blob = new Blob(['self.onmessage=()=>{}'], { type: 'application/javascript' });
      const worker = new Worker(URL.createObjectURL(blob));
      worker.terminate();
    } catch {
      // A synchronous throw is not the signal under test; the violation event is.
    }

    // 2. Sign-in provider icons come from @clerk/shared iconImageUrl():
    //    https://img.clerk.com/static/<id>.svg
    await new Promise((resolve) => {
      const img = new Image();
      img.onload = resolve;
      img.onerror = resolve;
      img.src = 'https://img.clerk.com/static/google.svg';
      setTimeout(resolve, 3000);
    });

    // 3. Clerk bot protection embeds a Cloudflare Turnstile challenge iframe.
    await new Promise((resolve) => {
      const frame = document.createElement('iframe');
      frame.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
      frame.onload = resolve;
      frame.onerror = resolve;
      document.body.appendChild(frame);
      setTimeout(resolve, 3000);
    });
  });

  // Give late violation events a chance to land before reading.
  await page.waitForTimeout(500);

  const violations = await readViolations();
  expect(
    violations,
    `CSP blocked Clerk sign-in resources: ${JSON.stringify(violations)}`,
  ).toEqual([]);
});

test('hosted app shell loads without tripping its own CSP', async ({ page }) => {
  const readViolations = await trackCspViolations(page);
  await page.goto('/app/');
  await expect(page.getByTestId('prompt-input')).toBeVisible();

  expect(await readViolations()).toEqual([]);
});

// The authenticated leg needs a real Clerk instance and a dedicated smoke
// account. It is opt-in: set PROMPTLAB_SMOKE_EMAIL / PROMPTLAB_SMOKE_PASSWORD
// (and point baseURL at the target deployment) to run it.
test('authenticated sign-in reaches the workspace', async ({ page }) => {
  test.skip(
    !SMOKE_EMAIL || !SMOKE_PASSWORD,
    'set PROMPTLAB_SMOKE_EMAIL and PROMPTLAB_SMOKE_PASSWORD to run the authenticated smoke journey',
  );

  const readViolations = await trackCspViolations(page);
  await page.goto('/app/');

  // Clerk renders its own sign-in card while signed out.
  const email = page.getByLabel(/email/i);
  await expect(email).toBeVisible({ timeout: 20_000 });
  await email.fill(SMOKE_EMAIL);
  await page.getByRole('button', { name: /continue/i }).click();

  const password = page.getByLabel(/password/i);
  await expect(password).toBeVisible({ timeout: 20_000 });
  await password.fill(SMOKE_PASSWORD);
  await page.getByRole('button', { name: /continue/i }).click();

  // Signed in, AuthGate swaps <SignIn/> for the workspace.
  await expect(page.getByTestId('prompt-input')).toBeVisible({ timeout: 30_000 });

  expect(
    await readViolations(),
    'the authenticated journey must not trip the production CSP',
  ).toEqual([]);
});
