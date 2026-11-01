// PRIV-07: Vercel Web Analytics and Speed Insights are not loaded by any
// Prompt Lab page, and the privacy page says so. If either is ever added, it
// must be gated behind the analytics consent choice and disclosed first; this
// test fails until both happen deliberately.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const sourceDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHIPPED_ROOTS = [
  'prompt-lab-web/public',
  'prompt-lab-web/app',
  'prompt-lab-web/mobile',
  'prompt-lab-web/index.html',
  'prompt-lab-extension/src',
  'prompt-lab-extension/public',
  'prompt-lab-extension/panel.html',
  'public',
];
const PACKAGE_FILES = ['package.json', 'prompt-lab-web/package.json', 'prompt-lab-extension/package.json'];
const VERCEL_ANALYTICS = /@vercel\/(analytics|speed-insights)|\/_vercel\/(insights|speed-insights)|va\.vercel-scripts\.com|vitals\.vercel-insights\.com/;

async function* walk(target) {
  const full = path.join(sourceDir, target);
  let entries;
  try {
    entries = await readdir(full, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOTDIR') { yield full; return; }
    if (error.code === 'ENOENT') return;
    throw error;
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const rel = path.join(target, entry.name);
    if (entry.isDirectory()) {
      if (/(__tests__|tests|e2e)$/.test(entry.name)) continue;
      yield* walk(rel);
    } else if (/\.(html|jsx?|mjs|tsx?|json)$/.test(entry.name) && !/\.test\./.test(entry.name)) {
      yield path.join(sourceDir, rel);
    }
  }
}

test('no shipped page or bundle source loads Vercel Web Analytics or Speed Insights', async () => {
  const hits = [];
  for (const root of SHIPPED_ROOTS) {
    for await (const file of walk(root)) {
      if (VERCEL_ANALYTICS.test(await readFile(file, 'utf8'))) hits.push(path.relative(sourceDir, file));
    }
  }
  assert.deepEqual(hits, []);
});

test('no package depends on @vercel/analytics or @vercel/speed-insights', async () => {
  for (const file of PACKAGE_FILES) {
    const pkg = JSON.parse(await readFile(path.join(sourceDir, file), 'utf8'));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.optionalDependencies };
    assert.equal(deps['@vercel/analytics'], undefined, `${file} must not add @vercel/analytics without consent gating`);
    assert.equal(deps['@vercel/speed-insights'], undefined, `${file} must not add @vercel/speed-insights without consent gating`);
  }
});

test('the privacy page states that Vercel Web Analytics and Speed Insights are not loaded', async () => {
  const privacy = await readFile(path.join(sourceDir, 'prompt-lab-web/public/privacy.html'), 'utf8');
  assert.match(privacy, /Prompt Lab pages do not load Vercel Web Analytics or Vercel Speed Insights\./);
});
