import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const taskDestinations = [
  '/guide.html#quick-start',
  '/setup.html#provider-setup',
  '/guide.html#import-export',
  '/guide.html#variables',
  '/guide.html#keyboard-shortcuts',
];

const targetViewports = [
  { width: 320, height: 720 },
  { width: 390, height: 844 },
  { width: 680, height: 900 },
  { width: 768, height: 1024 },
  { width: 915, height: 412 },
  { width: 1280, height: 800 },
];

test.beforeEach(async ({ page }) => {
  await page.route('https://fonts.googleapis.com/**', (route) => route.abort());
  await page.route('https://fonts.gstatic.com/**', (route) => route.abort());
});

function formatAxeViolations(violations) {
  return violations.map(({ id, impact, nodes }) => ({
    id,
    impact,
    targets: nodes.map((node) => node.target.join(' ')),
  }));
}

async function expectInside(page, containerSelector) {
  await expect.poll(() => page.evaluate((selector) => {
    const container = document.querySelector(selector);
    return Boolean(container && container.contains(document.activeElement));
  }, containerSelector)).toBe(true);
}

async function tabUntil(page, target, maxTabs = 80) {
  for (let count = 0; count < maxTabs; count += 1) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }

  await expect(target, `Expected ${await target.evaluate((element) => element.outerHTML)} in the tab order`).toBeFocused();
}

test('landing and task documentation have no serious or critical axe violations', async ({ page }) => {
  test.setTimeout(30_000);
  for (const route of ['/', '/guide.html', '/setup.html', '/privacy.html']) {
    await page.goto(route);
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    const blockingViolations = results.violations.filter(({ impact }) => (
      impact === 'critical' || impact === 'serious'
    ));

    const formattedViolations = formatAxeViolations(blockingViolations);
    expect(formattedViolations, `${route} accessibility violations`).toEqual([]);
  }
});

test('public surfaces make no third-party requests before consent', async ({ page }) => {
  const thirdPartyRequests = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) {
      thirdPartyRequests.push(request.url());
    }
  });

  for (const route of ['/', '/guide.html', '/setup.html', '/privacy.html']) {
    await page.goto(route, { waitUntil: 'networkidle' });
  }

  expect(thirdPartyRequests).toEqual([]);
});

test('public content security policy blocks injected third-party scripts', async ({ page }) => {
  let thirdPartyScriptRequested = false;
  await page.route('https://vercel.live/**', async (route) => {
    thirdPartyScriptRequested = true;
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: 'window.__unexpectedThirdPartyScript = true;',
    });
  });

  for (const route of ['/', '/guide.html', '/setup.html', '/privacy.html']) {
    thirdPartyScriptRequested = false;
    await page.goto(route);
    await page.evaluate(async () => {
      await new Promise((resolve) => {
        const script = document.createElement('script');
        const timeout = window.setTimeout(resolve, 250);
        script.src = 'https://vercel.live/_next-live/feedback/feedback.js';
        script.addEventListener('load', () => {
          window.clearTimeout(timeout);
          resolve();
        }, { once: true });
        script.addEventListener('error', () => {
          window.clearTimeout(timeout);
          resolve();
        }, { once: true });
        document.head.append(script);
      });
    });
    expect(thirdPartyScriptRequested, `${route} allowed an injected third-party script request`).toBe(false);
    expect(await page.evaluate(() => window.__unexpectedThirdPartyScript)).toBeUndefined();
  }
});

test('reveal motion is a JavaScript enhancement with a visible completion state', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveClass(/reveal-motion/);

  const pricingHeader = page.locator('#pricing .pricing-header');
  await expect.poll(() => pricingHeader.evaluate((element) => getComputedStyle(element).opacity)).toBe('0');
  await pricingHeader.scrollIntoViewIfNeeded();
  await expect.poll(() => pricingHeader.evaluate((element) => getComputedStyle(element).opacity)).toBe('1');
});

