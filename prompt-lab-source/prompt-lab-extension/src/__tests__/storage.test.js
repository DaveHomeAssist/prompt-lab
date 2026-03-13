import { describe, it, expect, beforeEach } from 'vitest';
import { loadJson, saveJson, removeKey } from '../lib/storage.js';

beforeEach(() => {
  while (localStorage.length > 0) {
    localStorage.removeItem(localStorage.key(0));
  }
});

describe('storage round-trip', () => {
  it('saves and loads JSON', () => {
    const data = { items: [1, 2, 3], label: 'test' };
    expect(saveJson('test-key', data)).toBe(true);
    expect(loadJson('test-key')).toEqual(data);
  });

  it('returns fallback for missing key', () => {
    expect(loadJson('missing', 'default')).toBe('default');
  });

  it('returns fallback for corrupted JSON', () => {
    localStorage.setItem('bad-json', '{broken');
    expect(loadJson('bad-json', [])).toEqual([]);
  });

  it('removes keys', () => {
    saveJson('to-remove', { x: 1 });
    expect(removeKey('to-remove')).toBe(true);
    expect(loadJson('to-remove')).toBeNull();
  });
});
