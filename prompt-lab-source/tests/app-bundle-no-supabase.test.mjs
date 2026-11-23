import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectAppBundle, supabaseReferences } from '../scripts/check-app-bundle-no-supabase.mjs';

function distWith(files) {
  const root = mkdtempSync(join(tmpdir(), 'app-bundle-'));
  for (const [name, text] of Object.entries(files)) {
    const path = join(root, name);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, text);
  }
  return root;
}

test('the /app bundle walker follows the page and its chunks', () => {
  const root = distWith({
    'app/index.html': '<script type="module" src="/assets/entry.js"></script>',
    'assets/entry.js': 'import("./workbench.js");',
    'assets/workbench.js': 'console.log("library");',
  });
  const files = collectAppBundle(root).map((path) => path.slice(root.length));
  assert.ok(files.some((path) => path.endsWith('/assets/workbench.js')));
  assert.deepEqual(supabaseReferences(root), []);
});

test('a vendor name in an app chunk fails the check', () => {
  const root = distWith({
    'app/index.html': '<script type="module" src="../assets/entry.js"></script>',
    'assets/entry.js': 'import("./sync.js");',
    'assets/sync.js': 'const host = "example.supabase.co";',
  });
  const hits = supabaseReferences(root);
  assert.equal(hits.length, 1);
  assert.match(hits[0], /sync\.js$/);
});

test('the app page must have a script', () => {
  const root = distWith({ 'app/index.html': '<p>empty</p>' });
  assert.throws(() => collectAppBundle(root), /no script/);
});
