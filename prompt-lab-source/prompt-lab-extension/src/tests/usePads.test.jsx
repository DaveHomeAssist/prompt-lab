import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import usePads from '../hooks/usePads.js';
import { PADS_KEY } from '../lib/padSchema.js';

describe('usePads', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => vi.useRealTimers());

  it('debounces document saves and flushes pending content', () => {
    const { result } = renderHook(() => usePads());
    const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Pending note' }] }] };

    act(() => result.current.queueDocument(doc, 'Pending note'));
    expect(result.current.saveState).toBe('pending');

    act(() => vi.advanceTimersByTime(600));

    expect(result.current.saveState).toBe('saved');
    const saved = JSON.parse(localStorage.getItem(PADS_KEY));
    expect(saved.pads[0].plainText).toBe('Pending note');
    expect(saved.pads[0].doc).toEqual(doc);
  });

  it('flushes before switching pads', () => {
    const { result } = renderHook(() => usePads());
    let secondId;
    act(() => { secondId = result.current.createNewPad(); });
    act(() => result.current.selectPad('default'));
    const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Switch-safe' }] }] };
    act(() => result.current.queueDocument(doc, 'Switch-safe'));

    act(() => result.current.selectPad(secondId));

    const saved = JSON.parse(localStorage.getItem(PADS_KEY));
    expect(saved.pads.find((pad) => pad.id === 'default').plainText).toBe('Switch-safe');
    expect(saved.activePadId).toBe(secondId);
  });

  it('flushes pending content when the window loses focus', () => {
    const { result } = renderHook(() => usePads());
    const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Blur-safe' }] }] };
    act(() => result.current.queueDocument(doc, 'Blur-safe'));

    act(() => window.dispatchEvent(new Event('blur')));

    expect(JSON.parse(localStorage.getItem(PADS_KEY)).pads[0].plainText).toBe('Blur-safe');
  });

  it('keeps failed changes pending and reports storage failure', () => {
    const originalSetItem = Storage.prototype.setItem;
    const { result } = renderHook(() => usePads());
    Storage.prototype.setItem = vi.fn(() => {
      const error = new Error('quota');
      error.name = 'QuotaExceededError';
      throw error;
    });
    const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Unsaved' }] }] };

    act(() => result.current.queueDocument(doc, 'Unsaved'));
    act(() => vi.advanceTimersByTime(600));

    expect(result.current.saveState).toBe('failed');
    expect(result.current.saveMessage).toMatch(/Storage is full/);
    Storage.prototype.setItem = originalSetItem;
  });
});
