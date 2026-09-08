import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const companionUrl = new URL('../prompt-lab-web/public/companion/', import.meta.url);
const docsCompanionUrl = new URL('../../docs/companion/', import.meta.url);
const companionHtml = await readFile(new URL('index.html', companionUrl), 'utf8');
const companionScript = await readFile(new URL('app.js', companionUrl), 'utf8');
const sitemap = await readFile(new URL('../prompt-lab-web/public/sitemap.xml', import.meta.url), 'utf8');
const vercelConfig = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));

test('generated Pages companion matches the canonical hosted source', async () => {
  for (const filename of ['index.html', 'styles.css', 'app.js', 'pilot-overview.html']) {
    const [canonical, generated] = await Promise.all([
      readFile(new URL(filename, companionUrl), 'utf8'),
      readFile(new URL(filename, docsCompanionUrl), 'utf8'),
    ]);
    assert.equal(generated, canonical, `${filename} must match the canonical hosted source`);
  }
});

test('durable companion route remains explicitly non-indexed', () => {
  assert.match(
    companionHtml,
    /<meta name="robots" content="noindex,nofollow,noarchive,nosnippet,noimageindex">/,
  );
  assert.match(
    companionHtml,
    /<meta name="googlebot" content="noindex,nofollow,noarchive,nosnippet,noimageindex">/,
  );
  assert.doesNotMatch(sitemap, /promptlab\.tools\/companion/i);
});

test('companion preserves the sandboxed reference and restrictive CSP', () => {
  assert.match(companionHtml, /connect-src 'none'/);
  assert.match(companionHtml, /frame-src 'self'/);
  assert.match(
    companionHtml,
    /<iframe src="pilot-overview\.html" sandbox="allow-scripts" referrerpolicy="no-referrer"/,
  );
});

test('companion exposes the billing readiness workspace', () => {
  assert.match(companionHtml, /id="tab-billing"[^>]*data-view="billing"/);
  assert.match(companionHtml, /id="panel-billing"[^>]*data-panel="billing"/);
  assert.match(companionHtml, /Reopen billing only when all five gates pass/);
  assert.match(companionHtml, /Restore paid calls to action last/);
  assert.match(companionScript, /billing: \{ title: "Billing", kicker: "Paid launch readiness" \}/);
});

test('Vercel serves both companion URL forms from the durable document', () => {
  const companionRewrites = vercelConfig.rewrites
    .filter(({ source }) => source === '/companion' || source === '/companion/')
    .map(({ source, destination }) => ({ source, destination }));

  assert.deepEqual(companionRewrites, [
    { source: '/companion', destination: '/companion/index.html' },
    { source: '/companion/', destination: '/companion/index.html' },
  ]);
});
