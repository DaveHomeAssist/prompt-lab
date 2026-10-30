import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyUniversalRuntime } from './verify-universal-runtime.mjs';

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const resource = join(desktop, 'src-tauri/library-helper');
const manifest = JSON.parse(await readFile(join(resource, 'manifest.json'), 'utf8'));
assert.equal(manifest.version, 1);
assert.equal(manifest.node, process.version);
assert.ok(manifest.files['worker.mjs']);
assert.ok(manifest.files['NODE-LICENSE']);
const files = [];
async function collect(directory, prefix = '') {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = prefix + entry.name;
    if (entry.isDirectory()) await collect(join(directory, entry.name), path + '/');
    else if (path !== 'manifest.json') files.push(path);
  }
}
await collect(resource);
assert.deepEqual(files.sort(), Object.keys(manifest.files).sort());
for (const [name, expected] of Object.entries(manifest.files)) {
  assert.equal(createHash('sha256').update(await readFile(join(resource, name))).digest('hex'), expected, name);
}
for (const [name, expected] of Object.entries(manifest.runtimes)) {
  assert.equal(createHash('sha256').update(await readFile(join(desktop, 'src-tauri/binaries', name))).digest('hex'), expected, name);
}
const suffix = process.platform === 'win32' ? '.exe' : '';
const runtime = join(desktop, 'src-tauri/binaries', `promptlab-node-${manifest.hostTarget}${suffix}`);
assert.equal(execFileSync(runtime, ['--version'], { encoding: 'utf8' }).trim(), process.version);
if (process.platform === 'darwin') {
  const universal = join(desktop, 'src-tauri/binaries/promptlab-node-universal-apple-darwin');
  verifyUniversalRuntime(universal);
  assert.equal(execFileSync(universal, ['--version'], { encoding: 'utf8' }).trim(), process.version);
}
console.log(`Verified ${files.length} helper resources and ${Object.keys(manifest.runtimes).length} runtime hashes.`);
if (process.platform === 'win32') {
  console.log('Windows folder startup remains unqualified: directory fsync fails with EPERM. Resource verification does not qualify folder activation.');
} else {
  execFileSync(runtime, ['--test', resolve(desktop, '../library-storage/service-worker.test.mjs')], {
    stdio: 'inherit', timeout: 120_000,
    env: { ...process.env, PL_TEST_LIBRARY_HELPER: join(resource, 'worker.mjs'), PL_TEST_LIBRARY_NODE: runtime },
  });
}
