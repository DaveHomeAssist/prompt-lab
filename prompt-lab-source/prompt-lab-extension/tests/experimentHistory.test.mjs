import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeExperimentRecord,
  createExperimentRecord,
  filterExperimentHistory,
} from '../src/experimentHistory.js';

// ── normalizeExperimentRecord ───────────────────────────────────────────────

test('normalize: null input returns null', () => {
  assert.equal(normalizeExperimentRecord(null), null);
});

test('normalize: non-object returns null', () => {
  assert.equal(normalizeExperimentRecord('string'), null);
  assert.equal(normalizeExperimentRecord(42), null);
});

test('normalize: missing variantMetadata returns null', () => {
  assert.equal(normalizeExperimentRecord({ id: 'x' }), null);
});

test('normalize: empty variantMetadata returns null', () => {
  assert.equal(normalizeExperimentRecord({ variantMetadata: [] }), null);
});

test('normalize: variant without id is filtered out', () => {
  const result = normalizeExperimentRecord({
    variantMetadata: [
      { id: '', name: 'bad' },
      { id: 'A', name: 'good' },
    ],
  });
  assert.ok(result);
  assert.equal(result.variantMetadata.length, 1);
  assert.equal(result.variantMetadata[0].id, 'A');
});

test('normalize: valid record gets all fields', () => {
  const r = normalizeExperimentRecord({
    id: 'exp-1',
    createdAt: '2026-01-01T00:00:00Z',
    label: 'Test exp',
    variantMetadata: [{ id: 'A', name: 'Variant A', provider: 'openai', model: 'gpt-4o' }],
    notes: 'some notes',
  });
  assert.equal(r.id, 'exp-1');
  assert.equal(r.label, 'Test exp');
  assert.equal(r.notes, 'some notes');
  assert.ok(r.createdAt);
  assert.equal(r.variantMetadata[0].provider, 'openai');
});

test('normalize: missing fields get defaults', () => {
  const r = normalizeExperimentRecord({
    variantMetadata: [{ id: 'A' }],
  });
  assert.ok(r.id);
  assert.equal(r.label, 'Untitled experiment');
  assert.equal(r.variantMetadata[0].provider, 'anthropic');
  assert.equal(r.variantMetadata[0].model, 'unknown');
});

test('normalize: truncates keyInputSnapshot to 1200 chars', () => {
  const r = normalizeExperimentRecord({
    variantMetadata: [{ id: 'A' }],
    keyInputSnapshot: 'x'.repeat(2000),
  });
  assert.equal(r.keyInputSnapshot.length, 1200);
});

test('normalize: truncates notes to 400 chars', () => {
  const r = normalizeExperimentRecord({
    variantMetadata: [{ id: 'A' }],
    notes: 'x'.repeat(600),
  });
  assert.equal(r.notes.length, 400);
});

// ── createExperimentRecord ──────────────────────────────────────────────────

test('create: produces valid record from prompts', () => {
  const r = createExperimentRecord({
    label: 'My test',
    variantA: { prompt: 'Write a poem', response: 'Roses are red', name: 'V-A' },
    variantB: { prompt: 'Write a haiku', response: 'Autumn moonlight', name: 'V-B' },
    winnerId: 'A',
    notes: 'A was better',
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
  });
  assert.ok(r.id);
  assert.ok(r.createdAt);
  assert.equal(r.label, 'My test');
  assert.equal(r.variantMetadata.length, 2);
  assert.equal(r.variantMetadata[0].name, 'V-A');
  assert.equal(r.variantMetadata[1].name, 'V-B');
  assert.equal(r.outcome, 'A');
});

test('create: uses defaults for missing names', () => {
  const r = createExperimentRecord({
    variantA: { prompt: 'a' },
    variantB: { prompt: 'b' },
  });
  assert.equal(r.variantMetadata[0].name, 'Variant A');
  assert.equal(r.variantMetadata[1].name, 'Variant B');
  assert.equal(r.label, 'A/B experiment');
});

test('create: handles undefined variants', () => {
  const r = createExperimentRecord({});
  assert.ok(r.id);
  assert.equal(r.variantMetadata[0].promptText, '');
});

