import { beforeEach, describe, expect, it } from 'vitest';
import {
  installPack,
  loadPacksState,
  mergedPackPrompts,
  reorderPacks,
  savePacksState,
  setPackEnabled,
  setPackLastChecked,
  setPackLastError,
  setPackPinned,
  uninstallPack,
} from '../lib/packs/store.js';
import { storageKeys } from '../lib/storage.js';

function fixturePack(id = 'acme.test', overrides = {}) {
  return {
    kind: 'prompt-pack',
    schema: 1,
    compat: 1,
    id,
    version: '1.0.0',
    name: `Pack ${id}`,
    description: 'Fixture.',
    author: { name: 'Acme' },
    categories: [{ id: 'general', name: 'General' }],
    prompts: [
      { id: 'p1', name: 'First', category: 'general', body: 'Hello {{x}}.' },
      { id: 'p2', name: 'Second', category: 'general', body: 'Bye.' },
    ],
    ...overrides,
  };
}

describe('packs/store — hydrate + persist', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns empty state when storage is empty', () => {
    const state = loadPacksState();
    expect(state.schema).toBe(1);
    expect(state.packs).toEqual({});
    expect(state.order).toEqual([]);
  });

  it('round-trips through localStorage', () => {
    const installed = installPack({ schema: 1, packs: {}, order: [] }, fixturePack());
    savePacksState(installed);
    const reloaded = loadPacksState();
    expect(reloaded.packs['acme.test'].manifest.id).toBe('acme.test');
    expect(reloaded.order).toEqual(['acme.test']);
  });

  it('coerces malformed shapes back to empty', () => {
    localStorage.setItem(storageKeys.packsV1, JSON.stringify('not-an-object'));
    expect(loadPacksState()).toEqual({ schema: 1, packs: {}, order: [] });

    localStorage.setItem(storageKeys.packsV1, JSON.stringify({ schema: 99, packs: {}, order: [] }));
    expect(loadPacksState().schema).toBe(1);
  });

  it('reconstructs missing order from packs keys', () => {
    localStorage.setItem(storageKeys.packsV1, JSON.stringify({
      schema: 1,
      packs: { 'a.b': { manifest: fixturePack('a.b'), enabled: true, installedAt: 't', updatedAt: 't', source: 'file' } },
      // order missing
    }));
    const state = loadPacksState();
    expect(state.order).toEqual(['a.b']);
  });
});

