// AUD-014 / AUD-023 / AUD-024: security headers, caching and redirects that
// vercel.json must keep. Matching uses the same path-to-regexp semantics
// Vercel applies to "source" patterns closely enough for these literal and
// simple-group sources.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

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

function rewriteFor(path) {
  return (config.rewrites || []).find((rule) => rule.source === path);
}
const stub = (file) => readFileSync(new URL(`../prompt-lab-web/public${file}`, import.meta.url), 'utf8');

// R-39: Vercel does not apply `headers` rules to `redirects` responses (live,
// re-review 10: they sent the default HSTS without includeSubDomains, and
// each STS header replaces the cached policy). These paths are rewrites, so
// they get the headers above.
const FORMER_REDIRECTS = {
  '/privatepolicy': '/privacy.html', '/privacy': '/privacy.html', '/privacy/': '/privacy.html',
  '/pricing': '/#pricing', '/pricing/': '/#pricing',
  '/login': '/app/', '/signin': '/app/', '/sign-in': '/app/', '/signup': '/app/', '/sign-up': '/app/',
  // The app's own hash routes (what redirectAppPathToHash makes of /app/settings).
  '/settings': '/app/#/settings', '/account': '/app/#/account',
};

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

test('the companion reference page stays frameable by the same site only', () => {
  const headers = headersFor('/companion/pilot-overview.html');
  assert.equal(headers['x-frame-options'], 'SAMEORIGIN');
  assert.equal(headers['content-security-policy'], "frame-ancestors 'self'; base-uri 'self'; object-src 'none'");
  assert.equal(headers['x-content-type-options'], 'nosniff');
  // The companion shell that embeds it keeps the blanket denial.
  assert.equal(headersFor('/companion/index.html')['x-frame-options'], 'DENY');
});

test('hashed build assets are cached immutably, pages are not (AUD-024)', () => {
  assert.equal(headersFor('/assets/index-Ab12Cd34.js')['cache-control'], 'public, max-age=31536000, immutable');
  for (const path of PAGES) assert.equal(headersFor(path)['cache-control'], undefined, path);
  assert.ok(!config.headers.some((rule) => /immutable/.test(JSON.stringify(rule)) && rule.source !== '/assets/(.*)'));
});

test('/pricing and /privacy reach real content (AUD-023)', () => {
  // The privacy paths serve the policy itself (its canonical is /privacy.html),
  // never the public/privacy/ stub.
  for (const path of ['/privacy', '/privatepolicy']) {
    assert.deepEqual(rewriteFor(path), { source: path, destination: '/privacy.html' });
  }
  // #307 Codex P2: under /privacy/ the policy's relative URLs (fonts, logo,
  // nav) would resolve inside /privacy/, so that path serves the refresh stub.
  // R-41: the stub is refresh.html, not index.html. An index.html in that
  // directory is also the filesystem match for /privacy (no trailing slash).
  assert.deepEqual(rewriteFor('/privacy/'), { source: '/privacy/', destination: '/privacy/refresh.html' });
  assert.match(stub('/privacy.html'), /<link rel="canonical" href="https:\/\/promptlab\.tools\/privacy\.html">/);
  for (const path of ['/pricing', '/pricing/']) assert.equal(rewriteFor(path)?.destination, '/go/pricing.html');
});

// routing-utils getTransformedRoutes appends rewrites after `handle: filesystem`.
// With trailingSlash left unset, Vercel serves <path>/index.html for both
// /path and /path/. public/privacy/index.html was that file, so /privacy
// returned the refresh stub (Fire Watch R-41) and the rewrite to /privacy.html
// never ran. /privacy/ still rewrites to the stub: the full policy's relative
// URLs would break under that slash (#307 Codex P2).
function directoryIndex(path) {
  const bare = path.endsWith('/') ? path.slice(0, -1) : path;
  const index = new URL(`../prompt-lab-web/public${bare}/index.html`, import.meta.url);
  return existsSync(index) ? `${bare}/index.html` : null;
}

function served(path) {
  const index = directoryIndex(path);
  if (index) return { via: 'filesystem', file: index };
  const rule = rewriteFor(path);
  assert.ok(rule, `${path} has a rewrite`);
  return { via: 'rewrite', file: rule.destination };
}

test('/privacy serves the full policy; /privacy/ stays the refresh stub (R-41)', () => {
  assert.equal(config.cleanUrls, undefined, 'cleanUrls would serve privacy.html at /privacy and redirect /privacy.html away');
  assert.equal(config.trailingSlash, undefined, 'trailingSlash would redirect /privacy or /privacy/ before the rewrite');
  assert.equal(directoryIndex('/privacy'), null, 'public/privacy/index.html is served for /privacy ahead of the rewrite');

  const privacy = served('/privacy');
  assert.deepEqual(privacy, { via: 'rewrite', file: '/privacy.html' });
  const policy = stub(privacy.file);
  assert.match(policy, /<h1>Privacy Policy<\/h1>/);
  assert.match(policy, /Local-First Architecture/);
  assert.match(policy, /Prompt Lab pages do not load Vercel Web Analytics or Vercel Speed Insights\./);
  assert.doesNotMatch(policy, /http-equiv="refresh"/);

  const slashed = served('/privacy/');
  assert.deepEqual(slashed, { via: 'rewrite', file: '/privacy/refresh.html' });
  const refresh = stub(slashed.file);
  assert.match(refresh, /http-equiv="refresh" content="0; url=\.\.\/privacy\.html"/);
  assert.match(refresh, /<a href="\.\.\/privacy\.html">/);
  assert.doesNotMatch(refresh, /<h1>Privacy Policy<\/h1>/);

  assert.equal(directoryIndex('/privatepolicy'), null);
  assert.deepEqual(served('/privatepolicy'), { via: 'rewrite', file: '/privacy.html' });
});

