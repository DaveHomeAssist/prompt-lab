import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { checkVersions, sourceRoot, versionFiles } from './check-version-consistency.mjs';
import { bumpVersion, planVersionBump } from './bump-version.mjs';

function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'promptlab-version-'));
  try {
    for (const file of versionFiles) { mkdirSync(dirname(join(root, file)), { recursive: true }); copyFileSync(join(sourceRoot, file), join(root, file)); }
    return run(root);
  } finally { rmSync(root, { recursive: true, force: true }); }
}
test('bumps every product version without changing locked dependencies', () => fixture(root => {
  const before = JSON.parse(readFileSync(join(root, 'prompt-lab-extension/package-lock.json')));
  const old = checkVersions(root).canonical;
  const next = `${Number(old.split('.')[0]) + 1}.0.0`;
  bumpVersion(next, root); assert.deepEqual(checkVersions(root), { canonical: next, errors: [] });
  const after = JSON.parse(readFileSync(join(root, 'prompt-lab-extension/package-lock.json')));
  before.version = next; before.packages[''].version = next;
  assert.deepEqual(after, before);
}));
test('detects a mismatch in every allowlisted file', () => fixture(root => {
  const version = checkVersions(root).canonical;
  for (const file of versionFiles.filter(file => file !== 'package.json')) {
    const path = join(root, file); const original = readFileSync(path, 'utf8');
    const changed = file.endsWith('Cargo.lock') ? original.replace(/(name = "prompt-lab-desktop"\nversion = ")[^"]+/, '$199.98.97') : original.replace(version, '99.98.97');
    writeFileSync(path, changed);
    assert.ok(checkVersions(root).errors.some(error => error.startsWith(file)), file);
    writeFileSync(path, original);
  }
}));
test('invalid unchanged or lower versions never write a partial bump', () => fixture(root => {
  const original = new Map(versionFiles.map(file => [file, readFileSync(join(root, file), 'utf8')]));
  for (const input of ['', 'v2.0.0', '2.0.0-dev', '01.0.0', '0.0.0', checkVersions(root).canonical]) {
    assert.throws(() => planVersionBump(input, root));
    for (const [file, value] of original) assert.equal(readFileSync(join(root, file), 'utf8'), value);
  }
}));
test('release guard accepts only a matching stable tag', () => {
  const tag = `v${checkVersions().canonical}`;
  for (const [input, expected] of [[tag, 0], ['v99.98.97', 1], ['v1.8.0;echo bad', 1]]) {
    const result = spawnSync(process.execPath, [join(sourceRoot, 'scripts/check-release-tag.mjs'), input]);
    assert.equal(result.status, expected);
  }
});
