import { useState, useEffect, useCallback, useRef } from 'react';
import {
  EVAL_RUN_SIGNAL_KEY,
  listEvalRuns,
  patchEvalRun,
} from '../experimentStore';
import { logWarn } from '../lib/logger.js';

export default function useEvalRuns(optionsOrLegacy) {
  const opts = optionsOrLegacy || {};
  const promptId = opts.promptId ?? opts.editingId ?? null;
  const tab = opts.tab ?? null;
  const limit = opts.limit ?? 12;
  // M-2: mode fallback for surfaces that want one (the editor's inline
  // history). It is only applied while no prompt narrows the query and no
  // explicit mode filter is set, so the Evaluate timeline's "All modes"
  // stays truthful: it queries with no mode restriction at all.
  const defaultMode = opts.defaultMode ?? null;
  const modeFilter = opts.mode ?? '';
  const providerFilter = opts.provider ?? '';
  const modelFilter = opts.model ?? '';
  const statusFilter = opts.status ?? '';
  const verdictFilter = opts.verdict ?? '';
  const regressionFilter = opts.regression === true;
  const searchFilter = opts.search ?? '';
  const dateRangeFilter = opts.dateRange ?? '';

  const [evalRuns, setEvalRuns] = useState([]);
  const [showEvalHistory, setShowEvalHistory] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [total, setTotal] = useState(0);
  const displayLimit = useRef(limit);
  const reqIdRef = useRef(0);
  const abortRef = useRef(null);

  const refreshEvalRuns = useCallback(async (overridePromptId) => {
    const pid = overridePromptId ?? promptId;

    // Cancel any in-flight request
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    // Track this request so stale responses are discarded
    const thisReqId = ++reqIdRef.current;

    setLoading(true);
    setError(null);
    try {
      const filters = { limit: 200 };
      if (pid) filters.promptId = pid;
      else if (defaultMode) filters.mode = defaultMode;
      if (modeFilter) filters.mode = modeFilter;
      if (providerFilter) filters.provider = providerFilter;
      if (modelFilter) filters.model = modelFilter;
      if (statusFilter) filters.status = statusFilter;
      if (verdictFilter) filters.verdict = verdictFilter;
      if (regressionFilter) filters.regression = true;
      if (searchFilter) filters.search = searchFilter;
      if (dateRangeFilter) filters.dateRange = dateRangeFilter;

      const rows = await listEvalRuns(filters);

      // Discard if a newer request has been issued
      if (thisReqId !== reqIdRef.current) return;

      setTotal(rows.length);
      setEvalRuns(rows.slice(0, displayLimit.current));
    } catch (e) {
      if (thisReqId !== reqIdRef.current) return;
      logWarn('refresh eval runs', e);
      setError(e.message || 'Failed to load runs');
      setEvalRuns([]);
      setTotal(0);
    } finally {
      if (thisReqId === reqIdRef.current) {
        setLoading(false);
      }
    }
  }, [promptId, defaultMode, modeFilter, providerFilter, modelFilter, statusFilter, verdictFilter, regressionFilter, searchFilter, dateRangeFilter]);

  const loadMore = useCallback(() => {
    displayLimit.current = Math.min(displayLimit.current + 20, 200);
    refreshEvalRuns();
  }, [refreshEvalRuns]);

  const updateRun = useCallback(async (id, patch) => {
    try {
      const saved = await patchEvalRun(id, patch);
      if (!saved) {
        logWarn('update eval run', `Run ${id} not found — may have been deleted`);
        return false;
      }
      refreshEvalRuns();
      return true;
    } catch (e) {
      logWarn('update eval run', e);
      return false;
    }
  }, [refreshEvalRuns]);

  useEffect(() => {
    const handleStorage = (event) => {
      if (event.key === EVAL_RUN_SIGNAL_KEY || event.key === 'pl2-eval-run-fallback') {
        refreshEvalRuns();
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [refreshEvalRuns]);

  // Reset pagination when filters change
  useEffect(() => {
    displayLimit.current = limit;
  }, [promptId, modeFilter, providerFilter, modelFilter, statusFilter, verdictFilter, regressionFilter, searchFilter, dateRangeFilter, limit]);

  // Refresh when tab or filters change
  useEffect(() => {
    if (tab === 'editor' || tab === 'history') refreshEvalRuns();
  }, [promptId, tab, modeFilter, providerFilter, modelFilter, statusFilter, verdictFilter, regressionFilter, searchFilter, dateRangeFilter, refreshEvalRuns]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortRef.current) abortRef.current.abort();
    };
  }, []);

  return {
    evalRuns,
    totalRuns: total,
    showEvalHistory,
    setShowEvalHistory,
    refreshEvalRuns,
    loading,
    error,
    hasMore: evalRuns.length < total,
    loadMore,
    updateRun,
  };
}
