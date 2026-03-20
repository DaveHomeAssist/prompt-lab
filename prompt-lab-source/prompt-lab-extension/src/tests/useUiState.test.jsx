import { renderHook, act } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import useUiState from '../hooks/useUiState.js';

describe('useUiState font controls', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('persists editor and result font sizes independently', () => {
    const { result, unmount } = renderHook(() => useUiState());

    act(() => {
      result.current.setEditorFontSize(16);
      result.current.setResultFontSize(18);
    });

    unmount();

    const { result: nextResult } = renderHook(() => useUiState());
    expect(nextResult.current.editorFontSize).toBe(16);
    expect(nextResult.current.resultFontSize).toBe(18);
  });

  it('falls back to the legacy single font size key when new keys are absent', () => {
    localStorage.setItem('pl2-font-size', JSON.stringify(17));

    const { result } = renderHook(() => useUiState());
    expect(result.current.editorFontSize).toBe(17);
    expect(result.current.resultFontSize).toBe(17);
  });
});
