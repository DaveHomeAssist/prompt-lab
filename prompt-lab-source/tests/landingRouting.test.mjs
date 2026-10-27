import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import test from 'node:test';

// V-05: common top-level addresses used to land on Vercel's bare NOT_FOUND
// page, whose only link pointed at vercel.com. They now go somewhere useful,
// and anything else gets an app-styled 404 with links back into Prompt Lab.
const read = (rel) => readFile(new URL(rel, import.meta.url), 'utf8');
const vercel = JSON.parse(await read('../vercel.json'));
const redirect = (source) => vercel.redirects.find((entry) => entry.source === source);
const rewrite = (source) => vercel.rewrites.find((entry) => entry.source === source);

test('sign-in style addresses go to the app (which shows sign-in when signed out)', () => {
  for (const source of ['/login', '/signin', '/sign-in', '/signup', '/sign-up']) {
    assert.equal(redirect(source)?.destination, '/app/', `${source} must redirect to /app/`);
    assert.equal(redirect(source).permanent, false);
  }
});

test('/settings and /account open the matching dialog route in the app', () => {
  assert.equal(redirect('/settings')?.destination, '/app/settings');
  assert.equal(redirect('/account')?.destination, '/app/account');
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
