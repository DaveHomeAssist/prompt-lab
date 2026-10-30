import React, { useState } from 'react';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { libraryEditBuffers } from '../lib/libraryEditBuffers.js';
import { useSessionSave } from '../hooks/useSessionState.js';
import { useLibraryEditBuffer } from '../hooks/useLibraryEditBuffer.js';
import DualPaneWorkspace from '../DualPaneWorkspace.jsx';

const sessionSet = vi.hoisted(() => vi.fn().mockResolvedValue(true));
vi.mock('../lib/platform.js', () => ({ sessionSet, sessionGet: (_, callback) => callback(null) }));
afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); });

it('captures the current session before debounce and writes it only after resume', async () => {
  vi.useFakeTimers();
  const tab = renderHook(({ raw }) => useSessionSave({ raw, title: 'Unsaved title' }), { initialProps: { raw: 'first' } });
  tab.rerender({ raw: 'latest $& {{input}}' });
  const resume = libraryEditBuffers.suspend();
  try {
    const snapshot = libraryEditBuffers.read();
    expect(snapshot.find(row => row.id.startsWith('editor-session:')).value.raw).toBe('latest $& {{input}}');
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(sessionSet).not.toHaveBeenCalled();
  } finally { resume(); }
  await act(async () => { await vi.advanceTimersByTimeAsync(501); });
  expect(sessionSet).toHaveBeenCalledExactlyOnceWith({ 'pl2-session': { raw: 'latest $& {{input}}', title: 'Unsaved title' } });
});

it('captures unsaved dual-pane text and resumes its real autosave', async () => {
  vi.useFakeTimers(); const autosave = vi.fn().mockResolvedValue(true);
  function Editor() { const [raw, setRaw] = useState(''); return <DualPaneWorkspace raw={raw} setRaw={setRaw} onAutosave={autosave} />; }
  render(<Editor />);
  fireEvent.change(screen.getByLabelText('Dual pane prompt editor'), { target: { value: 'Two-pane unsaved text' } });
  const resume = libraryEditBuffers.suspend();
  try {
    expect(libraryEditBuffers.read().find(row => row.id.startsWith('dual-editor:')).value.raw).toBe('Two-pane unsaved text');
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(autosave).not.toHaveBeenCalled();
  } finally { resume(); }
  await act(async () => { await vi.advanceTimersByTimeAsync(651); });
  expect(autosave).toHaveBeenCalledOnce();
});

it('detects committed buffer edits and unmounts rather than silently accepting stale state', () => {
  const tab = renderHook(({ raw }) => useLibraryEditBuffer('fixture', { raw }), { initialProps: { raw: 'before' } });
  const snapshot = libraryEditBuffers.read();
  tab.rerender({ raw: 'after' });
  expect(() => libraryEditBuffers.assertUnchanged(snapshot)).toThrow('editor changed');
  const newer = libraryEditBuffers.read();tab.unmount();
  expect(() => libraryEditBuffers.assertUnchanged(newer)).toThrow('editor changed');
});
