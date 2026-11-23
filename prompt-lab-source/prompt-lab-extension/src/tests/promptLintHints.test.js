import { beforeEach, describe, expect, it } from 'vitest';
import { dismissLintHint, listPromptLint, promptLintHints, readDismissedLintHints, visibleLintIssues } from '../promptLint.js';

function memory() {
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
  };
}

describe('prompt lint hints', () => {
  it('flags a missing output format, a missing audience or role, a very long prompt, a repeated instruction, and an unresolved variable', () => {
    const repeated = 'Always answer in one paragraph of plain prose.\n';
    const text = `${repeated}${repeated}${'word '.repeat(900)}{{topic}}`;
    const ids = promptLintHints(text).map((hint) => hint.id);
    expect(ids).toEqual(expect.arrayContaining([
      'output_format',
      'audience_or_role',
      'very_long',
      'duplicated_instructions',
      'unresolved_vars',
    ]));
  });

  it('stays quiet when the format, audience, and defaults are present and the prompt is short', () => {
    const text = 'You are writing for an audience of new hires. Respond in markdown. Keep it under {{words|80}} words.';
    const ids = promptLintHints(text).map((hint) => hint.id);
    expect(ids).not.toContain('output_format');
    expect(ids).not.toContain('audience_or_role');
    expect(ids).not.toContain('very_long');
    expect(ids).not.toContain('unresolved_vars');
  });

  it('does not treat a ghost variable as unresolved', () => {
    expect(promptLintHints('Write today\'s note. The date is {{date}}.').map((hint) => hint.id)).not.toContain('unresolved_vars');
  });

  it('adds the new hints beside the original rules without dropping them', () => {
    const ids = listPromptLint('Tell me about {{topic}}.').map((issue) => issue.id);
    expect(ids).toContain('output_format');
    expect(ids).toContain('unresolved_vars');
    expect(ids.filter((id) => id === 'output_format')).toHaveLength(1);
  });
});

describe('dismissed hints', () => {
  let storage;
  beforeEach(() => { storage = memory(); });

  it('hides one hint at a time and remembers it for that prompt', () => {
    const issues = [{ id: 'very_long', message: 'long' }, { id: 'unresolved_vars', message: 'var' }];
    expect(visibleLintIssues(issues, dismissLintHint('prompt-1', 'very_long', storage)).map((issue) => issue.id)).toEqual(['unresolved_vars']);
    expect(readDismissedLintHints('prompt-1', storage)).toEqual(['very_long']);
    expect(readDismissedLintHints('prompt-2', storage)).toEqual([]);
  });
});
