import { useState, useEffect, useCallback, useRef } from 'react';
import { listEvalRuns, saveEvalRun, getEvalRunById } from '../experimentStore';
import { logWarn } from '../lib/logger.js';

export default function useEvalRuns(optionsOrLegacy) {
  // Backward-compatible: accept { editingId, tab } (old) or { promptId, tab, limit, mode, provider, model, status, search, dateRange } (new)
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
  const [total, setTotal] = useState(0);
  const displayLimit = useRef(limit);

  const refreshEvalRuns = useCallback(async (overridePromptId) => {
    const pid = overridePromptId ?? promptId;
    setLoading(true);
    try {
      // Fetch a large window so we can count total + paginate client-side
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
      setTotal(rows.length);
      setEvalRuns(rows.slice(0, displayLimit.current));
    } catch (e) {
      logWarn('refresh eval runs', e);
      setEvalRuns([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [promptId, modeFilter, providerFilter, modelFilter, statusFilter, searchFilter, dateRangeFilter]);

  const loadMore = useCallback(() => {
    displayLimit.current = Math.min(displayLimit.current + 20, 200);
    refreshEvalRuns();
  }, [refreshEvalRuns]);

  const updateRun = useCallback(async (id, patch) => {
    try {
      const existing = await getEvalRunById(id);
      if (!existing) return;
      await saveEvalRun({ ...existing, ...patch });
      refreshEvalRuns();
    } catch (e) {
      logWarn('update eval run', e);
    }
  }, [refreshEvalRuns]);

  useEffect(() => {
    displayLimit.current = limit;
  }, [promptId, modeFilter, providerFilter, modelFilter, statusFilter, searchFilter, dateRangeFilter, limit]);

  useEffect(() => {
    if (tab === 'editor' || tab === 'history') refreshEvalRuns();
  }, [promptId, tab, refreshEvalRuns]);

  return {
    evalRuns,
    showEvalHistory,
    setShowEvalHistory,
    refreshEvalRuns,
    loading,
    hasMore: evalRuns.length < total,
    loadMore,
    updateRun,
  };
}
