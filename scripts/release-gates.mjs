#!/usr/bin/env node
// Release gates for Prompt Lab. Run from anywhere: node scripts/release-gates.mjs
// Exit 0 = all gates pass (warnings allowed). Exit 1 = at least one gate failed.
// Gates assert verified facts about the tree; when a feature renames an
// identifier, update the matching gate in the same PR.

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const warnings = [];
const ok = (msg) => console.log(`  PASS  ${msg}`);
const fail = (msg) => { failures.push(msg); console.log(`  FAIL  ${msg}`); };
const warn = (msg) => { warnings.push(msg); console.log(`  WARN  ${msg}`); };
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

// G1 — version uniformity: every shipped surface carries the same version.
console.log('G1 version uniformity');
const VERSION_SOURCES = [
  'prompt-lab-source/package.json',
  'prompt-lab-source/prompt-lab-extension/package.json',
  'prompt-lab-source/prompt-lab-extension/public/manifest.json',
  'prompt-lab-source/prompt-lab-extension/extension/manifest.json',
  'prompt-lab-source/prompt-lab-desktop/package.json',
  'prompt-lab-source/prompt-lab-desktop/src-tauri/tauri.conf.json',
  'prompt-lab-source/prompt-lab-web/package.json',
];
const versions = new Map();
for (const rel of VERSION_SOURCES) {
  try {
    versions.set(rel, JSON.parse(read(rel)).version || '(missing)');
  } catch (e) {
    versions.set(rel, `(unreadable: ${e.message})`);
  }
}
const cargo = read('prompt-lab-source/prompt-lab-desktop/src-tauri/Cargo.toml')
  .match(/^version\s*=\s*"([^"]+)"/m);
versions.set('prompt-lab-source/prompt-lab-desktop/src-tauri/Cargo.toml', cargo ? cargo[1] : '(missing)');
const distinct = new Set(versions.values());
if (distinct.size === 1 && !String([...distinct][0]).startsWith('(')) {
  ok(`all ${versions.size} version declarations agree at ${[...distinct][0]}`);
} else {
  fail('version declarations disagree:');
  for (const [rel, v] of versions) console.log(`          ${v}  ${rel}`);
}

// G2 — no @upstash SDK dependency (Redis is reached over REST via env vars only).
console.log('G2 dependency hygiene');
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'target', '_archive']);
const pkgFiles = [];
(function walk(dir) {
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(join(dir, entry.name));
    } else if (entry.name === 'package.json') {
      pkgFiles.push(join(dir, entry.name));
    }
  }
})('.');
const upstashHits = pkgFiles.filter((rel) => {
  try {
    const pkg = JSON.parse(read(rel));
    return Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })
      .some((name) => name.startsWith('@upstash'));
  } catch { return false; }
});
if (upstashHits.length === 0) ok(`no @upstash dependency in ${pkgFiles.length} package.json files`);
else fail(`@upstash dependency found in: ${upstashHits.join(', ')}`);

// G3 — telemetry stays strictly opt-in (default off).
console.log('G3 telemetry opt-in default');
const telemetrySrc = read('prompt-lab-source/prompt-lab-extension/src/lib/telemetry.js');
const defaultBlock = telemetrySrc.match(/createDefaultTelemetryState\(\)\s*{[\s\S]*?return\s*{[\s\S]*?}/);
if (defaultBlock && /telemetryEnabled:\s*false/.test(defaultBlock[0])) {
  ok('createDefaultTelemetryState() sets telemetryEnabled: false');
} else {
  fail('telemetry.js default state no longer sets telemetryEnabled: false');
}

// G4 — telemetry stays disclosed in the privacy policy.
console.log('G4 privacy policy disclosure');
const policy = read('prompt-lab-source/prompt-lab-extension/PRIVACY_POLICY.md');
if (/^##\s+Telemetry/m.test(policy)) ok('PRIVACY_POLICY.md has a Telemetry section');
else fail('PRIVACY_POLICY.md no longer discloses telemetry');

// G5 — chain data survives library normalization (metadata.chain round trip).
console.log('G5 chain schema round trip');
try {
  const schemaUrl = pathToFileURL(join(ROOT, 'prompt-lab-source/prompt-lab-extension/src/lib/promptSchema.js'));
  const chainUrl = pathToFileURL(join(ROOT, 'prompt-lab-source/prompt-lab-extension/src/lib/chainSchema.js'));
  const { normalizeLibrary } = await import(schemaUrl);
  const { isChainEntry } = await import(chainUrl);
  const chain = { version: 1, steps: [{ label: 'Step', template: 'refine {{prev}}' }] };
  const [entry] = normalizeLibrary([{ id: 'gate', title: 'Gate', enhanced: 'body', metadata: { chain } }]);
  if (entry && isChainEntry(entry) && JSON.stringify(entry.metadata.chain) === JSON.stringify(chain)) {
    ok('normalizeLibrary preserves metadata.chain and isChainEntry accepts it');
  } else {
    fail('metadata.chain was altered or dropped by normalizeLibrary');
  }
} catch (e) {
  fail(`chain round-trip could not run: ${e.message}`);
}

// W1 — open decision from 2026-08-05: remove the Pages custom domain from main.
console.log('W1 pages custom domain');
if (existsSync(join(ROOT, 'docs/CNAME'))) {
  warn('docs/CNAME still present — the 2026-08-05 decision to drop the Pages custom domain is unexecuted (see RELEASE_GATES.md)');
} else {
  ok('docs/CNAME removed');
}

console.log('');
if (failures.length) {
  console.log(`${failures.length} gate(s) FAILED, ${warnings.length} warning(s).`);
  process.exit(1);
}
console.log(`All gates passed, ${warnings.length} warning(s).`);
