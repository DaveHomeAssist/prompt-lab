import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import useNavigation from '../hooks/useNavigation.js';

function renderNavigation(overrides = {}) {
  const setPrimaryView = vi.fn();
  const setWorkspaceView = vi.fn();
  const setRunsView = vi.fn();
  const setTab = vi.fn();

  const hook = renderHook(() => useNavigation({
    primaryView: 'create',
    setPrimaryView,
    workspaceView: 'editor',
    setWorkspaceView,
    runsView: 'history',
    setRunsView,
    tab: 'editor',
    setTab,
    ...overrides,
  }));

  return {
    ...hook,
    setPrimaryView,
    setWorkspaceView,
    setRunsView,
    setTab,
  };
}

describe('useNavigation', () => {
  it('reports Evaluate as the active section for run views', () => {
    const { result } = renderNavigation({
      primaryView: 'runs',
      runsView: 'compare',
      tab: 'abtest',
    });

    expect(result.current.activeSection).toBe('evaluate');
  });

  it('routes evaluate and legacy experiments section ids to compare view', () => {
    const evaluate = renderNavigation();

    act(() => {
      evaluate.result.current.openSection('evaluate');
    });

    expect(evaluate.setPrimaryView).toHaveBeenCalledWith('runs');
    // openSection('evaluate') should NOT force runsView — preserves user state
    expect(evaluate.setRunsView).not.toHaveBeenCalled();

    const legacy = renderNavigation();

    act(() => {
      legacy.result.current.openSection('experiments');
    });

    expect(legacy.setPrimaryView).toHaveBeenCalledWith('runs');
    expect(legacy.setRunsView).not.toHaveBeenCalled();
  });

  it('routes the library section through the shared section-state mapping', () => {
    const library = renderNavigation();

    act(() => {
      library.result.current.openSection('library');
    });

    expect(library.setPrimaryView).toHaveBeenCalledWith('create');
    expect(library.setWorkspaceView).toHaveBeenCalledWith('library');
  });
});
