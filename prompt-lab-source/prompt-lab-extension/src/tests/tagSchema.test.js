import { describe, expect, it } from 'vitest';
import { normalizeTagList } from '../lib/tagSchema.js';

describe('tagSchema', () => {
  it('normalizes canonical tags case-insensitively and deduplicates', () => {
    expect(normalizeTagList([' code ', 'Code', 'CODING', 'analysis', 'ANALYTICAL'])).toEqual(['Code', 'Analysis']);
  });

  it('keeps unknown tags while trimming and deduplicating case-insensitively', () => {
    expect(normalizeTagList([' alpha ', 'Alpha', 'beta', '', null, 5])).toEqual(['alpha', 'beta']);
  });
});