test.describe('mobile navigation', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('opens from the keyboard, traps focus, closes with Escape, and returns focus', async ({ page }) => {
    await page.goto('/');

    const toggle = page.locator('#navToggle');
    const dialog = page.locator('#mobileNav');
    const main = page.locator('#main-content');
    const close = page.locator('#mobileNavClose');
    const product = dialog.getByRole('link', { name: 'Product', exact: true });
    const workflow = dialog.getByRole('link', { name: 'How it works', exact: true });
    const pricing = dialog.getByRole('link', { name: 'Pricing', exact: true });
    const docs = dialog.getByRole('link', { name: 'Docs', exact: true });
    const openApp = dialog.getByRole('link', { name: /Open PromptLab/ });

    await tabUntil(page, toggle);
    await page.keyboard.press('Enter');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(dialog).toBeVisible();
    await expect(close).toBeFocused();
    const dialogAxeResults = await new AxeBuilder({ page })
      .include('#mobileNav')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(formatAxeViolations(dialogAxeResults.violations.filter(({ impact }) => (
      impact === 'critical' || impact === 'serious'
    ))), 'mobile navigation accessibility violations').toEqual([]);
    await expectInside(page, '#mobileNav');
    await main.focus();
    await expectInside(page, '#mobileNav');

    await page.keyboard.press('Shift+Tab');
    await expect(openApp).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(close).toBeFocused();

    for (const target of [product, workflow, pricing, docs, openApp]) {
      await page.keyboard.press('Tab');
      await expect(target).toBeFocused();
    }
    await page.keyboard.press('Tab');
    await expect(close).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toBeFocused();

    await page.keyboard.press('Space');
    await expect(dialog).toBeVisible();
    await expect(close).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(dialog).toBeHidden();
    await expect(toggle).toBeFocused();
  });

  test('keeps the persistent app action named and moves focus to an in-page destination', async ({ page }) => {
    await page.goto('/');

    await expect(page.locator('.nav-mobile-cta')).toHaveAccessibleName('Open PromptLab app');
    await page.locator('#navToggle').click();
    await page.locator('#mobileNav').getByRole('link', { name: 'Pricing' }).click();

    await expect(page.locator('#mobileNav')).toBeHidden();
    await expect(page).toHaveURL(/#pricing$/);
    await expect(page.locator('#pricing')).toBeFocused();
    await expect.poll(() => page.locator('#pricing').evaluate((target) => {
      const nav = document.getElementById('nav');
      return target.getBoundingClientRect().top - nav.getBoundingClientRect().bottom;
    })).toBeGreaterThanOrEqual(0);
    await expect.poll(() => page.locator('#pricing').evaluate((target) => (
      target.getBoundingClientRect().top
    ))).toBeLessThan(180);
  });
});

test('critical landing controls work through the tab order without pointer input', async ({ page }) => {
  await page.goto('/');

  const skipLink = page.getByRole('link', { name: 'Skip to main content' });
  await page.keyboard.press('Tab');
  await expect(skipLink).toBeFocused();
  await expect(skipLink).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main-content')).toBeFocused();

  const balancedMode = page.locator('#demoBalanced');
  const conciseMode = page.locator('#demoConcise');
  await tabUntil(page, balancedMode);
  await page.keyboard.press('ArrowRight');
  await expect(conciseMode).toBeChecked();
  await expect(conciseMode).toBeFocused();

  const run = page.locator('#demoRun');
  await tabUntil(page, run);
  await page.keyboard.press('Enter');
  await expect(page.locator('#demoStatus')).toHaveText('Example ready. No provider was called.');
  await expect(page.locator('#demoOutput')).not.toBeEmpty();

  const monthly = page.locator('#billingMonthly');
  const annual = page.locator('#billingAnnual');
  await tabUntil(page, monthly);
  await page.keyboard.press('ArrowRight');
  await expect(annual).toBeChecked();
  await expect(annual).toBeFocused();
  await expect(page.locator('#proPrice')).toContainText('100');
  await expect(page.locator('#proCta')).toHaveAttribute('href', '/app?upgrade=pro&period=annual&source=landing-pricing');

  const firstQuestion = page.locator('#faq summary').first();
  await tabUntil(page, firstQuestion);
  await page.keyboard.press('Enter');
  await expect(firstQuestion.locator('..')).toHaveAttribute('open', '');
});

