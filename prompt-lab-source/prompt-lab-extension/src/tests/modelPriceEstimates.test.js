import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MODEL_PRICE_ESTIMATE_AS_OF,
  MODEL_PRICE_ESTIMATE_LABEL,
  describeRunEstimate,
  estimateRunCost,
} from '../../../shared/modelPriceEstimates.js';

describe('model run estimate', () => {
  it('is labelled as an estimate with a date and prices the selected model', () => {
    const source = readFileSync(path.resolve(process.cwd(), '../shared/modelPriceEstimates.js'), 'utf8');
    expect(source).not.toMatch(/from ['"].*pricing\.js['"]/);
    expect(MODEL_PRICE_ESTIMATE_AS_OF).toBe('2026-11-17');
    expect(MODEL_PRICE_ESTIMATE_LABEL).toMatch(/Estimate only, not a bill/);
    expect(MODEL_PRICE_ESTIMATE_LABEL).toContain('2026-11-17');

    const sonnet = estimateRunCost({ text: 'a'.repeat(400), model: 'claude-sonnet-4-6' });
    const mini = estimateRunCost({ text: 'a'.repeat(400), model: 'gpt-4o-mini' });
    expect(sonnet.inputTokens).toBe(100);
    expect(sonnet.assumedOutputTokens).toBe(800);
    expect(sonnet.usd).toBeGreaterThan(mini.usd);
    expect(describeRunEstimate(sonnet)).toContain('claude-sonnet-4-6');
    expect(describeRunEstimate(sonnet)).toContain(MODEL_PRICE_ESTIMATE_LABEL);

    const unknown = estimateRunCost({ text: 'Hello', model: 'custom-model' });
    expect(unknown.priced).toBe(false);
    expect(describeRunEstimate(unknown)).toContain('No local price for custom-model');
    expect(estimateRunCost({ text: 'Hello', model: 'llama3.2:3b' }).usd).toBe(0);
  });
});
