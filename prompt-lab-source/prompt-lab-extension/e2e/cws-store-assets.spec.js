// Generates Chrome Web Store listing assets from a packaged build.
//
//   CWS_BUILD_DIR=<unpacked build dir> npx playwright test e2e/cws-store-assets.spec.js
//
// Reaches UI states by role/placeholder (the packaged v1.7.0 build has no
// data-testids), so it does not depend on the provider message contract.
// Each side-panel capture is composited onto a branded 1280x800 canvas so the
// listing images read as a product, not a half-empty side panel. Outputs to
// ../../store-assets/cws/. No API key or network involved.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect, test } from '@playwright/test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = process.env.CWS_BUILD_DIR
  ? path.resolve(process.env.CWS_BUILD_DIR)
  : path.resolve(__dirname, '..', 'dist');
const outDir = path.resolve(__dirname, '..', '..', '..', 'store-assets', 'cws');
const PANEL = { width: 720, height: 800 };

function ensureOut() {
  fs.mkdirSync(outDir, { recursive: true });
  return outDir;
}

// Composite a raw panel PNG (buffer) onto a branded 1280x800 canvas.
async function frame(context, pngBuffer, caption, outName) {
  const dataUri = `data:image/png;base64,${pngBuffer.toString('base64')}`;
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;width:1280px;height:800px;overflow:hidden;
      font-family:'Segoe UI',system-ui,sans-serif;
      background:radial-gradient(1200px 700px at 78% -8%, #1c2c5a 0%, #0b1020 55%, #070b17 100%);}
    .wrap{width:1280px;height:800px;display:flex;align-items:center;gap:56px;padding:0 72px;box-sizing:border-box}
    .copy{flex:0 0 380px;color:#eef2ff}
    .kicker{font-size:13px;letter-spacing:.16em;text-transform:uppercase;color:#8ea0d8;font-weight:600;margin:0 0 14px}
    .copy h2{font-size:34px;line-height:1.15;font-weight:650;letter-spacing:-.02em;margin:0 0 16px}
    .copy p{font-size:16px;line-height:1.55;color:#aab6dd;margin:0}
    .shot{flex:1;display:flex;justify-content:center}
    .device{border-radius:16px;overflow:hidden;box-shadow:0 30px 80px -20px rgba(0,0,0,.7),0 0 0 1px rgba(255,255,255,.06);
      max-height:720px}
    .device img{display:block;height:720px;width:auto}
  </style></head><body><div class="wrap">
    <div class="copy"><p class="kicker">Prompt Lab</p><h2>${caption.title}</h2><p>${caption.body}</p></div>
    <div class="shot"><div class="device"><img src="${dataUri}" alt=""></div></div>
  </div></body></html>`);
  await page.waitForTimeout(350);
  await page.screenshot({ path: path.join(ensureOut(), outName) });
  await page.close();
}

async function launch() {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-lab-shots-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: true,
    viewport: PANEL,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });
  let sw = context.serviceWorkers()[0];
  if (!sw) sw = await context.waitForEvent('serviceworker');
  const extensionId = new URL(sw.url()).host;
  return { context, extensionId, userDataDir };
}

// Bounded interactions: nothing may block a screenshot to the test timeout.
// Falls back to a DOM-level click by exact text (the packaged build's tab
// controls don't all resolve via getByRole).
async function tryClick(page, names) {
  for (const name of names) {
    const b = page.getByRole('button', { name, exact: true }).first();
    try {
      if (await b.isVisible({ timeout: 600 })) {
        await b.click({ timeout: 2500 });
        await page.waitForTimeout(700);
        return name;
      }
    } catch {}
    try {
      const clicked = await page.evaluate((label) => {
        const els = Array.from(document.querySelectorAll('button, a, [role="tab"], [role="button"]'));
        const el = els.find((e) => (e.textContent || '').trim() === label && e.offsetParent !== null);
        if (el) { el.click(); return true; }
        return false;
      }, name);
      if (clicked) { await page.waitForTimeout(700); return name; }
    } catch {}
  }
  return null;
}

async function openPanel(context, extensionId) {
  const page = await context.newPage();
  await page.setViewportSize(PANEL);
  await page.goto(`chrome-extension://${extensionId}/panel.html`);
  await page.waitForTimeout(1500);
  await tryClick(page, ['Deny', 'No thanks', 'Decline', 'Dismiss']);
  return page;
}

test('capture CWS listing screenshots and promo tile', async () => {
  test.setTimeout(180_000);
  const { context, extensionId, userDataDir } = await launch();
  const captured = [];
  try {
    const page = await openPanel(context, extensionId);

    // 1 — workbench with a realistic prompt drafted (fill is best-effort)
    try {
      const input = page.locator('textarea').first();
      await input.fill(
        'Review my deploy plan and flag what could break before we push to production tonight. List risks highest-first with one mitigation each.',
        { timeout: 5000 },
      );
      await page.waitForTimeout(400);
    } catch {}
    await frame(context, await page.screenshot(), {
      title: 'Draft and refine prompts in your browser side panel',
      body: 'A focused editor with live word and character counts, right where you work. No tab-switching, no copy-paste dance.',
    }, 'screenshot-1-workbench.png');
    captured.push('screenshot-1-workbench.png');

    // 2 — Library
    const lib = await tryClick(page, ['Library']);
    await frame(context, await page.screenshot(), {
      title: 'A reusable prompt library, saved locally',
      body: 'Keep your best prompts one click away. Load replaces the draft; Copy keeps your editor intact. Everything stays on your device.',
    }, 'screenshot-2-library.png');
    captured.push('screenshot-2-library.png');

    // 3 — Experiments / Compare
    const exp = await tryClick(page, ['Experiments', 'Compare']);
    await frame(context, await page.screenshot(), {
      title: 'A/B compare across models and variants',
      body: 'Run one prompt against several providers or variations and compare the results side by side to find what actually works.',
    }, 'screenshot-3-experiments.png');
    captured.push('screenshot-3-experiments.png');

    // 4 — Notebook / Build
    const nb = await tryClick(page, ['Notebook', 'Build']);
    await frame(context, await page.screenshot(), {
      title: 'Compose and organize longer prompt workflows',
      body: 'Assemble multi-step prompts and keep your working notes beside them, all in the same local-first workspace.',
    }, 'screenshot-4-notebook.png');
    captured.push('screenshot-4-notebook.png');

    // 5 — Options / provider settings
    const opt = await context.newPage();
    await opt.setViewportSize(PANEL);
    await opt.goto(`chrome-extension://${extensionId}/options.html`);
    await opt.waitForTimeout(900);
    await frame(context, await opt.screenshot(), {
      title: 'Bring your own key — no account, no telemetry',
      body: 'Connect Anthropic, OpenAI, Gemini, OpenRouter, or a local Ollama model. Keys live in your browser storage and go straight to the provider.',
    }, 'screenshot-5-providers.png');
    captured.push('screenshot-5-providers.png');
    await opt.close();
    console.log(`[cws-assets] tabs reached: library=${lib} experiments=${exp} notebook=${nb}`);

    // Promo tile 440x280
    const logoCandidates = [
      path.resolve(extensionPath, 'icons', 'icon128.png'),
      path.resolve(__dirname, '..', 'extension', 'icons', 'icon128.png'),
      path.resolve(__dirname, '..', '..', 'prompt-lab-web', 'public', 'hero-logo.png'),
    ];
    const logo = logoCandidates.find((c) => fs.existsSync(c));
    const logoSrc = logo ? `data:image/png;base64,${fs.readFileSync(logo).toString('base64')}` : '';
    const tile = await context.newPage();
    await tile.setViewportSize({ width: 440, height: 280 });
    await tile.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
      html,body{margin:0;width:440px;height:280px;background:linear-gradient(135deg,#0b1020,#131c36 60%,#22336a);
        font-family:'Segoe UI',system-ui,sans-serif;color:#f2f5ff;display:flex;align-items:center;justify-content:center}
      .t{display:flex;flex-direction:column;align-items:center;gap:12px;text-align:center}
      .t img{width:76px;height:76px;border-radius:18px;box-shadow:0 10px 28px rgba(0,0,0,.5)}
      .mark{width:76px;height:76px;border-radius:18px;background:#6d5cff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:28px}
      h1{margin:0;font-size:31px;font-weight:650;letter-spacing:-.01em}
      p{margin:0;font-size:14px;color:#b3bfe6}
    </style></head><body><div class="t">
      ${logoSrc ? `<img src="${logoSrc}" alt="">` : '<div class="mark">PL</div>'}
      <h1>Prompt Lab</h1><p>Local-first prompt engineering workbench</p>
    </div></body></html>`);
    await tile.waitForTimeout(300);
    await tile.screenshot({ path: path.join(ensureOut(), 'promo-tile-440x280.png') });
    captured.push('promo-tile-440x280.png');
    await tile.close();

    for (const f of captured) {
      expect(fs.existsSync(path.join(outDir, f)), `${f} exists`).toBeTruthy();
    }
  } finally {
    await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
