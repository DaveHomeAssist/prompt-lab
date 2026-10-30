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
 *   /settings      → dialog route: opens Settings over the current workspace
 *   /account       → dialog route: opens the account profile (or Settings)
 *                    (both settle back on the current workspace's route)
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
  preserveSharedHash = false,
  onUnknownRoute,
  onRouteModal,
  onRouteResultTab,
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const suppressPush = useRef(false);
  const onUnknownRouteRef = useRef(onUnknownRoute);
  useEffect(() => { onUnknownRouteRef.current = onUnknownRoute; }, [onUnknownRoute]);
  const onRouteModalRef = useRef(onRouteModal);
  useEffect(() => { onRouteModalRef.current = onRouteModal; }, [onRouteModal]);
  const onRouteResultTabRef = useRef(onRouteResultTab);
  useEffect(() => { onRouteResultTabRef.current = onRouteResultTab; }, [onRouteResultTab]);
  const currentRouteRef = useRef('/');
  currentRouteRef.current = stateToRoute(primaryView, workspaceView, runsView, { compact, splitPane });
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
    // Shared prompt/pack fragments are application payloads, not routes.
    // Leave them untouched until usePersistenceFlow has decoded the payload.
    if (preserveSharedHash) return;
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

    if (mapping.modal) {
      // /settings and /account open their dialog over the current workspace.
      if (typeof onRouteModalRef.current === 'function') onRouteModalRef.current(mapping.modal);
      replaceRoute(currentRouteRef.current);
      return;
    }

    suppressPush.current = true;

    if (mapping.primaryView) setPrimaryView(mapping.primaryView);
    if (mapping.workspaceView) setWorkspaceView(mapping.workspaceView);
    if (mapping.runsView) setRunsView(mapping.runsView);
    if (mapping.splitPane && typeof setSplitPane === 'function') setSplitPane(mapping.splitPane);
    if (mapping.resultTab && typeof onRouteResultTabRef.current === 'function') {
      onRouteResultTabRef.current(mapping.resultTab);
    }
    if (mapping.canonical) {
      // Alias routes (e.g. /diff) replace themselves with their canonical
      // route so history holds one entry and no recovery notice fires.
      replaceRoute(mapping.canonical);
      return;
    }

    // Allow the state update to settle before re-enabling URL push
    requestAnimationFrame(() => { suppressPush.current = false; });
  }, [location.pathname, preserveSharedHash, setPrimaryView, setWorkspaceView, setRunsView, setSplitPane]);

  // State → URL: when nav state changes, update the URL
  useEffect(() => {
    if (suppressPush.current || preserveSharedHash) return;

    const target = stateToRoute(primaryView, workspaceView, runsView, { compact, splitPane });
    if (target !== location.pathname) {
      navigate(target);
    }
  }, [primaryView, workspaceView, runsView, splitPane, compact, navigate, location.pathname, preserveSharedHash]);

  return { replaceRoute };
}
