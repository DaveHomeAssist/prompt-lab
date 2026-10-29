import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GENERATION_STORAGE_KEY } from '../lib/generationOptions.js';

const saved = { current: null };
vi.mock('../lib/platform.js', () => ({
  sessionGet: (_key, cb) => cb(saved.current),
  sessionSet: vi.fn(),
}));

const { useSessionRestore, hasExplicitRoute } = await import('../hooks/useSessionState.js');

function restore(session) {
  saved.current = session;
  const setters = { setRaw: vi.fn(), setEnhanced: vi.fn(), setVariants: vi.fn(), setNotes: vi.fn(), setTab: vi.fn(), setEnhMode: vi.fn(), setEditingVersionId: vi.fn() };
  renderHook(() => useSessionRestore(setters));
  return setters;
}

describe('session restore of the enhancement mode', () => {
  afterEach(() => localStorage.removeItem(GENERATION_STORAGE_KEY));

  it('turns the old Balanced default into the Expanded default instead of Refined', () => {
    expect(restore({ raw: 'Draft', enhMode: 'balanced' }).setEnhMode).toHaveBeenCalledWith('expanded');
  });

  it('follows a stored strategy preference and never resumes Shorten as the standing mode', () => {
    localStorage.setItem(GENERATION_STORAGE_KEY, JSON.stringify({ strategy: 'rebuilt' }));
    expect(restore({ enhMode: 'concise' }).setEnhMode).toHaveBeenCalledWith('rebuilt');
  });

  it('keeps an explicit modern strategy or destination mode', () => {
    expect(restore({ enhMode: 'refined' }).setEnhMode).toHaveBeenCalledWith('refined');
    expect(restore({ enhMode: 'claude' }).setEnhMode).toHaveBeenCalledWith('claude');
  });
});

describe('session restore of the workspace tab', () => {
  afterEach(() => window.history.replaceState(null, '', window.location.pathname));

  it('restores the saved tab when the panel opens without a route', () => {
    window.history.replaceState(null, '', `${window.location.pathname}#/`);
    expect(restore({ tab: 'pad' }).setTab).toHaveBeenCalledWith('pad');
  });

  it('lets a deep-linked or reloaded route win over the saved tab', () => {
    window.history.replaceState(null, '', `${window.location.pathname}#/library`);
    expect(restore({ tab: 'editor', raw: 'Draft' }).setTab).not.toHaveBeenCalled();
  });

  it('treats only non-root hash paths as explicit routes', () => {
    expect(hasExplicitRoute('')).toBe(false);
    expect(hasExplicitRoute('#/')).toBe(false);
    expect(hasExplicitRoute('#share=abc')).toBe(false);
    expect(hasExplicitRoute('#/library')).toBe(true);
    expect(hasExplicitRoute('#/split/library')).toBe(true);
  });
});

it('restores the loaded version instead of treating newer Library state as the draft base', () => {
  expect(restore({ editingId: 'prompt', editingVersionId: 'loaded-version' }).setEditingVersionId).toHaveBeenCalledWith('loaded-version');
});

it('requires an explicit reload or separate copy for older sessions without version provenance', () => {
  expect(restore({ editingId: 'prompt' }).setEditingVersionId).toHaveBeenCalledWith('unverified');
  expect(restore({ editingId: null }).setEditingVersionId).toHaveBeenCalledWith(null);
});
