import { describe, expect, it } from 'vitest';
import {
  assessEnhancementQuality,
  buildEnhancementCorrectionPayload,
  combineTokenUsage,
  hasStructuralFormatChange,
  isGenericImprovementReasoning,
} from '../lib/enhancementQuality.js';

describe('enhancement quality policy', () => {
  it('rejects an exact normalized copy even when metadata claims a change', () => {
    const assessment = assessEnhancementQuality('Write a summary.', {
      enhanced: '  WRITE   A SUMMARY.  ',
      changes: [{ type: 'changed', label: 'Improved clarity' }],
      reasoning: 'Added an output format so the response structure is explicit.',
    });

    expect(assessment.passed).toBe(false);
    expect(assessment.exactNoOp).toBe(true);
    expect(assessment.failures).toContain('exact-no-op');
  });

  it('rejects a near no-op without semantic evidence', () => {
    const assessment = assessEnhancementQuality('Write a summary', {
      enhanced: 'Write a concise summary',
      changes: [],
      reasoning: 'This improves clarity.',
    });

    expect(assessment.passed).toBe(false);
    expect(assessment.changedTokenCount).toBe(1);
    expect(assessment.failures).toEqual([
      'near-no-op-no-semantic-changes',
      'near-no-op-generic-reasoning',
    ]);
  });

  it('rejects cosmetic punctuation or word-order changes despite claimed metadata', () => {
    const assessment = assessEnhancementQuality('Only return JSON', {
      enhanced: 'Return JSON only!',
      changes: [{ type: 'changed', label: 'Reordered the output instruction' }],
      reasoning: 'Reordered the output instruction so the required format is easier to identify.',
    });

    expect(assessment.passed).toBe(false);
    expect(assessment.cosmeticNoOp).toBe(true);
    expect(assessment.failures).toEqual(['cosmetic-no-op']);
  });

  it('accepts a small but concretely justified improvement', () => {
    const assessment = assessEnhancementQuality('Write a summary', {
      enhanced: 'Write a concise summary',
      changes: [{ type: 'added', label: 'Added a concise length constraint' }],
      reasoning: 'Added a length constraint so the output stays focused and predictable.',
    });

    expect(assessment.passed).toBe(true);
    expect(assessment.lowDiff).toBe(true);
  });

  it('accepts a substantive text change without relying on model metadata', () => {
    const assessment = assessEnhancementQuality('Write a summary', {
      enhanced: 'Summarize the supplied material in five bullets and end with two concrete next steps.',
      changes: [],
      reasoning: '',
    });

    expect(assessment.passed).toBe(true);
    expect(assessment.lowDiff).toBe(false);
  });

  it('recognizes structural formatting changes', () => {
    expect(hasStructuralFormatChange(
      'Summarize the text',
      'Summarize the text\n\n- Key point',
    )).toBe(true);
  });

  it('requires reasoning to name an action and execution dimension', () => {
    expect(isGenericImprovementReasoning('The prompt is already good as written.')).toBe(true);
    expect(isGenericImprovementReasoning(
      'Specified the output schema so downstream parsing has a stable format.',
    )).toBe(false);
  });

  it('builds one complete correction conversation without mutating the base payload', () => {
    const base = {
      model: 'model-1',
      system: 'Base system prompt',
      messages: [{ role: 'user', content: 'Write a summary' }],
      responseFormat: 'json',
    };
    const corrected = buildEnhancementCorrectionPayload(base, '{"enhanced":"Write a summary"}', {
      failures: ['exact-no-op'],
    });

    expect(base.messages).toHaveLength(1);
    expect(corrected.system).toContain('QUALITY CORRECTION PASS');
    expect(corrected.system).toContain('duplicated the source');
    expect(corrected.messages).toEqual([
      base.messages[0],
      { role: 'assistant', content: '{"enhanced":"Write a summary"}' },
      expect.objectContaining({ role: 'user' }),
    ]);
    expect(corrected.responseFormat).toBe('json');
  });

  it('aggregates usage across the initial and corrective calls', () => {
    expect(combineTokenUsage(
      { input_tokens: 100, output_tokens: 40 },
      { input: 140, output: 55, total: 195 },
    )).toEqual({ input: 240, output: 95, total: 335 });
    expect(combineTokenUsage()).toBeNull();
  });
});
