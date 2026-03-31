import { useCallback, useMemo } from 'react';
import { deriveActiveSection, resolveSectionState } from '../lib/navigationRegistry.js';

/**
 * useNavigation — wraps raw view state into a single, formalized navigation API.
 *
 * Replaces the scattered openSection / openCreateView / openRunsView functions
 * that were previously inlined in App.jsx.
 */
export default function useNavigation({
  primaryView, setPrimaryView,
  workspaceView, setWorkspaceView,
  runsView, setRunsView,
  tab, setTab,
}) {
  const activeSection = useMemo(
    () => deriveActiveSection(primaryView, workspaceView),
    [primaryView, workspaceView],
  );

  const openCreateView = useCallback((nextView) => {
    setPrimaryView('create');
    setWorkspaceView(nextView);
  }, [setPrimaryView, setWorkspaceView]);

  const openSection = useCallback((nextSection) => {
    const nextState = resolveSectionState(nextSection);
    if (nextState.primaryView) setPrimaryView(nextState.primaryView);
    if (nextState.workspaceView) setWorkspaceView(nextState.workspaceView);
    if (nextState.runsView) setRunsView(nextState.runsView);
  }, [setPrimaryView, setWorkspaceView, setRunsView]);

  const openRunsView = useCallback((nextView) => {
    setPrimaryView('runs');
    setRunsView(nextView);
  }, [setPrimaryView, setRunsView]);

  return {
    activeSection,
    openCreateView,
    openSection,
    openRunsView,
    primaryView, setPrimaryView,
    workspaceView, setWorkspaceView,
    runsView, setRunsView,
    tab, setTab,
  };
}
