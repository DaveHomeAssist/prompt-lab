import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  getExperimentById,
  listExperiments,
  normalizeExperimentRecord,
  saveExperiment,
} from '../src/experimentStore.js';

const values = new Map();
globalThis.window = {};
globalThis.localStorage = {
  clear: () => values.clear(),
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, String(value)),
  removeItem: (key) => values.delete(key),
};

beforeEach(() => {
  localStorage.clear();
});

test('normalize applies the current experiment defaults', () => {
  const result = normalizeExperimentRecord({
    variants: [{ id: 'A', prompt: 'Write a poem', response: 'Done' }],
  });

  assert.ok(result.id);
  assert.ok(result.createdAt);
  assert.equal(result.label, 'Untitled experiment');
  assert.deepEqual(result.variants, [{ id: 'A', prompt: 'Write a poem', response: 'Done' }]);
  assert.deepEqual(result.outcome, { winnerVariantId: null });
  assert.equal(result.notes, '');
});

test('normalize preserves current arena fields and bounds the input snapshot', () => {
  const result = normalizeExperimentRecord({
    id: 'exp-1',
    createdAt: '2026-02-20T10:00:00.000Z',
    label: 'Arena: poetry',
    variants: [{ id: 'A' }, { id: 'B' }, { id: 'C' }],
    keyInputSnapshot: 'x'.repeat(2000),
    outcome: { winnerVariantId: 'C' },
    notes: 'C was strongest',
  });

  assert.equal(result.id, 'exp-1');
  assert.equal(result.variants.length, 3);
  assert.equal(result.keyInputSnapshot.length, 1200);
  assert.deepEqual(result.outcome, { winnerVariantId: 'C' });
  assert.equal(result.notes, 'C was strongest');
});

test('fallback persistence saves, retrieves, and sorts experiments', async () => {
  await saveExperiment({
    id: 'older',
    createdAt: '2026-01-15T10:00:00.000Z',
    label: 'Poetry test',
    variants: [{ id: 'A' }, { id: 'B' }],
    notes: 'first',
  });
  await saveExperiment({
    id: 'newer',
    createdAt: '2026-02-20T10:00:00.000Z',
    label: 'Code test',
    variants: [{ id: 'A' }, { id: 'B' }],
    notes: 'second',
  });

  const records = await listExperiments();
  assert.deepEqual(records.map((record) => record.id), ['newer', 'older']);
  assert.equal((await getExperimentById('older'))?.label, 'Poetry test');
});

test('fallback history filters by search and inclusive date bounds', async () => {
  await saveExperiment({ id: 'jan', createdAt: '2026-01-15T10:00:00.000Z', label: 'Poetry test', notes: 'good' });
  await saveExperiment({ id: 'feb', createdAt: '2026-02-20T10:00:00.000Z', label: 'Code test', notes: 'needs work' });
  await saveExperiment({ id: 'mar', createdAt: '2026-03-01T10:00:00.000Z', label: 'Summary test' });

  assert.deepEqual((await listExperiments({ search: 'NEEDS WORK' })).map((row) => row.id), ['feb']);
  assert.deepEqual(
    (await listExperiments({ dateFrom: '2026-02-01', dateTo: '2026-02-28' })).map((row) => row.id),
    ['feb'],
  );
});

test('fallback persistence replaces an existing experiment ID', async () => {
  await saveExperiment({ id: 'same', label: 'First' });
  await saveExperiment({ id: 'same', label: 'Updated' });

  const records = await listExperiments();
  assert.equal(records.length, 1);
  assert.equal(records[0].label, 'Updated');
});
