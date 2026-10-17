import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const html = readFileSync(new URL('../prompt-lab-web/index.html', import.meta.url), 'utf8');
const script = html.match(/<script id="first-visit-splash">([\s\S]*?)<\/script>/)[1];

function visit(storage, path = '/', storageError) {
  let redirected;
  const window = {
    location: { href: `https://promptlab.tools${path}`, replace: (url) => { redirected = url; } },
    get localStorage() {
      if (storageError === 'access') throw new Error('Storage blocked');
      return {
        getItem: (key) => storage.get(key) ?? null,
        setItem: (key, value) => {
          if (storageError === 'write') throw new Error('Quota exceeded');
          storage.set(key, value);
        },
      };
    },
  };
  runInNewContext(script, { window, URL });
  return redirected;
}

test('first visit shows splash, reload and subsequent visits bypass it', () => {
  const storage = new Map();
  assert.equal(visit(storage), undefined);
  assert.equal(visit(storage), 'https://promptlab.tools/app');
  assert.equal(visit(storage), 'https://promptlab.tools/app');
});

test('clearing site storage restores the splash', () => {
  const storage = new Map();
  visit(storage);
  storage.clear();
  assert.equal(visit(storage), undefined);
  assert.equal(visit(storage), 'https://promptlab.tools/app');
});

test('return redirect preserves query parameters', () => {
  const storage = new Map();
  visit(storage);
  assert.equal(visit(storage, '/?utm_source=email&upgrade=pro'),
    'https://promptlab.tools/app?utm_source=email&upgrade=pro');
});

test('deliberate landing links and splash override remain accessible', () => {
  const storage = new Map();
  visit(storage);
  assert.equal(visit(storage, '/#pricing'), undefined);
  assert.equal(visit(storage, '/?splash=1'), undefined);
  assert.equal(visit(storage), 'https://promptlab.tools/app');
});

for (const failure of ['access', 'write']) {
  test(`unavailable storage (${failure}) leaves splash usable`, () => {
    assert.equal(visit(new Map(), '/', failure), undefined);
    assert.equal(visit(new Map([['promptlab_splash_seen', '1']]), '/', failure), undefined);
  });
}
