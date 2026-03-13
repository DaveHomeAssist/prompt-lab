import { useState, useEffect } from 'react';
import { listEvalRuns } from '../experimentStore';
import { logWarn } from '../lib/logger.js';

export default function useEvalRuns({ editingId, tab }) {
  const [evalRuns, setEvalRuns] = useState([]);
  const [showEvalHistory, setShowEvalHistory] = useState(false);

  const refreshEvalRuns = async (promptId = editingId) => {
    try {
      const filters = { limit: 12 };
      if (promptId) filters.promptId = promptId;
      else filters.mode = 'enhance';
      const rows = await listEvalRuns(filters);
      setEvalRuns(rows);
    } catch (e) {
      logWarn('refresh eval runs', e);
      setEvalRuns([]);
    }
  };

  useEffect(() => {
    if (tab === 'editor') refreshEvalRuns();
  }, [editingId, tab]);

  return {
    evalRuns,
    showEvalHistory,
    setShowEvalHistory,
    refreshEvalRuns,
  };
}
