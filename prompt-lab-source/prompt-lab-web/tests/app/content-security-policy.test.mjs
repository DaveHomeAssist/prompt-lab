import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const appIndexPath = new URL('../../app/index.html', import.meta.url);

async function readAppCsp() {
  const html = await readFile(appIndexPath, 'utf8');
  const match = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/);
  assert.ok(match, 'app index must declare a Content Security Policy');
  return match[1];
}

function directive(csp, name) {
  const match = csp.match(new RegExp(`(?:^|;)\\s*${name}\\s([^;]*)`));
  return match ? match[1].trim() : null;
}

test('app CSP permits the configured Clerk runtime and API domain without a wildcard', async () => {
  const csp = await readAppCsp();

  assert.match(csp, /script-src[^;]*\bhttps:\/\/clerk\.promptlab\.tools\b/);
  assert.match(csp, /connect-src[^;]*\bhttps:\/\/clerk\.promptlab\.tools\b/);
  assert.doesNotMatch(csp, /https:\/\/\*\.clerk\./);
});

<<<<<<< HEAD
// M-1: the policy above passed while the sign-in surface was still unusable.
// Chromium reported three blocked directives against the 77ecf7b policy —
// worker-src (blob), img-src (https://img.clerk.com) and frame-src
// (https://challenges.cloudflare.com) — because each one silently fell back to
// `default-src 'self'`. Every requirement below is pinned to something
// @clerk/clerk-react 5.x actually does when <SignIn/> mounts.
test('app CSP declares worker-src so Clerk can start its blob worker', async () => {
  const csp = await readAppCsp();
  const workerSrc = directive(csp, 'worker-src');

  // @clerk/shared builds its session worker with
  // `new Worker(URL.createObjectURL(blob))` and warns:
  // "Cannot create worker from blob. Consider adding worker-src blob:; to your CSP".
  assert.ok(workerSrc, 'CSP must declare worker-src; default-src \'self\' blocks blob workers');
  assert.match(workerSrc, /\bblob:/);
});

test('app CSP allows the Clerk image CDN used by sign-in provider icons', async () => {
  const csp = await readAppCsp();
  const imgSrc = directive(csp, 'img-src');

  // @clerk/shared iconImageUrl() -> https://img.clerk.com/static/<id>.svg
  assert.ok(imgSrc, 'CSP must declare img-src');
  assert.match(imgSrc, /\bhttps:\/\/img\.clerk\.com\b/);
  assert.doesNotMatch(imgSrc, /https:\/\/\*\.clerk\./);
});

test('app CSP allows the Cloudflare Turnstile challenge Clerk embeds', async () => {
  const csp = await readAppCsp();
  const frameSrc = directive(csp, 'frame-src');
  const scriptSrc = directive(csp, 'script-src');

  // Clerk bot protection renders a Turnstile widget: a script plus an iframe.
  assert.ok(frameSrc, 'CSP must declare frame-src; default-src \'self\' blocks the challenge iframe');
  assert.match(frameSrc, /\bhttps:\/\/challenges\.cloudflare\.com\b/);
  assert.match(scriptSrc, /\bhttps:\/\/challenges\.cloudflare\.com\b/);
});

test('app CSP keeps its restrictive baseline', async () => {
  const csp = await readAppCsp();

  // Widening for Clerk must not relax the parts that were already tight.
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /base-uri 'self'/);
  assert.match(csp, /form-action 'self'/);
  assert.doesNotMatch(csp, /script-src[^;]*'unsafe-eval'/);
  assert.doesNotMatch(csp, /(?:^|;)\s*(?:default|script|connect|img|frame|worker)-src[^;]*\s\*(?:\s|;|$)/);
=======
test('app CSP permits Clerk blob workers and provider imagery', async () => {
  const csp = await readAppCsp();

  assert.match(csp, /worker-src[^;]*'self'/);
  assert.match(csp, /worker-src[^;]*\bblob:/);
  assert.match(csp, /img-src[^;]*\bhttps:\/\/img\.clerk\.com\b/);
>>>>>>> f3b9f1a52054b231949778e8f8bd4b3237cca746
});
