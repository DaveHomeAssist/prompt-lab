// S-06 / S-24: two-origin browser proof for the www -> apex Library migration.
// The dev server's pages are served at the real production origins through
// request interception, so the browser applies its real storage rules:
// www.promptlab.tools is same-site with the apex (unpartitioned storage in
// its iframe), prompt-lab-tawny.vercel.app is cross-site (partitioned).
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const APEX = 'https://promptlab.tools';
const WWW = 'https://www.promptlab.tools';
const TAWNY = 'https://prompt-lab-tawny.vercel.app';
const BRIDGE = '/legacy-library-bridge.html';
const vercel = JSON.parse(readFileSync(new URL('../../../vercel.json', import.meta.url), 'utf8'));
const bridgeHeaders = Object.fromEntries(vercel.headers.find((rule) => rule.source === BRIDGE).headers.map(({ key, value }) => [key, value]));

// Playwright's Chromium defaults pass --disable-features=...,ThirdPartyStoragePartitioning,...
// (microsoft/playwright#32230), which turns off the storage partitioning every
// real Chrome user has. Chrome reads only the last --disable-features switch, so
// this replaces that list and restores Chrome's default partitioning. The
// test asserts partitioning is really on (see S-24) rather than trusting this.
test.use({ launchOptions: { args: ['--disable-features=MediaRouter'] } });

const prompt = (id, title) => ({ id, title, original: `${title} body`, enhanced: `${title} body`, tags: [], collection: '',
  createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', versions: [], variants: [] });

async function serveProductionOrigins(context, baseURL) {
  for (const origin of [APEX, WWW, TAWNY]) {
    await context.route(`${origin}/**`, async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.startsWith('/api/')) return route.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
      const response = await route.fetch({ url: `${baseURL}${url.pathname}${url.search}` });
      const headers = { ...response.headers() };
      // The deployed bridge carries its vercel.json headers (frame-ancestors).
      if (url.pathname === BRIDGE) Object.assign(headers, Object.fromEntries(Object.entries(bridgeHeaders).map(([k, v]) => [k.toLowerCase(), v])));
      return route.fulfill({ response, headers });
    });
  }
}

async function seedFirstParty(context, origin, library) {
  const page = await context.newPage();
  await page.goto(`${origin}${BRIDGE}`);
  await page.evaluate((entries) => localStorage.setItem('pl2-library', JSON.stringify(entries)), library);
  await page.close();
}

const libraryTitles = (page) => page.evaluate(() => (JSON.parse(localStorage.getItem('pl2-library') || '[]')).map((entry) => entry.title).sort());

test('apex app merges the www library into a non-empty apex library exactly once', async ({ context, baseURL }, testInfo) => {
  await serveProductionOrigins(context, baseURL);
  await context.addInitScript(() => { try { localStorage.setItem('pl_telemetry_consent', 'denied'); } catch {} });
  await seedFirstParty(context, WWW, [prompt('www-1', 'Saved on www'), prompt('shared-www', 'Saved on both')]);
  await seedFirstParty(context, APEX, [prompt('apex-1', 'Saved on apex'), prompt('shared-apex', 'Saved on both')]);

  const page = await context.newPage();
  await page.goto(`${APEX}/app/#/library`);
  await expect.poll(() => libraryTitles(page), { timeout: 15_000 }).toEqual(['Saved on apex', 'Saved on both', 'Saved on www']);
  await expect(page.getByText('Recovered 1 prompts from www.promptlab.tools.')).toBeVisible();
  await expect(page.getByText('Saved on www').first()).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('pl2-legacy-web-library-checked:www'))).toBe('true');
  await page.screenshot({ path: testInfo.outputPath('www-migration-merged.png') });

  // A second load neither asks www again nor duplicates anything.
  const bridgeRequests = [];
  page.on('request', (request) => { if (request.url() === `${WWW}${BRIDGE}`) bridgeRequests.push(request.url()); });
  await page.reload();
  await expect(page.getByText('Saved on www').first()).toBeVisible();
  await page.waitForTimeout(3_000);
  expect(await libraryTitles(page)).toEqual(['Saved on apex', 'Saved on both', 'Saved on www']);
  expect(bridgeRequests).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('www-migration-second-load.png') });
});

test('www itself never frames its own bridge, and the apex bridge stays silent', async ({ context, baseURL }) => {
  await serveProductionOrigins(context, baseURL);
  const page = await context.newPage();
  const bridgeRequests = [];
  page.on('request', (request) => { if (request.url().endsWith(BRIDGE)) bridgeRequests.push(new URL(request.url()).origin); });
  await page.goto(`${WWW}/app/#/library`);
  await page.waitForTimeout(3_000);
  expect(bridgeRequests).not.toContain(WWW);

  // The bridge served from the apex answers nobody (it would echo the apex library).
  await page.goto(`${APEX}${BRIDGE}`);
  const answered = await page.evaluate(() => new Promise((resolve) => {
    window.addEventListener('message', (event) => { if (event.data?.type === 'pl2:legacy-library-payload') resolve(true); });
    window.postMessage({ type: 'pl2:request-legacy-library' }, '*');
    setTimeout(() => resolve(false), 1_000);
  }));
  expect(answered).toBe(false);
});

// S-24: is the cross-site tawny bridge frame given its own, empty storage?
test('S-24: the tawny bridge iframe inside the apex sees partitioned (empty) storage, www sees its real storage', async ({ context, baseURL }, testInfo) => {
  await serveProductionOrigins(context, baseURL);
  await seedFirstParty(context, TAWNY, [prompt('tawny-1', 'Saved on tawny')]);
  await seedFirstParty(context, WWW, [prompt('www-1', 'Saved on www')]);
  const page = await context.newPage();
  await page.goto(`${APEX}${BRIDGE}`);
  const readFrame = async (origin) => {
    await page.evaluate((src) => new Promise((resolve) => {
      const frame = document.createElement('iframe');
      frame.src = src; frame.addEventListener('load', resolve, { once: true }); document.body.appendChild(frame);
    }), `${origin}${BRIDGE}`);
    const frame = page.frames().find((candidate) => candidate.url() === `${origin}${BRIDGE}`);
    return frame.evaluate(() => localStorage.getItem('pl2-library'));
  };
  const tawnyInFrame = await readFrame(TAWNY);
  const wwwInFrame = await readFrame(WWW);
  testInfo.annotations.push({ type: 'S-24', description: `tawny frame storage: ${tawnyInFrame === null ? 'empty' : 'has data'}; www frame storage: ${wwwInFrame === null ? 'empty' : 'has data'}` });
  expect(JSON.parse(wwwInFrame).map((entry) => entry.title)).toEqual(['Saved on www']);
  expect(tawnyInFrame).toBeNull();
  await page.evaluate(({ tawny, www, ua }) => {
    const report = document.createElement('pre');
    report.style.cssText = 'font: 16px monospace; padding: 16px; white-space: pre-wrap';
    report.textContent = `S-24 storage check in ${ua}\nTop page: ${location.origin}\n\n`
      + `tawny bridge iframe localStorage pl2-library: ${tawny === null ? 'null (separate, empty partition)' : tawny}\n\n`
      + `www bridge iframe localStorage pl2-library: ${www}`;
    document.body.prepend(report);
  }, { tawny: tawnyInFrame, www: wwwInFrame, ua: await page.evaluate(() => navigator.userAgent) });
  await page.screenshot({ path: testInfo.outputPath('s24-frames.png') });
});
