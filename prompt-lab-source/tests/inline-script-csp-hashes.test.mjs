// Security pass 2026-11-01: built pages drop script-src 'unsafe-inline' in
// favour of sha256 hashes of their inline scripts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  applyInlineScriptHashes, hashInlineScriptsInCsp, inlineScriptHashes, sha256Source,
} from '../scripts/inline-script-csp-hashes.mjs';
import { applyPreviewClerkCsp } from '../scripts/preview-clerk-csp.mjs';

const read = (rel) => readFileSync(new URL(`../prompt-lab-web/${rel}`, import.meta.url), 'utf8');
const scriptSrc = (html) => /<meta http-equiv="Content-Security-Policy" content="[^"]*?(script-src[^;"]*)/.exec(html)?.[1] || '';

test('sha256Source matches the CSP hash format', () => {
  const expected = createHash('sha256').update('alert(1)').digest('base64');
  assert.equal(sha256Source('alert(1)'), `'sha256-${expected}'`);
});

test('only executable inline scripts are hashed', () => {
  const html = '<script>a()</script><script src="/x.js"></script><script type="application/ld+json">{}</script><script type="module">b()</script>';
  assert.deepEqual(inlineScriptHashes(html), [sha256Source('a()'), sha256Source('b()')]);
});

test('script-src loses unsafe-inline and gains hashes; other directives are untouched', () => {
  const csp = "default-src 'self'; script-src 'self' 'unsafe-inline' https://clerk.promptlab.tools; style-src 'self' 'unsafe-inline'";
  const out = hashInlineScriptsInCsp(csp, ["'sha256-abc'"]);
  assert.equal(out, "default-src 'self'; script-src 'self' https://clerk.promptlab.tools 'sha256-abc'; style-src 'self' 'unsafe-inline'");
});

for (const page of ['app/index.html', 'index.html']) {
  test(`${page}: built CSP has no script-src 'unsafe-inline' and lists every inline script`, () => {
    const built = applyInlineScriptHashes(read(page));
    const directive = scriptSrc(built);
    assert.ok(directive.startsWith('script-src'), 'page keeps a script-src');
    assert.doesNotMatch(directive, /'unsafe-inline'/);
    const hashes = inlineScriptHashes(built);
    assert.ok(hashes.length > 0);
    for (const hash of hashes) assert.ok(directive.includes(hash), hash);
    // Re-running is stable (no duplicate hashes).
    assert.equal(applyInlineScriptHashes(built), built);
  });
}

test('/app/ keeps the production Clerk, Turnstile and GTM script hosts and the legacy bridge frame', () => {
  const built = applyInlineScriptHashes(read('app/index.html'));
  for (const host of ['https://clerk.promptlab.tools', 'https://challenges.cloudflare.com', 'https://www.googletagmanager.com']) {
    assert.ok(scriptSrc(built).includes(host), host);
  }
  assert.match(built, /frame-src 'self' https:\/\/challenges\.cloudflare\.com https:\/\/prompt-lab-tawny\.vercel\.app/);
});

test('works after the preview Clerk widening (plugin order)', () => {
  const key = `pk_test_${Buffer.from('happy-otter-12.clerk.accounts.dev$').toString('base64')}`;
  const widened = applyPreviewClerkCsp(read('app/index.html'), { VERCEL_ENV: 'preview', VITE_CLERK_PUBLISHABLE_KEY: key });
  const built = applyInlineScriptHashes(widened);
  assert.ok(scriptSrc(built).includes('https://happy-otter-12.clerk.accounts.dev'));
  assert.doesNotMatch(scriptSrc(built), /'unsafe-inline'/);
});

test('inline event-handler attributes fail the build', () => {
  const html = '<meta http-equiv="Content-Security-Policy" content="script-src \'self\' \'unsafe-inline\'"><button onclick="x()">x</button>';
  assert.throws(() => applyInlineScriptHashes(html), /Inline event-handler/);
});