test('sample modes, shortcut scope, busy state, status, result, and handoff work', async ({ page }) => {
  await page.goto('/');

  const demo = page.locator('#demo');
  const input = page.locator('#demoInput');
  const output = page.locator('#demoOutput');
  const run = page.locator('#demoRun');
  const status = page.locator('#demoStatus');
  const cta = page.locator('#demoCta');
  const conciseMode = page.locator('input[name="demoMode"][value="concise"]');

  await expect(input).toHaveAttribute('readonly', '');
  await expect(page.locator('input[name="demoMode"]')).toHaveCount(3);
  await page.locator('label[for="demoConcise"]').click();
  await expect(conciseMode).toBeChecked();

  await page.locator('#main-content').focus();
  await page.keyboard.press('Control+Enter');
  await expect(output).toBeEmpty();
  await expect(run).toBeEnabled();

  await page.evaluate(() => {
    const demo = document.getElementById('demo');
    const output = document.getElementById('demoOutput');
    const run = document.getElementById('demoRun');
    const status = document.getElementById('demoStatus');
    const snapshots = [];
    const statusChanges = [];
    const capture = () => snapshots.push({
      outputBusy: output.getAttribute('aria-busy'),
      runBusy: run.getAttribute('aria-busy'),
      disabled: run.disabled,
      status: status.textContent,
    });
    capture();
    const observer = new MutationObserver(capture);
    observer.observe(demo, {
      attributes: true,
      childList: true,
      subtree: true,
      characterData: true,
    });
    const statusObserver = new MutationObserver(() => statusChanges.push(status.textContent));
    statusObserver.observe(status, { childList: true, subtree: true, characterData: true });
    window.__landingDemoGate = { snapshots, observer, statusChanges, statusObserver };
  });

  await input.focus();
  await page.keyboard.press('Control+Enter');
  await expect(status).toContainText(/(?:Example ready|(?:Balanced|Concise|Detailed) sample ready)/i, { timeout: 5_000 });
  await expect(output).toHaveAttribute('aria-busy', 'false');
  await expect(output).not.toBeEmpty();
  const renderedSample = await output.textContent();
  expect(renderedSample).toContain('\n');
  expect(renderedSample).not.toContain(`${String.fromCharCode(92)}n`);
  await expect(run).toBeEnabled();
  await expect(cta).toBeVisible();
  await expect(cta).toHaveAttribute('href', /\/app\/?/);
  await expect(demo).toContainText(/Try your own prompt/i);

  const demoGate = await page.evaluate(() => {
    window.__landingDemoGate.observer.disconnect();
    window.__landingDemoGate.statusObserver.disconnect();
    return {
      snapshots: window.__landingDemoGate.snapshots,
      statusChanges: window.__landingDemoGate.statusChanges,
    };
  });
  const demoStates = demoGate.snapshots;
  expect(demoStates.some((state) => (
    state.outputBusy === 'true'
    && state.runBusy === 'true'
    && state.disabled
    && /(?:Preparing|Refining) (?:the )?sample/i.test(state.status)
  )), 'Demo should expose a busy/loading state').toBe(true);
  expect(demoStates.some((state) => (
    state.outputBusy === 'false'
    && state.runBusy === 'false'
    && !state.disabled
    && /(?:Example ready|(?:Balanced|Concise|Detailed) sample ready)/i.test(state.status)
  )), 'Demo should expose a completed/ready state').toBe(true);
  expect(
    demoGate.statusChanges.filter((message) => message === 'Example ready. No provider was called.'),
    'The polite live region should receive one ready message',
  ).toHaveLength(1);
});

