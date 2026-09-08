import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const companionUrl = new URL('../../docs/companion/', import.meta.url);
const companionHtml = await readFile(new URL('index.html', companionUrl), 'utf8');
const companionScript = await readFile(new URL('app.js', companionUrl), 'utf8');
const sitemap = await readFile(new URL('../../docs/sitemap.xml', import.meta.url), 'utf8');

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
