import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getCorruptBackupKey,
  loadJson,
  loadJsonWithRecovery,
  saveJson,
  removeKey,
  setAnticipation,
} from '../lib/storage.js';

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

  it('can back up corrupted JSON before returning fallback data', () => {
    localStorage.setItem('bad-json', '{broken');

    const result = loadJsonWithRecovery('bad-json', [], { backupCorrupt: true });

    expect(result.value).toEqual([]);
    expect(result.corrupted).toBe(true);
    expect(result.backupKey).toMatch(/^bad-json:corrupt-backup:/);
    expect(localStorage.getItem(result.backupKey)).toBe('{broken');
  });

  it('creates deterministic corrupt backup keys when a timestamp is supplied', () => {
    expect(getCorruptBackupKey('pl2-library', '2026-06-28T00:00:00.000Z'))
      .toBe('pl2-library:corrupt-backup:2026-06-28T00:00:00.000Z');
  });

  it('removes keys', () => {
    saveJson('to-remove', { x: 1 });
    expect(removeKey('to-remove')).toBe(true);
    expect(loadJson('to-remove')).toBeNull();
  });

  it('does not throw when anticipation storage fails', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage unavailable');
    });

    try {
      expect(setAnticipation({ lastAccessOrder: ['entry-1'] })).toBe(false);
    } finally {
      setItem.mockRestore();
    }
  });
});
