// AUD-014 / AUD-023 / AUD-024: security headers, caching and redirects that
// vercel.json must keep. Matching uses the same path-to-regexp semantics
// Vercel applies to "source" patterns closely enough for these literal and
// simple-group sources.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));

function sourceToRegExp(source) {
  // "/assets/(.*)" and "/((?!x).*)" style sources: groups are raw regex,
  // everything else is literal.
  let out = '';
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '(') {
      let depth = 0; let j = i;
      for (; j < source.length; j += 1) {
        if (source[j] === '\\') { j += 1; continue; }
        if (source[j] === '(') depth += 1;
        if (source[j] === ')') { depth -= 1; if (depth === 0) break; }
      }
      out += source.slice(i, j + 1);
      i = j;
    } else {
      out += ch.replace(/[.*+?^${}|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${out}$`);
}

function headersFor(path) {
  const result = {};
  for (const rule of config.headers || []) {
    if (!sourceToRegExp(rule.source).test(path)) continue;
    for (const { key, value } of rule.headers) result[key.toLowerCase()] = value;
  }
  return result;
}

function redirectFor(path) {
  return (config.redirects || []).find((rule) => rule.source === path);
}

const PAGES = ['/', '/app/', '/app/index.html', '/terms.html', '/privacy.html', '/guide.html', '/api/billing/checkout'];

test('every page refuses framing and sniffing (AUD-014)', () => {
  for (const path of PAGES) {
    const headers = headersFor(path);
    assert.match(headers['content-security-policy'] || '', /frame-ancestors 'none'/, `${path} CSP`);
    assert.equal(headers['x-frame-options'], 'DENY', `${path} X-Frame-Options`);
    assert.equal(headers['x-content-type-options'], 'nosniff', `${path} nosniff`);
    assert.equal(headers['referrer-policy'], 'strict-origin-when-cross-origin', `${path} Referrer-Policy`);
    assert.match(headers['permissions-policy'] || '', /camera=\(\)/, `${path} Permissions-Policy`);
  }
});

test('the header CSP only adds framing/base/object rules, so Clerk, Stripe and analytics are untouched', () => {
  const csp = headersFor('/app/')['content-security-policy'];
  const directives = csp.split(';').map((part) => part.trim().split(/\s+/)[0]).filter(Boolean).sort();
  assert.deepEqual(directives, ['base-uri', 'frame-ancestors', 'object-src']);
  // No fetch directives: the per-page <meta> CSP in app/index.html stays the
  // single place that lists script/connect/frame sources.
  assert.doesNotMatch(csp, /default-src|script-src|connect-src|frame-src|form-action/);
});

test('the legacy library bridge stays frameable by the Prompt Lab app only', () => {
  const headers = headersFor('/legacy-library-bridge.html');
  assert.equal(headers['x-frame-options'], undefined);
  assert.equal(
    headers['content-security-policy'],
    "frame-ancestors https://promptlab.tools https://www.promptlab.tools; base-uri 'self'; object-src 'none'",
  );
});

test('hashed build assets are cached immutably, pages are not (AUD-024)', () => {
  assert.equal(headersFor('/assets/index-Ab12Cd34.js')['cache-control'], 'public, max-age=31536000, immutable');
  for (const path of PAGES) assert.equal(headersFor(path)['cache-control'], undefined, path);
  assert.ok(!config.headers.some((rule) => /immutable/.test(JSON.stringify(rule)) && rule.source !== '/assets/(.*)'));
});

test('/pricing and /privacy redirect to real content (AUD-023)', () => {
  for (const path of ['/pricing', '/pricing/']) {
    assert.deepEqual(redirectFor(path), { source: path, destination: '/#pricing', permanent: false });
  }
  for (const path of ['/privacy', '/privacy/', '/privatepolicy']) {
    assert.deepEqual(redirectFor(path), { source: path, destination: '/privacy.html', permanent: true });
  }
  assert.ok(!config.rewrites.some((rule) => rule.source.startsWith('/privacy')), 'privacy must redirect, not rewrite to the stub');
});
