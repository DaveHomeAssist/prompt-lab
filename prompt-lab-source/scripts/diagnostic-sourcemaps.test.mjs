import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { diagnosticArtifactDirectory, retainSourceMaps } from './diagnostic-sourcemaps.mjs';

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

test('the default dist build keeps the surface directory and another outDir does not replace its manifest', () => {
  const root = mkdtempSync(join(tmpdir(), 'pl-maps-'));
  const dist = join(root, 'dist');
  const cws = join(root, 'dist-cws');
  mkdirSync(join(dist, 'assets'), { recursive: true });
  mkdirSync(join(cws, 'assets'), { recursive: true });
  writeFileSync(join(dist, 'assets/app.js'), 'minified application');
  writeFileSync(join(dist, 'assets/app.js.map'), 'minified map');
  writeFileSync(join(cws, 'assets/app.js'), 'review application');
  writeFileSync(join(cws, 'assets/app.js.map'), 'review map');

  const normalDir = diagnosticArtifactDirectory(root, 'rev', 'extension', dist);
  const cwsDir = diagnosticArtifactDirectory(root, 'rev', 'extension', cws);
  assert.equal(normalDir, join(root, '.diagnostic-source-maps', 'rev', 'extension'));
  assert.equal(cwsDir, join(root, '.diagnostic-source-maps', 'rev', 'extension-dist-cws'));

  assert.equal(retainSourceMaps(dist, normalDir), 1);
  assert.equal(retainSourceMaps(cws, cwsDir), 1);

  const normalManifest = JSON.parse(readFileSync(join(normalDir, 'manifest.json'), 'utf8'));
  const cwsManifest = JSON.parse(readFileSync(join(cwsDir, 'manifest.json'), 'utf8'));
  assert.equal(normalManifest.assets[0].asset, 'assets/app.js');
  assert.notEqual(normalManifest.assets[0].sha256, cwsManifest.assets[0].sha256);
  assert.equal(readFileSync(join(normalDir, 'assets/app.js.map'), 'utf8'), 'minified map');
  assert.equal(readFileSync(join(cwsDir, 'assets/app.js.map'), 'utf8'), 'review map');
});