test('landing controls purge poisoned attribution and store only allowlisted funnel events', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    const now = Date.now();
    sessionStorage.setItem('promptlab_landing_attribution', JSON.stringify({
      version: 1,
      events: [
        {
          event: 'landing.cta_clicked',
          placement: 'hero',
          intent: 'free',
          destination: 'app',
          timestamp: now - 1_000,
          prompt: 'private prompt poison',
          email: 'poison@example.com',
          url: 'https://tracker.invalid/private',
        },
        {
          event: 'landing.unknown',
          placement: 'hero',
          intent: 'free',
          destination: 'app',
          timestamp: now,
          prompt: 'unknown event poison',
        },
        {
          event: 'landing.cta_clicked',
          placement: 'hero',
          intent: 'free',
          destination: 'app',
          timestamp: now - (25 * 60 * 60 * 1000),
          email: 'stale@example.com',
        },
        {
          event: 'landing.cta_clicked',
          placement: 'hero',
          intent: 'free',
          destination: 'app',
          timestamp: now + (10 * 60 * 1000),
          url: 'https://future.invalid/',
        },
      ],
    }));

    for (const analyticsId of ['landing.privacy.open_policy', 'landing.surface.extension']) {
      document.querySelector(`[data-analytics-id="${analyticsId}"]`)
        .addEventListener('click', (event) => event.preventDefault(), { capture: true });
    }
  });

  await page.locator('[data-analytics-id="landing.privacy.open_policy"]').click();
  await page.locator('[data-analytics-id="landing.surface.extension"]').click();
  await page.locator('#demoRun').click();
  await expect(page.locator('#demoStatus')).toHaveText('Example ready. No provider was called.');
  await page.locator('label[for="billingAnnual"]').click();

  const stored = await page.evaluate(() => sessionStorage.getItem('promptlab_landing_attribution'));
  expect(stored).not.toBeNull();
  for (const poison of [
    'private prompt poison',
    'poison@example.com',
    'tracker.invalid',
    'unknown event poison',
    'stale@example.com',
    'future.invalid',
  ]) {
    expect(stored).not.toContain(poison);
  }

  const payload = JSON.parse(stored);
  expect(payload.version).toBe(1);
  expect(payload.events.map(({ event }) => event)).toEqual([
    'landing.cta_clicked',
    'landing.cta_clicked',
    'landing.cta_clicked',
    'landing.surface_selected',
    'landing.demo_completed',
    'landing.pricing_period_selected',
  ]);
  expect(payload.events[1]).toMatchObject({
    event: 'landing.cta_clicked',
    placement: 'privacy',
    intent: 'open',
    destination: 'privacy',
  });
  expect(payload.events[3]).toMatchObject({
    event: 'landing.surface_selected',
    placement: 'surface_extension',
    intent: 'open',
    destination: 'setup',
  });

  const allowedKeys = new Set([
    'event', 'timestamp', 'placement', 'intent', 'destination', 'period', 'demoMode', 'resultCount',
  ]);
  for (const event of payload.events) {
    expect(Object.keys(event).every((key) => allowedKeys.has(key))).toBe(true);
  }
});

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('shows the complete sample immediately and leaves no running reveal animation', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addInitScript(() => {
      const nativeSetTimeout = window.setTimeout.bind(window);
      window.__landingTimeoutDelays = [];
      window.setTimeout = (handler, delay = 0, ...args) => {
        window.__landingTimeoutDelays.push(Number(delay));
        return nativeSetTimeout(handler, delay, ...args);
      };
    });
    await page.goto('/');
    await expect.poll(() => page.evaluate(() => (
      matchMedia('(prefers-reduced-motion: reduce)').matches
    ))).toBe(true);

    await page.evaluate(() => { window.__landingTimeoutDelays = []; });
    await page.locator('#demoRun').click();
    await expect(page.locator('#demoStatus')).toContainText(/(?:Example ready|(?:Balanced|Concise|Detailed) sample ready)/i, { timeout: 750 });
    await expect(page.locator('#demoOutput')).not.toBeEmpty();

    const timeoutDelays = await page.evaluate(() => window.__landingTimeoutDelays);
    expect(timeoutDelays).toContain(0);
    expect(timeoutDelays).not.toContain(220);

    const motionState = await page.evaluate(() => {
      const heroBackground = document.querySelector('.hero-bg');
      const badgeDot = document.querySelector('.hero-badge-dot');
      return {
        runningAnimations: document.getAnimations().filter((animation) => animation.playState === 'running').length,
        heroBefore: getComputedStyle(heroBackground, '::before').animationName,
        heroAfter: getComputedStyle(heroBackground, '::after').animationName,
        badgeDot: getComputedStyle(badgeDot).animationName,
      };
    });
    expect(motionState).toEqual({
      runningAnimations: 0,
      heroBefore: 'none',
      heroAfter: 'none',
      badgeDot: 'none',
    });
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior)).toBe('auto');
  });
});

