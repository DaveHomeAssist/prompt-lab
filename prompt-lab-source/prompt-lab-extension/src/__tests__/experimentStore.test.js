import { beforeEach, describe, expect, it } from 'vitest';
import { listTestCases } from '../experimentStore.js';

const TEST_CASE_FALLBACK_KEY = 'pl2-test-case-fallback';

function makeTestCase(index) {
  const timestamp = new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString();
  return {
    id: `case-${index}`,
    promptId: 'prompt-1',
    title: `Case ${index}`,
    input: `Input ${index}`,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

describe('listTestCases', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns every saved case for lossless export when limit is null', async () => {
    localStorage.setItem(
      TEST_CASE_FALLBACK_KEY,
      JSON.stringify(Array.from({ length: 600 }, (_, index) => makeTestCase(index))),
    );

    await expect(listTestCases({ limit: null })).resolves.toHaveLength(600);
    await expect(listTestCases({ limit: 1000 })).resolves.toHaveLength(500);
  });
});
