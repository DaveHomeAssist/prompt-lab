import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  applyPreviewClerkCsp,
  clerkDevFrontendApiHost,
  previewClerkCsp,
} from '../scripts/preview-clerk-csp.mjs';

const appIndexPath = new URL('../prompt-lab-web/app/index.html', import.meta.url);
const otherPages = ['../prompt-lab-web/index.html', '../prompt-lab-web/mobile/index.html']
  .map((path) => new URL(path, import.meta.url));
const DEV_HOST = 'example-slug-12.clerk.accounts.dev';
const DEV_ORIGIN = `https://${DEV_HOST}`;
const devKey = (host = DEV_HOST) => `pk_test_${Buffer.from(`${host}$`).toString('base64')}`;
const liveKey = `pk_live_${Buffer.from('clerk.promptlab.tools$').toString('base64')}`;

function metaCsp(html) {
  const match = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/);
  assert.ok(match, 'app index must declare a Content Security Policy');
  return match[1];
}

function directive(csp, name) {
  const match = csp.match(new RegExp(`(?:^|;)\\s*${name}\\s([^;]*)`));
  return match ? match[1].trim().split(/\s+/) : null;
}

test('decodes only pk_test keys for *.clerk.accounts.dev hosts', () => {
  assert.equal(clerkDevFrontendApiHost(devKey()), DEV_HOST);
  assert.equal(clerkDevFrontendApiHost(liveKey), null);
  assert.equal(clerkDevFrontendApiHost(devKey('evil.example.com')), null);
  assert.equal(clerkDevFrontendApiHost(devKey('*.clerk.accounts.dev')), null);
  assert.equal(clerkDevFrontendApiHost(''), null);
  assert.equal(clerkDevFrontendApiHost(undefined), null);
});

test('production CSP is byte-for-byte unchanged and never contains the dev host', async () => {
  const html = await readFile(appIndexPath, 'utf8');
  assert.doesNotMatch(html, /clerk\.accounts\.dev/, 'source app/index.html must not carry a dev host');

  for (const env of [
    { VERCEL_ENV: 'production', VITE_CLERK_PUBLISHABLE_KEY: devKey() },
    { VERCEL_ENV: 'production', VITE_CLERK_PUBLISHABLE_KEY: liveKey },
    { VITE_CLERK_PUBLISHABLE_KEY: devKey() },
    { VERCEL_ENV: 'development', VITE_CLERK_PUBLISHABLE_KEY: devKey() },
  ]) {
    const out = applyPreviewClerkCsp(html, env);
    assert.equal(out, html, `non-preview build must not change the HTML (${JSON.stringify(env.VERCEL_ENV)})`);
    assert.doesNotMatch(metaCsp(out), /clerk\.accounts\.dev/);
  }

  const plugin = previewClerkCsp({ VERCEL_ENV: 'production', VITE_CLERK_PUBLISHABLE_KEY: devKey() });
  assert.equal(plugin.apply, 'build');
  assert.equal(plugin.transformIndexHtml(html), html);
});

test('preview CSP adds the dev Clerk host to script-src and connect-src only', async () => {
  const html = await readFile(appIndexPath, 'utf8');
  const before = metaCsp(html);
  const out = applyPreviewClerkCsp(html, { VERCEL_ENV: 'preview', VITE_CLERK_PUBLISHABLE_KEY: devKey() });
  const after = metaCsp(out);

  assert.ok(directive(after, 'script-src').includes(DEV_ORIGIN));
  assert.ok(directive(after, 'connect-src').includes(DEV_ORIGIN));
  // The production Clerk host stays allowed on previews too.
  assert.ok(directive(after, 'script-src').includes('https://clerk.promptlab.tools'));

  // Every other directive is untouched, and nothing becomes a wildcard.
  const names = (csp) => csp.split(';').map((part) => part.trim().split(/\s+/)[0]);
  assert.deepEqual(names(after), names(before));
  for (const name of names(before)) {
    if (name === 'script-src' || name === 'connect-src') {
      assert.deepEqual(directive(after, name), [...directive(before, name), DEV_ORIGIN]);
    } else {
      assert.deepEqual(directive(after, name), directive(before, name), `${name} must be unchanged`);
    }
  }
  assert.doesNotMatch(after, /https:\/\/\*\.clerk\./);

  // Only the CSP content changed.
  assert.equal(out.replace(after, ''), html.replace(before, ''));
  // Idempotent.
  assert.equal(applyPreviewClerkCsp(out, { VERCEL_ENV: 'preview', VITE_CLERK_PUBLISHABLE_KEY: devKey() }), out);
});

test('preview build with a live or missing key leaves the CSP unchanged', async () => {
  const html = await readFile(appIndexPath, 'utf8');
  assert.equal(applyPreviewClerkCsp(html, { VERCEL_ENV: 'preview', VITE_CLERK_PUBLISHABLE_KEY: liveKey }), html);
  assert.equal(applyPreviewClerkCsp(html, { VERCEL_ENV: 'preview' }), html);
});

test('preview build leaves pages that do not load Clerk unchanged', async () => {
  for (const page of otherPages) {
    const html = await readFile(page, 'utf8');
    assert.equal(
      applyPreviewClerkCsp(html, { VERCEL_ENV: 'preview', VITE_CLERK_PUBLISHABLE_KEY: devKey() }),
      html,
      `${page.pathname} must not gain the dev Clerk host`,
    );
  }
});