test.describe('JavaScript disabled', () => {
  test.use({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });

  test('keeps the complete marketing story visible', async ({ page }) => {
    await page.goto('/');
    for (const selector of ['#main-content', 'h1', '#demo', '#workflow', '#pricing', '#faq', 'footer']) {
      await expect(page.locator(selector)).toBeVisible();
    }

    const skipLink = page.getByRole('link', { name: 'Skip to main content' });
    await page.keyboard.press('Tab');
    await expect(skipLink).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#main-content')).toBeFocused();

    await expect(page.locator('#demoRun')).toBeDisabled();
    await expect(page.locator('#demoNoScript')).toBeVisible();
    await expect(page.locator('#demoNoScript')).toContainText(/fixed example prompt remains visible/i);
    await expect(page.locator('#demoInput')).toContainText(/Write a Python script that reads a CSV/i);

    const hiddenRevealCount = await page.locator('.reveal').evaluateAll((elements) => (
      elements.filter((element) => {
        const style = getComputedStyle(element);
        return style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0;
      }).length
    ));
    expect(hiddenRevealCount).toBe(0);
  });
});

test('1280x800 at 200% reflow proxy stays usable at a 640x400 CSS viewport', async ({ page }) => {
  // This exercises the CSS viewport expected after zoom reflow. It does not simulate browser zoom.
  await page.setViewportSize({ width: 640, height: 400 });
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  const viewportWidth = await page.evaluate(() => document.documentElement.clientWidth);
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(viewportWidth + 1);

  for (const selector of [
    '.nav-mobile-cta',
    '#navToggle',
    'label[for="demoBalanced"]',
    'label[for="demoConcise"]',
    'label[for="demoDetailed"]',
    '#demoRun',
    'label[for="billingMonthly"]',
    'label[for="billingAnnual"]',
    '#proCta',
  ]) {
    const target = page.locator(selector);
    await target.scrollIntoViewIfNeeded();
    await expect(target, `${selector} should remain visible in the reflow proxy`).toBeVisible();
    const box = await target.boundingBox();
    expect(box, `${selector} should have a rendered box`).not.toBeNull();
    expect(box.x, `${selector} should not be clipped on the left`).toBeGreaterThanOrEqual(-1);
    expect(box.x + box.width, `${selector} should not be clipped on the right`).toBeLessThanOrEqual(viewportWidth + 1);
  }
});

test('target viewports avoid horizontal overflow', async ({ page }) => {
  test.setTimeout(30_000);
  for (const viewport of targetViewports) {
    await page.setViewportSize(viewport);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(
      dimensions.scrollWidth,
      `${viewport.width}x${viewport.height} overflowed: ${JSON.stringify(dimensions)}`,
    ).toBeLessThanOrEqual(dimensions.clientWidth + 1);
  }
});

