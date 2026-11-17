import { beforeEach, describe, expect, it } from 'vitest';
import {
  initialVariableValues,
  parsePromptVariables,
  readRecentVariables,
  rememberVariableValues,
  valuesForFill,
  variablePromptKey,
} from '../lib/promptVariables.js';

function memory() {
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
  };
}

describe('parsePromptVariables', () => {
  it('detects names and defaults, and keeps one field per name', () => {
    expect(parsePromptVariables('Hello {{name|Ada}} from {{place}} and {{name}}')).toEqual([
      { name: 'name', defaultValue: 'Ada' },
      { name: 'place', defaultValue: null },
    ]);
  });

  it('ignores a leading space and non-strings', () => {
    expect(parsePromptVariables('{{ name }}')).toEqual([]);
    expect(parsePromptVariables(null)).toEqual([]);
  });
});

describe('recent values', () => {
  let storage;
  beforeEach(() => { storage = memory(); });

  it('remembers the latest values per prompt and offers the previous ones', () => {
    const key = variablePromptKey('prompt-1', 'ignored when an id exists');
    rememberVariableValues(key, { name: 'Ada' }, storage);
    rememberVariableValues(key, { name: 'Sam' }, storage);
    expect(readRecentVariables(key, storage).name).toEqual({ last: 'Sam', recent: ['Sam', 'Ada'] });
    expect(readRecentVariables(variablePromptKey('prompt-2', 'other'), storage)).toEqual({});
    const otherDraft = variablePromptKey('', 'Hello {{name}}');
    expect(otherDraft).not.toBe(variablePromptKey('', 'Hello {{place}}'));
  });

  it('keeps going when the store rejects the write', () => {
    const key = variablePromptKey('prompt-1', '');
    const storage = { getItem: () => '{}', setItem: () => { throw new Error('quota'); } };
    expect(() => rememberVariableValues(key, { name: 'Ada' }, storage)).not.toThrow();
  });

  it('prefills from the last value, then the default', () => {
    const variables = parsePromptVariables('{{name|Ada}} {{topic}}');
    expect(initialVariableValues(variables, {})).toEqual({ name: 'Ada', topic: '' });
    expect(initialVariableValues(variables, { topic: { last: 'launch', recent: ['launch'] } })).toEqual({ name: 'Ada', topic: 'launch' });
    expect(valuesForFill(variables, { name: '', topic: 'launch' })).toEqual({ name: 'Ada', topic: 'launch' });
  });
});
