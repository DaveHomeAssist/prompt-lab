import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GENERATION_STORAGE_KEY } from '../lib/generationOptions.js';

const saved = { current: null };
vi.mock('../lib/platform.js', () => ({
  sessionGet: (_key, cb) => cb(saved.current),
  sessionSet: vi.fn(),
}));

const { useSessionRestore } = await import('../hooks/useSessionState.js');

function restore(session) {
  saved.current = session;
  const setters = { setRaw: vi.fn(), setEnhanced: vi.fn(), setVariants: vi.fn(), setNotes: vi.fn(), setTab: vi.fn(), setEnhMode: vi.fn() };
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
