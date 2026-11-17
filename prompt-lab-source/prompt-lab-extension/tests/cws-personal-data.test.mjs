import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CWS_FORBIDDEN_PERSONAL_DATA,
  findForbiddenPersonalData,
} from '../scripts/check-cws-personal-data.mjs';

const extensionRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('the personal-data check fails when a CWS output file contains either string', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'pl-cws-'));
  mkdirSync(path.join(root, 'assets'));
  writeFileSync(path.join(root, 'assets/panel.js'), 'const owner = "dave@promptlab.tools";');
  const emailHits = findForbiddenPersonalData(root);
  assert.equal(emailHits.length, 1);
  assert.equal(emailHits[0].needle, 'dave@promptlab.tools');

  writeFileSync(path.join(root, 'assets/panel.js'), 'ok');
  writeFileSync(path.join(root, 'seed.json'), '{"source":"Notion Workspace — Dave Robertson"}');
  const sourceHits = findForbiddenPersonalData(root);
  assert.equal(sourceHits.length, 1);
  assert.equal(sourceHits[0].needle, 'Notion Workspace — Dave Robertson');
});

test('the personal-data check passes a CWS output that has neither string', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'pl-cws-clean-'));
  writeFileSync(path.join(root, 'panel.js'), 'const source = "Prompt Lab starter library";');
  assert.deepEqual(findForbiddenPersonalData(root), []);
});

test('the personal-data check fails closed when the CWS output directory is missing', () => {
  assert.throws(
    () => findForbiddenPersonalData(path.join(tmpdir(), 'pl-cws-missing', String(Date.now()))),
    /CWS build output is missing/,
  );
});

test('extension sources that ship in the CWS build no longer contain either string', () => {
  const billing = readFileSync(path.join(extensionRoot, 'src/lib/billing.js'), 'utf8');
  const seed = readFileSync(path.join(extensionRoot, 'src/data/promptlab-seed-libraries.json'), 'utf8');
  for (const needle of CWS_FORBIDDEN_PERSONAL_DATA) {
    assert.equal(billing.includes(needle), false, needle);
    assert.equal(seed.includes(needle), false, needle);
  }
  assert.match(seed, /"source": "Prompt Lab starter library"/);
  assert.doesNotMatch(billing, /VITE_PROMPTLAB_OWNER_EMAIL/);
});
