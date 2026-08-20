import { useCallback, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { resolveRouteState, stateToRoute } from '../lib/navigationRegistry.js';

/**
 * useRouteSync — bidirectional sync between React Router hash routes
 * and the existing useUiState / useNavigation state model.
 *
 * Route map:
 *   /           → create / editor
 *   /library    → create / library
 *   /composer   → create / composer
 *   /evaluate   → runs / history
 *   /compare    → runs / compare
 *   /pad        → notebook
 *
 * This hook reads the URL on mount and pushes state → URL on nav changes.
 * It preserves the existing state model so all current code keeps working.
 */

export default function useRouteSync({
  primaryView, setPrimaryView,
  workspaceView, setWorkspaceView,
  runsView, setRunsView,
  splitPane, setSplitPane,
  compact = false,
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const suppressPush = useRef(false);

  const replaceRoute = useCallback((target) => {
    suppressPush.current = true;
    navigate(target, { replace: true });
    requestAnimationFrame(() => { suppressPush.current = false; });
  }, [navigate]);

  // URL → state: on mount and browser back/forward
  useEffect(() => {
    const mapping = resolveRouteState(location.pathname);
    if (!mapping) return;

    suppressPush.current = true;

    if (mapping.primaryView) setPrimaryView(mapping.primaryView);
    if (mapping.workspaceView) setWorkspaceView(mapping.workspaceView);
    if (mapping.runsView) setRunsView(mapping.runsView);
    if (mapping.splitPane && typeof setSplitPane === 'function') setSplitPane(mapping.splitPane);

    // Allow the state update to settle before re-enabling URL push
    requestAnimationFrame(() => { suppressPush.current = false; });
  }, [location.pathname, setPrimaryView, setWorkspaceView, setRunsView, setSplitPane]);

  // State → URL: when nav state changes, update the URL
  useEffect(() => {
    if (suppressPush.current) return;

    const target = stateToRoute(primaryView, workspaceView, runsView, { compact, splitPane });
    if (target !== location.pathname) {
      navigate(target);
    }
  }, [primaryView, workspaceView, runsView, splitPane, compact, navigate, location.pathname]);

  return { replaceRoute };
}
