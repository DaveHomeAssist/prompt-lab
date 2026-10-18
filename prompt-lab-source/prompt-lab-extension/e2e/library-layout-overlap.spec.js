import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect, test } from '@playwright/test';

// Two Library layouts drew content on top of other content:
// - tile cards pinned Editor/Copy/Favorite to the bottom-right corner, outside
//   the layout, so a full card drew its date and use count under the buttons;
// - between 701 and 1100px the inspector floats over the list with an almost
//   transparent background, so its fields mixed with the prompt cards.
// Measure the rendered page instead of trusting the CSS.

const extensionPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const screenshotDir = process.env.PL_LAYOUT_SCREENSHOT_DIR || '';

function libraryEntry(id, title, text, extra = {}) {
  return {
    id, title, original: text, enhanced: text, variants: [], notes: '',
    tags: [], collection: '', useCount: 0, versions: [], testCases: [],
    createdAt: '2026-10-14T12:00:00Z', updatedAt: '2026-10-14T12:00:00Z', metadata: {},
    ...extra,
  };
}

const longText = 'Review the attached release notes and write a summary for customers that covers new features, fixes, '
  + 'breaking changes, migration steps and known issues, in plain language with one short paragraph per section.';

const entries = [
  libraryEntry('tile-full', 'Customer release summary with migration notes', longText, {
    tags: ['release', 'customers', 'summary', 'docs'], collection: 'Operations', favorite: true,
    versions: [{ id: 'v1' }, { id: 'v2' }],
  }),
  libraryEntry('tile-short', 'Short prompt', 'Summarize this.'),
  // Mirrors the production cards whose labels wrap onto three lines.
  libraryEntry('tile-tags', 'Resume the bounded closeout', longText, {
    collection: 'Extracted Log Prompts', tags: ['Extracted', 'Logs', 'av-by-dave'], useCount: 12,
  }),
];

const overlaps = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

async function withLibrary({ width, layout, mode = 'dark' }, run) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'promptlab-library-layout-'));
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  try {
    await context.addInitScript((seed) => {
      localStorage.setItem('pl2-telemetry', JSON.stringify({ consent: 'denied' }));
      localStorage.setItem('pl_telemetry_consent', 'denied');
      localStorage.setItem('pl2-library', JSON.stringify(seed.entries));
      localStorage.setItem('pl2-collections', JSON.stringify(['Operations']));
      localStorage.setItem('pl2-library-layout', JSON.stringify(seed.layout));
      localStorage.setItem('pl2-mode', JSON.stringify(seed.mode));
    }, { entries, layout, mode });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const page = await context.newPage();
    page.setDefaultTimeout(8000);
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(`chrome-extension://${new URL(worker.url()).host}/panel.html`);
    if (width < 720) await page.getByRole('navigation', { name: 'Primary mobile navigation' }).getByRole('button', { name: 'Library', exact: true }).click();
    else await page.getByRole('tablist', { name: 'Workspaces' }).getByRole('tab', { name: 'Library', exact: true }).click();
    await expect(page.getByRole('button', { name: layout === 'tiles' ? 'Tile view' : 'List view' })).toHaveAttribute('aria-pressed', 'true');
    await run(page);
  } finally {
    await context.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

// 2000px with the inspector open reproduces the narrow seven-column grid.
for (const { width, inspect } of [{ width: 400 }, { width: 768 }, { width: 1180 }, { width: 1440 }, { width: 2000, inspect: true }]) {
  test(`Library tile cards keep actions clear of their text at ${width}px${inspect ? ' with the inspector open' : ''}`, async () => {
    await withLibrary({ width, layout: 'tiles' }, async (page) => {
      const cards = page.locator('.pl-library-results.is-tiles .pl-library-card');
      await expect(cards).toHaveCount(entries.length);
      if (inspect) {
        await page.getByRole('button', { name: `Inspect ${entries[1].title}` }).click();
        await expect(page.getByRole('heading', { name: entries[1].title, level: 2 })).toBeVisible();
      }
      if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, `library-tiles-${width}.png`), fullPage: true });

      for (let index = 0; index < entries.length; index += 1) {
        const card = cards.nth(index);
        const actions = await card.locator('.pl-library-card-actions').boundingBox();
        const cardBox = await card.boundingBox();
        expect(actions, `actions render for card ${index}`).not.toBeNull();
        // Every action stays inside its own card.
        expect(actions.x).toBeGreaterThanOrEqual(cardBox.x - 1);
        expect(actions.x + actions.width).toBeLessThanOrEqual(cardBox.x + cardBox.width + 1);
        expect(actions.y + actions.height).toBeLessThanOrEqual(cardBox.y + cardBox.height + 1);
        // Tiles stack the metadata under the text instead of squeezing the title.
        const copyBox = await card.locator('.pl-library-card-copy').boundingBox();
        const metaBox = await card.locator('.pl-library-card-meta').boundingBox();
        expect(metaBox.y, `${entries[index].id}: metadata sits below the text at ${width}px`).toBeGreaterThanOrEqual(copyBox.y + copyBox.height - 1);
        for (const part of ['.pl-library-card-meta', '.pl-library-card-excerpt', '.pl-library-card-labels', '.pl-library-card-title']) {
          for (const box of await card.locator(`${part}, ${part} > *`).evaluateAll((nodes) => nodes
            .map((node) => node.getBoundingClientRect())
            .filter((rect) => rect.width > 0 && rect.height > 0)
            .map(({ x, y, width: w, height: h }) => ({ x, y, width: w, height: h })))) {
            expect(overlaps(box, actions), `${entries[index].id}: ${part} overlaps the action row at ${width}px`).toBe(false);
          }
        }
      }
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, 'no horizontal page overflow').toBeLessThanOrEqual(1);
    });
  });
}

for (const mode of ['dark', 'light']) {
  test(`Library inspector covers the list it floats over at 900px (${mode})`, async () => {
    await withLibrary({ width: 900, layout: 'list', mode }, async (page) => {
      await page.getByRole('button', { name: `Inspect ${entries[0].title}` }).click();
      const inspector = page.locator('.pl-library-inspector');
      await expect(inspector.getByRole('heading', { name: entries[0].title, level: 2 })).toBeVisible();
      if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, `library-inspector-900-${mode}.png`) });
      expect(await inspector.evaluate((node) => getComputedStyle(node).position), 'inspector floats at this width').toBe('absolute');
      // Resolve the computed colour through a canvas so any colour syntax
      // (rgb, color-mix, color()) reduces to a plain alpha byte.
      const alpha = await inspector.evaluate((node) => {
        const context = document.createElement('canvas').getContext('2d');
        context.fillStyle = getComputedStyle(node).backgroundColor;
        context.fillRect(0, 0, 1, 1);
        return context.getImageData(0, 0, 1, 1).data[3];
      });
      expect(alpha, `inspector background is opaque in ${mode} mode`).toBe(255);
    });
  });
}
