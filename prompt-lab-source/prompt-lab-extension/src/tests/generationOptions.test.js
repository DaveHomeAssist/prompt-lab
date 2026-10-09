import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GENERATION_OPTIONS, normalizeGenerationOptions, readGenerationOptions, writeGenerationOptions,
  resolveGenerationOptions, generationOutputBudget, buildGenerationSystemPrompt,
} from '../lib/generationOptions.js';
import { wordDiff, parseEnhancedPayload } from '../promptUtils.js';
import { normalizeResultMeta } from '../lib/enhancementResult.js';
import { createPromptEntry, normalizeEntry } from '../lib/promptSchema.js';
import { normalizeEvalRunRecord } from '../lib/evalSchema.js';
import { LINT_FIXES } from '../promptLint.js';

const reconstruct = (parts, excluded) => parts.filter(part => part.t !== excluded).map(part => part.v).join('');

describe('generation recalibration', () => {
  it('defaults to Expanded without compulsory compressed or JSON alternatives', () => {
    const options = normalizeGenerationOptions(null);
    expect(options).toEqual(DEFAULT_GENERATION_OPTIONS);
    const text = buildGenerationSystemPrompt(options, ['Code']);
    expect(text).toContain('"primary_id":"expanded"');
    expect(text).toContain('"variants":[]');
    expect(text).not.toContain('Strict JSON');
    expect(text).not.toContain('Tighter');
    expect(text).toContain('Preserve the requested ANSWER length and format');
    expect(text).toContain('Do not invent an audience');
  });
  it('combines strategy, task and destination independently', () => {
    const options = resolveGenerationOptions('expanded', { task: 'code', target: 'claude' });
    expect(options).toMatchObject({ strategy: 'expanded', task: 'code', target: 'claude' });
    const text = buildGenerationSystemPrompt(options);
    expect(text).toContain('Develop the request');
    expect(text).toContain('do not silently select a stack');
    expect(text).toContain('intended for Claude');
  });
  it('generates alternatives only when explicitly enabled', () => {
    const text = buildGenerationSystemPrompt({ ...DEFAULT_GENERATION_OPTIONS, alternatives: true });
    const contract = JSON.parse(text.split('\n').find(line => line.startsWith('{')));
    expect(contract.variants.map(item => item.id)).toEqual(['refined', 'rebuilt']);
    expect(resolveGenerationOptions('json', { alternatives: true })).toMatchObject({ strategy: 'json', alternatives: false });
    expect(resolveGenerationOptions('concise', { alternatives: true })).toMatchObject({ strategy: 'shorten', alternatives: false });
  });
  it('persists choices without overwriting on read and tolerates unavailable storage', () => {
    let value = null;
    let writes = 0;
    const storage = { getItem: () => value, setItem: (key, text) => { value = text; writes += 1; } };
    expect(readGenerationOptions(storage).strategy).toBe('expanded');
    expect(writes).toBe(0);
    expect(writeGenerationOptions({ strategy: 'rebuilt', target: 'chatgpt', budget: 8192 }, storage).ok).toBe(true);
    expect(readGenerationOptions(storage)).toMatchObject({ strategy: 'rebuilt', target: 'chatgpt', budget: 8192 });
    value = 'broken JSON';
    expect(readGenerationOptions(storage)).toEqual(DEFAULT_GENERATION_OPTIONS);
    const denied = { getItem: () => { throw new Error('Denied'); }, setItem: () => { throw new Error('Denied'); } };
    expect(readGenerationOptions(denied)).toEqual(DEFAULT_GENERATION_OPTIONS);
    expect(writeGenerationOptions({ strategy: 'refined' }, denied)).toMatchObject({ ok: false, value: { strategy: 'refined' } });
    expect(normalizeGenerationOptions({ task: 'injected', budget: -1, alternatives: 'true' })).toEqual(DEFAULT_GENERATION_OPTIONS);
  });
  it('budgets for input size and candidate count while honoring explicit limits', () => {
    expect(generationOutputBudget('Short source', DEFAULT_GENERATION_OPTIONS)).toBe(4096);
    expect(generationOutputBudget('Short source', { alternatives: true })).toBe(8192);
    expect(generationOutputBudget('x'.repeat(20000), DEFAULT_GENERATION_OPTIONS)).toBe(16384);
    expect(generationOutputBudget('x'.repeat(20000), { budget: 2048 })).toBe(2048);
  });
  it('preserves literal JSON and embedded fences and rejects an incomplete prompt', () => {
    const content = 'Return JSON using this example:\n```json\n{"answer":"exact"}\n```';
    expect(parseEnhancedPayload(JSON.stringify({ schema_version: 2, enhanced: content })).enhanced).toBe(content);
    const jsonPrompt = '{"task":"Explain the current code","format":"two sentences"}';
    expect(parseEnhancedPayload(JSON.stringify({ enhanced: jsonPrompt }), { modern: true }).enhanced).toBe(jsonPrompt);
    expect(() => parseEnhancedPayload('{"enhanced":"unfinished', { modern: true })).toThrow();
  });
  it('keeps modern identities and exact selected text through save and reload', () => {
    const resultMeta = normalizeResultMeta({ schema_version: 2, primary_id: 'expanded', selectedCandidateId: 'rebuilt', candidates: [
      { id: 'rebuilt', label: 'Rebuilt', content: 'Different execution plan.\nPreserve the supplied limits.' },
      { id: 'expanded', label: 'Expanded', content: 'Developed instructions.' },
      { id: 'refined', label: 'Refined', content: 'Clarified instructions.' },
    ] });
    expect(resultMeta.candidates.map(item => item.id)).toEqual(['rebuilt', 'expanded', 'refined']);
    const entry = createPromptEntry({ title: 'Saved selection', original: 'source', enhanced: resultMeta.candidates[0].content, resultMeta });
    const roundTrip = normalizeEntry(JSON.parse(JSON.stringify(entry)));
    expect(roundTrip.resultMeta.selectedCandidateId).toBe('rebuilt');
    expect(roundTrip.enhanced).toBe(resultMeta.candidates[0].content);
    expect(roundTrip.resultMeta.candidates).toEqual(resultMeta.candidates);
  });
  it('does not relabel or rewrite legacy candidate metadata', () => {
    const meta = normalizeResultMeta({}, { enhanced: 'Original improvement', variants: [{ content: 'Old compressed text' }, { content: '{"old":"json"}' }] });
    expect(meta.candidates.map(item => item.label)).toEqual(['Improved', 'Tighter', 'Strict JSON']);
    expect(meta).not.toHaveProperty('schemaVersion');
    expect(normalizeResultMeta(meta)).toEqual(meta);
  });
  it('scopes identical assumption text independently to each candidate', () => {
    const meta = normalizeResultMeta({ schema_version: 2, primary_id: 'expanded', assumptions: [
      { id: 'one', text: 'Same words, different candidate', added_text: 'Added context.', candidate_id: 'expanded' },
      { id: 'two', text: 'Another candidate', added_text: 'Added context.', candidate_id: 'rebuilt' },
    ] }, { enhanced: 'Expanded text' });
    expect(meta.reversibleEdits.map(edit => edit.candidateId)).toEqual(['expanded', 'rebuilt']);
  });
  it('does not inject concision or a fixed Markdown layout from lint fixes', () => {
    expect(LINT_FIXES.constraints_section).not.toContain('Keep response concise');
    expect(LINT_FIXES.constraints_section).toContain('answer length');
    expect(LINT_FIXES.output_format_section).not.toContain('Use markdown headings');
  });
  it('keeps complete budgeted run text and metadata through repeated history normalization', () => {
    const text = 'Long context. '.repeat(4000) + 'FINAL REQUIREMENT';
    const record = normalizeEvalRunRecord({ schemaVersion: 2, primaryId: 'expanded', requestedOutputTokens: 16384,
      input: text, output: text, metadataIncomplete: true,
      candidates: [{ id: 'expanded', content: text }], selectedCandidateId: 'expanded' });
    const reloaded = normalizeEvalRunRecord(JSON.parse(JSON.stringify(record)));
    expect(reloaded).toEqual(record);
    expect(reloaded.input).toBe(text);
    expect(reloaded.output).toBe(text);
    expect(reloaded.candidates[0].content).toBe(text);
    expect(reloaded.metadataIncomplete).toBe(true);
    expect(reloaded.requestedOutputTokens).toBe(16384);
  });
});

describe('complete prompt comparisons', () => {
  it('includes late edits and exactly reconstructs both long inputs', () => {
    const prefix = Array.from({ length: 1500 }, (_, index) => `word${index}`).join(' ');
    const before = `${prefix}\n\nFinal requirement: keep 1080i.\t🎛️`;
    const after = `${prefix}\n\nFinal requirement: keep 1080p.\t🎛️`;
    const parts = wordDiff(before, after);
    expect(reconstruct(parts, 'add')).toBe(before);
    expect(reconstruct(parts, 'del')).toBe(after);
    expect(parts.some(part => part.t === 'add' && part.v.includes('p'))).toBe(true);
  });
  it('preserves whitespace, line endings, tabs, Unicode and complete replacements', () => {
    for (const [before, after] of [['a\r\n\tb  c', 'a\n\tb c'], ['', 'new\ntext'], ['old', ''], ['你好 🧪', '再见 🧪']]) {
      const parts = wordDiff(before, after);
      expect(reconstruct(parts, 'add')).toBe(before);
      expect(reconstruct(parts, 'del')).toBe(after);
    }
  });
});