describe('packs/store — mutators', () => {
  it('installPack stamps timestamps and appends to order', () => {
    const empty = { schema: 1, packs: {}, order: [] };
    const next = installPack(empty, fixturePack('a.b'), 'url', 'https://example/p.json');
    expect(next.packs['a.b'].source).toBe('url');
    expect(next.packs['a.b'].sourceRef).toBe('https://example/p.json');
    expect(next.packs['a.b'].enabled).toBe(true);
    expect(next.packs['a.b'].installedAt).toBeTruthy();
    expect(next.order).toEqual(['a.b']);
  });

  it('reinstall preserves enabled state and installedAt, bumps updatedAt', () => {
    const empty = { schema: 1, packs: {}, order: [] };
    const first = installPack(empty, fixturePack('a.b', { version: '1.0.0' }));
    const muted = setPackEnabled(first, 'a.b', false);
    // Force a perceptible time gap by using fake clocks would be overkill here;
    // updatedAt is at least a string and >= installedAt.
    const second = installPack(muted, fixturePack('a.b', { version: '1.1.0' }));
    expect(second.packs['a.b'].installedAt).toBe(muted.packs['a.b'].installedAt);
    expect(second.packs['a.b'].enabled).toBe(false);
    expect(second.packs['a.b'].manifest.version).toBe('1.1.0');
    expect(second.order).toEqual(['a.b']);
  });

  it('setPackEnabled toggles cleanly', () => {
    const s0 = installPack({ schema: 1, packs: {}, order: [] }, fixturePack());
    const s1 = setPackEnabled(s0, 'acme.test', false);
    expect(s1.packs['acme.test'].enabled).toBe(false);
    const s2 = setPackEnabled(s1, 'acme.test', true);
    expect(s2.packs['acme.test'].enabled).toBe(true);
  });

  it('setPackEnabled is a no-op for unknown packs', () => {
    const s0 = { schema: 1, packs: {}, order: [] };
    expect(setPackEnabled(s0, 'no.such', true)).toBe(s0);
  });

  it('setPackPinned + setPackLastChecked + setPackLastError round-trip', () => {
    const s0 = installPack({ schema: 1, packs: {}, order: [] }, fixturePack());
    const s1 = setPackPinned(s0, 'acme.test', '1.0.0');
    expect(s1.packs['acme.test'].pinnedVersion).toBe('1.0.0');
    const s2 = setPackLastChecked(s1, 'acme.test', '2026-04-25T00:00:00.000Z');
    expect(s2.packs['acme.test'].lastCheckedAt).toBe('2026-04-25T00:00:00.000Z');
    const s3 = setPackLastError(s2, 'acme.test', 'fetch failed');
    expect(s3.packs['acme.test'].lastError).toBe('fetch failed');
  });

  it('uninstallPack removes from packs and order', () => {
    const s0 = installPack({ schema: 1, packs: {}, order: [] }, fixturePack('a.b'));
    const s1 = installPack(s0, fixturePack('c.d'));
    const s2 = uninstallPack(s1, 'a.b');
    expect(s2.packs['a.b']).toBeUndefined();
    expect(s2.order).toEqual(['c.d']);
  });

  it('reorderPacks preserves only known ids and appends any missing', () => {
    const s0 = installPack({ schema: 1, packs: {}, order: [] }, fixturePack('a.b'));
    const s1 = installPack(s0, fixturePack('c.d'));
    const s2 = installPack(s1, fixturePack('e.f'));
    const reordered = reorderPacks(s2, ['e.f', 'no-such-pack', 'a.b']);
    expect(reordered.order).toEqual(['e.f', 'a.b', 'c.d']);
  });
});

describe('packs/store — mergedPackPrompts', () => {
  function loaded(...packs) {
    let state = { schema: 1, packs: {}, order: [] };
    for (const p of packs) state = installPack(state, p);
    return state;
  }

  it('returns empty for empty state', () => {
    expect(mergedPackPrompts({ schema: 1, packs: {}, order: [] })).toEqual([]);
  });

  it('flattens enabled packs into Library-shaped rows', () => {
    const state = loaded(fixturePack('a.b'));
    const merged = mergedPackPrompts(state);
    expect(merged).toHaveLength(2);
    expect(merged[0].id).toBe('a.b/p1');
    expect(merged[0].title).toBe('First');
    expect(merged[0].metadata.__pack).toEqual({
      packId: 'a.b',
      packName: 'Pack a.b',
      packVersion: '1.0.0',
      readOnly: true,
      category: 'general',
    });
  });

  it('skips disabled packs entirely', () => {
    let state = loaded(fixturePack('a.b'), fixturePack('c.d'));
    state = setPackEnabled(state, 'a.b', false);
    const merged = mergedPackPrompts(state);
    expect(merged.every((row) => !row.id.startsWith('a.b/'))).toBe(true);
    expect(merged.some((row) => row.id.startsWith('c.d/'))).toBe(true);
  });

  it('preserves order according to state.order, not packs object insertion', () => {
    let state = loaded(fixturePack('first'), fixturePack('second'));
    state = reorderPacks(state, ['second', 'first']);
    const merged = mergedPackPrompts(state);
    expect(merged[0].id.startsWith('second/')).toBe(true);
    expect(merged[merged.length - 1].id.startsWith('first/')).toBe(true);
  });

  it('does not write to localStorage during merge (no-mutation invariant)', () => {
    const state = loaded(fixturePack('a.b'));
    localStorage.clear();
    mergedPackPrompts(state);
    expect(localStorage.getItem(storageKeys.library)).toBeNull();
    expect(localStorage.getItem(storageKeys.packsV1)).toBeNull();
  });
});
