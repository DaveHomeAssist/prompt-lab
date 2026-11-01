// PRIV-08: Clerk's SDK telemetry stays off on every surface that mounts
// ClerkProvider, including Vercel previews that use the Clerk development
// instance (where Clerk collects telemetry by default).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const sourceDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOTS = ['prompt-lab-web/app', 'prompt-lab-web/mobile', 'prompt-lab-extension/src', 'prompt-lab-desktop/src'];

async function* walk(dir) {
  let entries = [];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (/\.(jsx?|tsx?|mjs)$/.test(entry.name) && !/\.test\.|__tests__|\/tests\//.test(full)) yield full;
  }
}

test('every ClerkProvider mount disables Clerk telemetry', async () => {
  const mounts = [];
  for (const root of ROOTS) {
    for await (const file of walk(path.join(sourceDir, root))) {
      const source = await readFile(file, 'utf8');
      for (const match of source.matchAll(/<ClerkProvider\b([^>]*)>/g)) {
        mounts.push({ file: path.relative(sourceDir, file), props: match[1] });
      }
    }
  }
  assert.ok(mounts.length >= 1, 'expected at least one ClerkProvider mount');
  for (const { file, props } of mounts) {
    assert.match(props, /\btelemetry=\{false\}/, `${file} must pass telemetry={false} to ClerkProvider`);
  }
});
