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

test.describe('mobile navigation', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('opens from the keyboard, traps focus, closes with Escape, and returns focus', async ({ page }) => {
    await page.goto('/');

    const toggle = page.locator('#navToggle');
    const dialog = page.locator('#mobileNav');
    const main = page.locator('#main-content');

    await toggle.focus();
    await page.keyboard.press('Enter');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(dialog).toBeVisible();
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
    await expectInside(page, '#mobileNav');
    await page.keyboard.press('Tab');
    await expectInside(page, '#mobileNav');

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toBeFocused();

    await page.keyboard.press('Space');
    await expect(dialog).toBeVisible();
    await page.locator('#mobileNavClose').click();
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
    window.__landingDemoGate = { snapshots, observer };
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

  const demoStates = await page.evaluate(() => {
    window.__landingDemoGate.observer.disconnect();
    return window.__landingDemoGate.snapshots;
  });
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
});

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('shows the complete sample immediately and leaves no running reveal animation', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await expect.poll(() => page.evaluate(() => (
      matchMedia('(prefers-reduced-motion: reduce)').matches
    ))).toBe(true);

    await page.locator('#demoRun').click();
    await expect(page.locator('#demoStatus')).toContainText(/(?:Example ready|(?:Balanced|Concise|Detailed) sample ready)/i, { timeout: 750 });
    await expect(page.locator('#demoOutput')).not.toBeEmpty();

    const runningAnimations = await page.evaluate(() => (
      document.getAnimations().filter((animation) => animation.playState === 'running').length
    ));
    expect(runningAnimations).toBe(0);
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

    const hiddenRevealCount = await page.locator('.reveal').evaluateAll((elements) => (
      elements.filter((element) => {
        const style = getComputedStyle(element);
        return style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0;
      }).length
    ));
    expect(hiddenRevealCount).toBe(0);
  });
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
  await search.fill('clipboard');
  const result = page.locator('#docs-search-list .search-result-link');
  await expect(result).toHaveCount(1);
  await expect(result).toContainText('Template variables');
  await result.click();
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