test('create: keyInputSnapshot contains truncated prompts', () => {
  const r = createExperimentRecord({
    variantA: { prompt: 'A'.repeat(500), response: 'R'.repeat(500) },
    variantB: { prompt: 'B'.repeat(500), response: 'R'.repeat(500) },
  });
  const snap = JSON.parse(r.keyInputSnapshot);
  assert.ok(snap.aPrompt.length <= 280);
  assert.ok(snap.bPrompt.length <= 280);
  assert.ok(snap.aResponse.length <= 180);
});

test('create: promptHash is deterministic', () => {
  const r1 = createExperimentRecord({ variantA: { prompt: 'test' }, variantB: { prompt: 'test' } });
  const r2 = createExperimentRecord({ variantA: { prompt: 'test' }, variantB: { prompt: 'test' } });
  assert.equal(r1.variantMetadata[0].promptHash, r2.variantMetadata[0].promptHash);
});

test('create: different prompts get different hashes', () => {
  const r = createExperimentRecord({
    variantA: { prompt: 'hello' },
    variantB: { prompt: 'world' },
  });
  assert.notEqual(r.variantMetadata[0].promptHash, r.variantMetadata[1].promptHash);
});

// ── filterExperimentHistory ─────────────────────────────────────────────────

const sampleRecords = [
  {
    id: '1', createdAt: '2026-01-15T10:00:00Z', label: 'Poetry test',
    variantMetadata: [{ id: 'A', name: 'V-A', promptHash: 'h1' }],
    notes: 'good results', outcome: 'A',
  },
  {
    id: '2', createdAt: '2026-02-20T10:00:00Z', label: 'Code gen test',
    variantMetadata: [{ id: 'B', name: 'V-B', promptHash: 'h2' }],
    notes: '', outcome: 'B',
  },
  {
    id: '3', createdAt: '2026-03-01T10:00:00Z', label: 'Summary exp',
    variantMetadata: [{ id: 'A', name: 'V-A', promptHash: 'h3' }],
    notes: 'needs work', outcome: '',
  },
];

test('filter: no filters returns all sorted by date desc', () => {
  const result = filterExperimentHistory(sampleRecords);
  assert.equal(result.length, 3);
  assert.equal(result[0].id, '3');
  assert.equal(result[2].id, '1');
});

test('filter: query matches label', () => {
  const result = filterExperimentHistory(sampleRecords, { query: 'poetry' });
  assert.equal(result.length, 1);
  assert.equal(result[0].id, '1');
});

test('filter: query matches notes', () => {
  const result = filterExperimentHistory(sampleRecords, { query: 'needs work' });
  assert.equal(result.length, 1);
  assert.equal(result[0].id, '3');
});

test('filter: query matches variant name', () => {
  const result = filterExperimentHistory(sampleRecords, { query: 'V-B' });
  assert.equal(result.length, 1);
  assert.equal(result[0].id, '2');
});

test('filter: query is case-insensitive', () => {
  const result = filterExperimentHistory(sampleRecords, { query: 'CODE GEN' });
  assert.equal(result.length, 1);
});

test('filter: from date works', () => {
  const result = filterExperimentHistory(sampleRecords, { from: '2026-02-01' });
  assert.equal(result.length, 2);
});

test('filter: to date works', () => {
  const result = filterExperimentHistory(sampleRecords, { to: '2026-01-31' });
  assert.equal(result.length, 1);
  assert.equal(result[0].id, '1');
});

test('filter: from + to range works', () => {
  const result = filterExperimentHistory(sampleRecords, { from: '2026-02-01', to: '2026-02-28' });
  assert.equal(result.length, 1);
  assert.equal(result[0].id, '2');
});

test('filter: handles non-array input', () => {
  assert.deepEqual(filterExperimentHistory(null), []);
  assert.deepEqual(filterExperimentHistory('string'), []);
});

test('filter: empty query returns all', () => {
  const result = filterExperimentHistory(sampleRecords, { query: '' });
  assert.equal(result.length, 3);
});