test.describe('mobile touch targets', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('primary landing controls are at least 44 by 44 CSS pixels', async ({ page }) => {
    await page.goto('/');

    const modeLabels = await page.locator('input[name="demoMode"]').evaluateAll((inputs) => (
      inputs.map((input) => `label[for="${CSS.escape(input.id)}"]`)
    ));
    const selectors = [
      '#navToggle',
      '#demoRun',
      '#proCta',
      'label[for="billingMonthly"]',
      'label[for="billingAnnual"]',
      ...modeLabels,
    ];

    for (const selector of selectors) {
      const target = page.locator(selector);
      await expect(target, `${selector} should be visible`).toBeVisible();
      const box = await target.boundingBox();
      expect(box, `${selector} should have a rendered box`).not.toBeNull();
      expect(box.width, `${selector} width`).toBeGreaterThanOrEqual(44);
      expect(box.height, `${selector} height`).toBeGreaterThanOrEqual(44);
    }

    await page.locator('#navToggle').click();
    const close = page.locator('#mobileNavClose');
    const closeBox = await close.boundingBox();
    expect(closeBox).not.toBeNull();
    expect(closeBox.width).toBeGreaterThanOrEqual(44);
    expect(closeBox.height).toBeGreaterThanOrEqual(44);
  });
});

test('billing-period radios update displayed pricing and the explicit app handoff', async ({ page }) => {
  await page.goto('/');

  const monthly = page.locator('#billingMonthly');
  const annual = page.locator('#billingAnnual');
  const price = page.locator('#proPrice');
  const period = page.locator('#proPeriod');
  const cta = page.locator('#proCta');

  await expect(monthly).toBeChecked();
  await expect(price).toContainText('9');
  await expect(period).toContainText(/month/i);
  await expect(cta).toHaveAttribute('href', '/app?upgrade=pro&period=monthly&source=landing-pricing');

  await page.locator('label[for="billingAnnual"]').click();
  await expect(price).toContainText('100');
  await expect(period).toContainText(/year/i);
  await expect(cta).toHaveAttribute('href', '/app?upgrade=pro&period=annual&source=landing-pricing');
  await expect(page.locator('#pricing')).toContainText('$8.33');
  await expect(page.locator('#pricing')).toContainText(/Save \$8\/year/i);

  await page.locator('label[for="billingMonthly"]').click();
  await expect(price).toContainText('9');
  await expect(cta).toHaveAttribute('href', '/app?upgrade=pro&period=monthly&source=landing-pricing');
});

test('target-blank links protect the opener in rendered landing and docs pages', async ({ page }) => {
  for (const route of ['/', '/guide.html', '/setup.html', '/privacy.html']) {
    await page.goto(route);
    const missingProtection = await page.locator('a[target="_blank"]').evaluateAll((links) => (
      links
        .filter((link) => {
          const rel = new Set((link.getAttribute('rel') ?? '').toLowerCase().split(/\s+/).filter(Boolean));
          return !rel.has('noopener') || !rel.has('noreferrer');
        })
        .map((link) => link.outerHTML)
    ));
    expect(missingProtection, `${route} has unprotected target-blank links`).toEqual([]);
  }
});

test('landing task destinations load and identify real headings', async ({ page }) => {
  await page.goto('/');
  const landingHrefs = await page.locator('a[href*="guide.html#"], a[href*="setup.html#"]').evaluateAll((links) => (
    links.map((link) => new URL(link.href).pathname + new URL(link.href).hash)
  ));

  for (const destination of taskDestinations) {
    expect(landingHrefs, `Landing is missing ${destination}`).toContain(destination);
    await page.goto(destination);
    const id = new URL(destination, 'http://local.test').hash;
    const heading = page.locator(id);
    await expect(heading).toBeVisible();
    expect(await heading.evaluate((element) => element.tagName)).toMatch(/^H[1-6]$/);
  }
});

