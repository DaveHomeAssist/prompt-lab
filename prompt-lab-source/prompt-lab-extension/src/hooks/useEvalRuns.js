import { useState, useEffect, useCallback, useRef } from 'react';
import { listEvalRuns, saveEvalRun, getEvalRunById } from '../experimentStore';
import { logWarn } from '../lib/logger.js';

export default function useEvalRuns(optionsOrLegacy) {
  const opts = optionsOrLegacy || {};
  const promptId = opts.promptId ?? opts.editingId ?? null;
  const tab = opts.tab ?? null;
  const limit = opts.limit ?? 12;
  const modeFilter = opts.mode ?? '';
  const providerFilter = opts.provider ?? '';
  const modelFilter = opts.model ?? '';
  const statusFilter = opts.status ?? '';
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
      else filters.mode = 'enhance';
      if (modeFilter) filters.mode = modeFilter;
      if (providerFilter) filters.provider = providerFilter;
      if (modelFilter) filters.model = modelFilter;
      if (statusFilter) filters.status = statusFilter;
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
  }, [promptId, modeFilter, providerFilter, modelFilter, statusFilter, searchFilter, dateRangeFilter]);

  const loadMore = useCallback(() => {
    displayLimit.current = Math.min(displayLimit.current + 20, 200);
    refreshEvalRuns();
  }, [refreshEvalRuns]);

  const updateRun = useCallback(async (id, patch) => {
    try {
      const existing = await getEvalRunById(id);
      if (!existing) {
        logWarn('update eval run', `Run ${id} not found — may have been deleted`);
        return false;
      }
      await saveEvalRun({ ...existing, ...patch });
      refreshEvalRuns();
      return true;
    } catch (e) {
      logWarn('update eval run', e);
      return false;
    }
  }, [refreshEvalRuns]);

  // Reset pagination when filters change
  useEffect(() => {
    displayLimit.current = limit;
  }, [promptId, modeFilter, providerFilter, modelFilter, statusFilter, searchFilter, dateRangeFilter, limit]);

  // Refresh when tab or filters change
  useEffect(() => {
    if (tab === 'editor' || tab === 'history') refreshEvalRuns();
  }, [promptId, tab, modeFilter, providerFilter, modelFilter, statusFilter, searchFilter, dateRangeFilter, refreshEvalRuns]);

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
