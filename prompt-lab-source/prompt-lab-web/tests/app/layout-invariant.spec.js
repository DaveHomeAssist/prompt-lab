import { expect, test } from '@playwright/test';

// Phase 0 guardrail for docs/VIEWPORT_SHELL_OVERHAUL_PLAN.md.
//
// WEB-2 requires a viewport-height dashboard shell with scrolling contained in
// the active panel. `responsive-workspaces.spec.js` already forbids *horizontal*
// page overflow but nothing has ever asserted the vertical invariant, so the
// shell grew a second scrollbar on every wide surface without a single test
// noticing.
//
// The invariant: the document itself never scrolls. Any scrolling belongs to a
// panel-local region, never to `documentElement`.
//
// This spec is deliberately committed in a FAILING state for the routes listed
// in KNOWN_PAGE_SCROLL. A guard that passes before the bug is fixed proves
// nothing, so each known offender asserts that it *still* overflows. Fixing a
// route therefore fails this spec until its entry is deleted, which is what
// keeps the allowlist from rotting into a permanent exemption.

const ROUTES = [
  { id: 'write', hash: '#/', label: 'Write' },
  { id: 'library', hash: '#/library', label: 'Library' },
  { id: 'composer', hash: '#/composer', label: 'Compose' },
  { id: 'split', hash: '#/split', label: 'Dual Pane' },
  { id: 'evaluate', hash: '#/evaluate', label: 'Evaluate' },
  { id: 'compare', hash: '#/compare', label: 'Compare' },
  { id: 'scratch', hash: '#/scratch', label: 'Scratch' },
];

// 3840x1080 is the 32:9 ultrawide case WEB-3 requires us to evaluate.
const VIEWPORTS = [
  { id: 'mobile-400', width: 400, height: 860 },
  { id: 'tablet-768', width: 768, height: 900 },
  { id: 'desktop-1180', width: 1180, height: 900 },
  { id: 'desktop-1440', width: 1440, height: 900 },
  { id: 'ultrawide-3840', width: 3840, height: 1080 },
];

// Routes that scroll the document, as `<routeId>@<viewportId>`.
//
// EMPTY, and it must stay empty. At baseline fffcbb3 this held 17 of 35
// combinations; Phase A1 (bounded hosted-web shell, plus removing the
// calc(100vh - Nrem) guesses in ScratchWorkspace) released every one.
//
// Entries here assert a route STILL overflows, so this set can only shrink:
// repairing a route fails the suite until its key is deleted. Do not add a key
// to silence a new failure — a new overflow means a panel regressed, and the
// panel is what needs fixing. See docs/guardrails-guide.md.
const KNOWN_PAGE_SCROLL = new Set([]);

// A one-pixel tolerance absorbs sub-pixel rounding in Chromium's layout.
const TOLERANCE_PX = 1;

function seedLibrary(size) {
  const nowIso = new Date().toISOString();
  return Array.from({ length: size }, (_, index) => ({
    id: `layout-fixture-${index}`,
    title: `Layout fixture prompt ${index + 1}`,
    original: `Original body for layout fixture ${index + 1}.`,
    enhanced: `Enhanced body for layout fixture ${index + 1}. `.repeat(6),
    variants: [],
    notes: 'Layout invariant fixture.',
    tags: ['layout', index % 2 === 0 ? 'even' : 'odd'],
    collection: 'Layout',
    useCount: index,
    versions: [],
    testCases: [],
    createdAt: nowIso,
    updatedAt: nowIso,
    metadata: { purpose: 'Layout invariant fixture', status: 'active' },
  }));
}

function seedScratch() {
  const now = Date.now();
  return {
    revision: 1,
    activePadId: 'layout-note',
    tombstones: {},
    pads: [{
      id: 'layout-note',
      name: 'Layout invariant note',
      content: `# Layout\n\n${'Body paragraph for the layout invariant fixture.\n\n'.repeat(20)}`,
      createdAt: now,
      updatedAt: now,
      timestamp: now,
      pinned: true,
      status: 'working',
      color: 'orange',
      tags: ['layout'],
      linkedPrompts: [],
    }],
  };
}

// The panels only overflow when they hold content, so an empty library would
// make this spec pass for the wrong reason.
async function seedWorkspace(page) {
  await page.addInitScript((state) => {
    localStorage.setItem('pl2-telemetry', JSON.stringify({ consent: 'denied' }));
    localStorage.setItem('pl_telemetry_consent', 'denied');
    localStorage.setItem('pl2-billing', JSON.stringify({
      plan: 'pro',
      status: 'active',
      productName: 'Prompt Lab Pro',
    }));
    localStorage.setItem('pl2-library', JSON.stringify(state.library));
    localStorage.setItem('pl2-collections', JSON.stringify(['Layout']));
    localStorage.setItem('pl2-pads-schema-version', '4');
    localStorage.setItem('pl2-pads', JSON.stringify(state.scratch));
  }, { library: seedLibrary(24), scratch: seedScratch() });
}

async function measureVerticalOverflow(page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    return {
      scrollHeight: root.scrollHeight,
      innerHeight: window.innerHeight,
      overflow: root.scrollHeight - window.innerHeight,
    };
  });
}

// Names the deepest elements that are taller than the viewport, so a failure
// says which panel to fix instead of only that something is too tall.
async function describeOffenders(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll('*'))
    .filter((el) => el.clientHeight > 0 && el.scrollHeight > window.innerHeight)
    .slice(0, 8)
    .map((el) => `${el.tagName.toLowerCase()}.${String(el.className || '').trim().slice(0, 70) || '(no class)'} → ${el.scrollHeight}px`));
}

test.describe('app shell vertical layout invariant', () => {
  test.describe.configure({ timeout: 90_000 });

  for (const viewport of VIEWPORTS) {
    test(`the document never scrolls at ${viewport.width}x${viewport.height}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await seedWorkspace(page);

      for (const route of ROUTES) {
        await test.step(`${route.label} (${route.hash})`, async () => {
          await page.goto(`/app/${route.hash}`);
          await expect(page.getByRole('banner')).toBeVisible();
          // Let the workbench settle before measuring; a mid-render measurement
          // reports a height neither the user nor the next frame ever sees.
          await page.waitForTimeout(350);

          const key = `${route.id}@${viewport.id}`;
          const { scrollHeight, innerHeight, overflow } = await measureVerticalOverflow(page);

          if (KNOWN_PAGE_SCROLL.has(key)) {
            expect(
              overflow,
              `${key} is listed in KNOWN_PAGE_SCROLL but the document now fits `
              + `(${scrollHeight}px in ${innerHeight}px). Delete "${key}" from that set — `
              + 'the invariant is now real for this route and must stay enforced.',
            ).toBeGreaterThan(TOLERANCE_PX);
            return;
          }

          const offenders = overflow > TOLERANCE_PX ? await describeOffenders(page) : [];
          expect(
            overflow,
            `${key} scrolls the document: ${scrollHeight}px of content in a ${innerHeight}px viewport `
            + `(${overflow}px over). Scrolling belongs to a panel-local region, not to documentElement.\n`
            + `Tallest elements:\n  ${offenders.join('\n  ')}`,
          ).toBeLessThanOrEqual(TOLERANCE_PX);
        });
      }
    });
  }
});
