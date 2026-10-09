import test from 'node:test';
import assert from 'node:assert/strict';
import { isTransientError, wordDiff } from '../src/promptUtils.js';

// Preserve the explicit 429 check while updating the old word-diff tests.
test('isTransientError: 429 is NOT transient', () => {
  assert.equal(isTransientError(new Error('429 Too Many Requests')), false);
});

test('generation diff: preserves the final constraint and exact whitespace', () => {
  const source = `${'Keep context. '.repeat(1000)}\r\n\tFinal limit: 2 sentences.`;
  const revised = source.replace('2 sentences.', '3 sentences.');
  const parts = wordDiff(source, revised);
  assert.equal(parts.filter(part => part.t !== 'add').map(part => part.v).join(''), source);
  assert.equal(parts.filter(part => part.t !== 'del').map(part => part.v).join(''), revised);
});
