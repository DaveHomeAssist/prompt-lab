import { describe, expect, it } from 'vitest';
import { normalizeError } from '../lib/errorTaxonomy.js';

describe('stream error taxonomy', () => {
  it.each([
    'BodyStreamBuffer was aborted',
    'The response stream was terminated',
  ])('classifies an interrupted provider stream as retryable network failure: %s', (message) => {
    expect(normalizeError(new TypeError(message), 'anthropic')).toMatchObject({
      name: 'AppError',
      category: 'network',
      retryable: true,
      source: 'anthropic',
    });
  });
});