test('guide search stores content-free, allowlisted result attribution', async ({ page }) => {
  await page.goto('/guide.html');
  await page.evaluate(() => sessionStorage.removeItem('promptlab_landing_attribution'));

  const search = page.locator('#docs-search-input');
  const clear = page.locator('#docs-search-clear');
  const status = page.locator('#docs-search-status');
  await expect(status).toHaveAttribute('role', 'status');
  await expect(status).toHaveAttribute('aria-atomic', 'true');
  await tabUntil(page, search);
  await page.keyboard.type('clipboard');
  const result = page.locator('#docs-search-list .search-result-link');
  await expect(result).toHaveCount(1);
  await expect(result).toContainText('Template variables');
  await expect(status).toHaveText('1 task found.');
  await expect(clear).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(search).toBeFocused();
  await expect(search).toHaveValue('');
  await expect(clear).toBeHidden();
  await expect(page.locator('#docs-search-results')).toBeHidden();
  await expect(status).toHaveText('Search cleared.');

  await page.keyboard.type('clipboard');
  await page.keyboard.press('Tab');
  await expect(clear).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(result).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#variables$/);

  const stored = await page.evaluate(() => sessionStorage.getItem('promptlab_landing_attribution'));
  expect(stored).not.toBeNull();
  expect(stored.toLowerCase()).not.toContain('clipboard');

  const payload = JSON.parse(stored);
  expect(payload.version).toBe(1);
  expect(payload.events).toHaveLength(1);
  expect(payload.events[0]).toMatchObject({
    event: 'landing.docs_result_selected',
    placement: 'docs_search',
    intent: 'open',
    destination: 'guide',
    resultCount: 1,
  });
  expect(Object.keys(payload.events[0]).sort()).toEqual([
    'destination',
    'event',
    'intent',
    'placement',
    'resultCount',
    'timestamp',
  ]);
});

test('guide search revalidates retained attribution before saving a result', async ({ page }) => {
  await page.goto('/guide.html');
  await page.evaluate(() => {
    const now = Date.now();
    sessionStorage.setItem('promptlab_landing_attribution', JSON.stringify({
      version: 1,
      events: [
        {
          event: 'landing.cta_clicked',
          placement: 'hero',
          intent: 'free',
          destination: 'app',
          timestamp: now - 1_000,
          prompt: 'guide prompt poison',
          email: 'guide-poison@example.com',
          url: 'https://guide-tracker.invalid/private',
        },
        {
          event: 'landing.unknown',
          placement: 'docs_search',
          destination: 'guide',
          resultCount: 1,
          timestamp: now,
          searchTerm: 'clipboard',
        },
      ],
    }));
  });

  await page.locator('#docs-search-input').fill('clipboard');
  await page.locator('#docs-search-list .search-result-link').click();
  await expect(page).toHaveURL(/#variables$/);

  const stored = await page.evaluate(() => sessionStorage.getItem('promptlab_landing_attribution'));
  expect(stored).not.toContain('guide prompt poison');
  expect(stored).not.toContain('guide-poison@example.com');
  expect(stored).not.toContain('guide-tracker.invalid');
  expect(stored).not.toContain('clipboard');

  const payload = JSON.parse(stored);
  expect(payload.events).toHaveLength(2);
  expect(payload.events[0]).toMatchObject({
    event: 'landing.cta_clicked',
    placement: 'hero',
    intent: 'free',
    destination: 'app',
  });
  expect(Object.keys(payload.events[0]).sort()).toEqual([
    'destination',
    'event',
    'intent',
    'placement',
    'timestamp',
  ]);
  expect(payload.events[1]).toMatchObject({
    event: 'landing.docs_result_selected',
    placement: 'docs_search',
    intent: 'open',
    destination: 'guide',
    resultCount: 1,
  });
});
