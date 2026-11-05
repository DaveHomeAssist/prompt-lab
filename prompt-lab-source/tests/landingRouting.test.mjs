import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import test from 'node:test';

// V-05: common top-level addresses used to land on Vercel's bare NOT_FOUND
// page, whose only link pointed at vercel.com. They now go somewhere useful,
// and anything else gets an app-styled 404 with links back into Prompt Lab.
const read = (rel) => readFile(new URL(rel, import.meta.url), 'utf8');
const vercel = JSON.parse(await read('../vercel.json'));
const rewrite = (source) => vercel.rewrites.find((entry) => entry.source === source);
// R-39: these are rewrites to no-script refresh pages, not redirects, so they
// get the project's security headers (see vercel-headers.test.mjs).
const refreshTarget = async (source) => {
  const page = rewrite(source)?.destination;
  assert.ok(page, `${source} needs a rewrite`);
  const html = await read(`../prompt-lab-web/public${page}`);
  return /<meta http-equiv="refresh" content="0; url=([^"]+)">/.exec(html)?.[1];
};

test('sign-in style addresses go to the app (which shows sign-in when signed out)', async () => {
  for (const source of ['/login', '/signin', '/sign-in', '/signup', '/sign-up']) {
    assert.equal(await refreshTarget(source), '/app/', `${source} must go to /app/`);
  }
});

test('/settings and /account open the matching dialog route in the app', async () => {
  // The hash routes the app makes of /app/settings and /app/account.
  assert.equal(await refreshTarget('/settings'), '/app/#/settings');
  assert.equal(await refreshTarget('/account'), '/app/#/account');
});

test('a branded 404 page links back into Prompt Lab', async () => {
  const html = await read('../prompt-lab-web/public/404.html');
  assert.match(html, /<title>Page not found \| Prompt Lab<\/title>/);
  assert.match(html, /href="\/app\/"/);
  assert.match(html, /href="\/"/);
  assert.doesNotMatch(html, /vercel\.com/);
  assert.match(html, /Content-Security-Policy/);
});

test('/app path links still reach the app shell, which converts them to hash routes', async () => {
  assert.equal(rewrite('/app/(.*)')?.destination, '/app/index.html');
  await access(new URL('../prompt-lab-extension/src/lib/appPathRoute.js', import.meta.url));
  const main = await read('../prompt-lab-web/app/main-web.jsx');
  assert.match(main, /redirectAppPathToHash\(\);/);
});