test('former redirect paths get the security headers: no redirects, rewrites only (R-39)', () => {
  assert.deepEqual(config.redirects || [], [], 'Vercel sends redirects without the headers rules');
  for (const [path, target] of Object.entries(FORMER_REDIRECTS)) {
    const rule = rewriteFor(path);
    assert.ok(rule, `${path} is a rewrite`);
    const headers = headersFor(path);
    assert.equal(headers['strict-transport-security'], 'max-age=63072000; includeSubDomains', `${path} HSTS`);
    assert.equal(headers['x-frame-options'], 'DENY', `${path} X-Frame-Options`);
    if (rule.destination === target) continue;
    // Otherwise a no-script refresh page takes the visitor to the target.
    const html = stub(rule.destination);
    const refresh = /<meta http-equiv="refresh" content="0; url=([^"]+)">/.exec(html)?.[1];
    const resolved = new URL(refresh, `https://promptlab.tools${path}`);
    assert.equal(`${resolved.pathname}${resolved.hash}`, target, `${path} refreshes to ${target}`);
    assert.doesNotMatch(html, /<script/i);
    if (!rule.destination.startsWith('/go/')) continue;
    assert.ok(html.includes(`<a href="${target}">`), `${path} links to ${target}`);
    assert.match(html, /<meta name="robots" content="noindex,follow">/);
    assert.match(html, /<link rel="canonical" href="https:\/\/promptlab\.tools\//);
    assert.match(html, /content="default-src 'none'; base-uri 'none'; form-action 'none'"/);
  }
});

test('a rewrite served under a directory path never breaks relative URLs (#307 Codex P2)', () => {
  // Under /x/ the browser resolves relative URLs inside /x/, so the page must
  // live in that directory (for example /x/index.html).
  for (const rule of config.rewrites) {
    if (!rule.source.endsWith('/') || !rule.destination.endsWith('.html')) continue;
    // Pages generated at build time (not in public/) are left to their builders.
    if (!existsSync(new URL(`../prompt-lab-web/public${rule.destination}`, import.meta.url))) continue;
    const html = stub(rule.destination);
    const relative = [...html.matchAll(/\s(?:src|href)="([^"]+)"/g)].map((m) => m[1])
      .filter((url) => !/^(?:[a-z]+:|\/|#)/i.test(url));
    if (!relative.length) continue;
    assert.equal(rule.destination.slice(0, rule.destination.lastIndexOf('/') + 1), rule.source,
      `${rule.source} serves ${rule.destination}, whose relative URLs (${relative.slice(0, 3).join(', ')}) would break`);
  }
});

test('pages send HSTS with includeSubDomains and COOP (security pass 2026-11-01)', () => {
  for (const path of [...PAGES, '/companion/pilot-overview.html']) {
    const headers = headersFor(path);
    assert.equal(headers['strict-transport-security'], 'max-age=63072000; includeSubDomains', `${path} HSTS`);
    assert.equal(headers['cross-origin-opener-policy'], 'same-origin-allow-popups', `${path} COOP`);
  }
  // preload stays out until Dave decides to submit promptlab.tools to the
  // HSTS preload list (hard to undo once shipped in browsers).
  assert.doesNotMatch(JSON.stringify(config.headers), /preload/);
  // The framed bridge gets HSTS but no COOP (COOP has no effect in iframes).
  const bridge = headersFor('/legacy-library-bridge.html');
  assert.equal(bridge['strict-transport-security'], 'max-age=63072000; includeSubDomains');
  assert.equal(bridge['cross-origin-opener-policy'], undefined);
});

test('the retired mobile.promptlab.tools host has no rewrite and no API trust', () => {
  const hostRules = [...(config.rewrites || []), ...(config.redirects || []), ...(config.headers || [])]
    .filter(rule => (rule.has || []).some(cond => cond.type === 'host' && /mobile\.promptlab\.tools/i.test(cond.value)));
  assert.deepEqual(hostRules, []);
  for (const file of ['../api/_lib/allowedOrigins.js', '../api/_lib/hostedOwner.js', '../api/_lib/verifyClerkToken.js']) {
    assert.doesNotMatch(readFileSync(new URL(file, import.meta.url), 'utf8'), /['"`]https:\/\/mobile\.promptlab\.tools/i, file);
  }
});
