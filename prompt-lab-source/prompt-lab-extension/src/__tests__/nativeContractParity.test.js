import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ALL_TAGS,
  DEFAULT_ENHANCE_MAX_TOKENS,
  DEFAULT_ENHANCE_MODEL,
  DEFAULT_ENHANCE_TEMPERATURE,
  MODES,
} from '../constants.js';
import { EVAL_STATUSES } from '../lib/evalSchema.js';
import { suggestTitleFromText } from '../lib/promptSchema.js';

const contract = JSON.parse(
  readFileSync(
    resolve(process.cwd(), '../../contracts/promptlab-enhance-contract-v1.json'),
    'utf8',
  ),
);

describe('native enhance contract parity', () => {
  it('keeps provider defaults, modes, tags, and statuses canonical', () => {
    expect(contract.provider).toEqual({
      defaultModel: DEFAULT_ENHANCE_MODEL,
      maxTokens: DEFAULT_ENHANCE_MAX_TOKENS,
      temperature: DEFAULT_ENHANCE_TEMPERATURE,
    });
    expect(contract.enhance.modes).toEqual(MODES.map(({ id }) => id));
    expect(contract.enhance.tags).toEqual(ALL_TAGS);
    expect(contract.enhance.statuses).toEqual(EVAL_STATUSES);
    expect(contract.enhance.responseFields).toEqual([
      'enhanced',
      'variants',
      'notes',
      'assumptions',
      'tags',
    ]);
  });

  it.each(contract.titleCases)('keeps title suggestion parity for %#', ({ input, expected }) => {
    expect(suggestTitleFromText(input)).toBe(expected);
  });
});
