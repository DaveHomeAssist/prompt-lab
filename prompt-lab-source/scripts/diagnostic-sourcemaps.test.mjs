import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { retainSourceMaps } from './diagnostic-sourcemaps.mjs';

test('source maps become separate artifacts, never distributed assets', () => {
  const root = mkdtempSync(join(tmpdir(), 'pl-maps-'));
  const output = join(root, 'dist'); const artifacts = join(root, 'artifacts');
  mkdirSync(join(output, 'assets'), { recursive: true });
  writeFileSync(join(output, 'assets/app.js'), 'compiled application');
  writeFileSync(join(output, 'assets/app.js.map'), 'diagnostic map');
  assert.equal(retainSourceMaps(output, artifacts), 1);
  assert.equal(existsSync(join(output, 'assets/app.js.map')), false);
  assert.equal(readFileSync(join(artifacts, 'assets/app.js.map'), 'utf8'), 'diagnostic map');
  assert.equal(readFileSync(join(output, 'assets/app.js'), 'utf8'), 'compiled application');
});
