import { useCallback, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { resolveRouteState, stateToRoute } from '../lib/navigationRegistry.js';

/**
 * useRouteSync — bidirectional sync between React Router hash routes
 * and the existing useUiState / useNavigation state model.
 *
 * Route map — `ROUTE_TO_STATE` in navigationRegistry.js is the source of truth;
 * this list mirrors it:
 *   /              → create / editor
 *   /library       → create / library
 *   /composer      → create / composer
 *   /split         → create / dual pane
 *   /split/write   → create / dual pane, compact, editor pane
 *   /split/library → create / dual pane, compact, library pane
 *   /evaluate      → runs / history
 *   /compare       → runs / compare
 *   /scratch       → notebook (canonical)
 *   /pad           → notebook (legacy alias; accepted on the way in, but
 *                    stateToRoute always emits /scratch)
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
  onUnknownRoute,
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const suppressPush = useRef(false);
  const onUnknownRouteRef = useRef(onUnknownRoute);
  useEffect(() => { onUnknownRouteRef.current = onUnknownRoute; }, [onUnknownRoute]);
  // L-2 loop guard: remembers the pathname we already recovered from so an
  // unresolvable route can never trigger more than one redirect attempt.
  const recoveredFromRef = useRef(null);

  const replaceRoute = useCallback((target) => {
    suppressPush.current = true;
    navigate(target, { replace: true });
    requestAnimationFrame(() => { suppressPush.current = false; });
  }, [navigate]);

  // URL → state: on mount and browser back/forward
  useEffect(() => {
    const mapping = resolveRouteState(location.pathname);
    if (!mapping) {
      // L-2: an unknown route used to fall through silently — nav state kept
      // its previous workspace and the dead link stayed in history. Recover
      // deliberately: report the path, then replace the entry with the
      // canonical Write route (re-running this effect against its mapping).
      // The recovery is one-shot per pathname and never fires for '/' itself,
      // so an environment where no route resolves cannot redirect-loop.
      if (location.pathname === '/' || recoveredFromRef.current === location.pathname) return;
      recoveredFromRef.current = location.pathname;
      if (typeof onUnknownRouteRef.current === 'function') {
        onUnknownRouteRef.current(location.pathname);
      }
      replaceRoute('/');
      return;
    }
    recoveredFromRef.current = null;

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
