const DATASET_VERSION = 1;

const RUN_LAYER_MAP = Object.freeze({
  trace: 'Trace',
  chain: 'Chain',
  agent: 'Agent',
  llm: 'LLM',
  tool: 'Tool',
  eval: 'Eval',
});

function parseTimestamp(value) {
  if (Number.isFinite(value)) return value;
  const ms = Date.parse(value || '');
  return Number.isFinite(ms) ? ms : null;
}

function getDeterministicExportedAt(runs) {
  const latestMs = runs.reduce((max, run) => {
    const endMs = parseTimestamp(run.end_ts ?? run.ended_at);
    const startMs = parseTimestamp(run.start_ts ?? run.started_at);
    return Math.max(max, endMs ?? startMs ?? 0);
  }, 0);
  return new Date(latestMs || 0).toISOString();
}

function formatRuntime(ms) {
  if (!Number.isFinite(ms) || ms == null) return null;
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 10) return `${seconds.toFixed(1)}s`;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return `${minutes}m ${remainder}s`;
}

function sanitizeIdFragment(value) {
  return String(value || '')
    .replace(/[.:+]/g, '-')
    .replace(/\s+/g, '-');
}

function getChildCounts(runs) {
  const counts = Object.fromEntries(runs.map((run) => [run.run_id, 0]));
  runs.forEach((run) => {
    if (run.parent_run_id && counts[run.parent_run_id] != null) {
      counts[run.parent_run_id] += 1;
    }
  });
  return counts;
}

/**
 * @param {import('./RunSchema.js').RunRecord[]} runs
 * @param {{ traceId: string, rootRunId: string, variantId?: string }} options
 */
export function buildGraphDataset(runs, { traceId, rootRunId, variantId = 'main' }) {
  const records = Array.isArray(runs) ? runs.map((run) => ({ ...run })) : [];
  const childCounts = getChildCounts(records);
  const exportedAt = getDeterministicExportedAt(records);
  const exportId = `trace_${sanitizeIdFragment(traceId)}__variant_${sanitizeIdFragment(variantId)}__${sanitizeIdFragment(exportedAt)}`;

  const nodes = records.map((run) => {
    const layer = RUN_LAYER_MAP[run.run_type] || 'Unknown';
    const startMs = parseTimestamp(run.start_ts ?? run.started_at);
    const endMs = parseTimestamp(run.end_ts ?? run.ended_at);
    const runtimeMs = startMs != null && endMs != null ? Math.max(0, endMs - startMs) : null;
    const meta = { provider: run.provider, model: run.model, ...(run.meta || {}) };
    const childCount = childCounts[run.run_id] || 0;

    return {
      id: run.run_id,
      label: `${layer}:${run.name || run.model || run.run_type}`,
      type: run.run_type,
      layer,
      status: run.status,
      meta: {
        traceId: run.trace_id,
        parentRunId: run.parent_run_id,
        variantId: run.variant_id || variantId,
        runtimeMs,
        runtime: formatRuntime(runtimeMs),
        tags: [meta.provider, meta.model].filter(Boolean),
        desc: `${run.status}. ${childCount} child runs.`,
        owner: meta.provider || 'unknown',
        tokens: meta.tokens ?? null,
        cost: meta.cost ?? null,
        promptHash: meta.prompt_hash ?? null,
      },
    };
  });

  const edges = records.flatMap((run) => {
    const next = [];
    if (run.parent_run_id != null) {
      next.push({
        from: run.parent_run_id,
        to: run.run_id,
        type: 'calls',
        meta: { label: 'calls' },
      });
    }
    if (run.fork_of_run_id != null) {
      next.push({
        from: run.fork_of_run_id,
        to: run.run_id,
        type: 'variant_of',
        meta: { label: 'fork' },
      });
    }
    return next;
  });

  return {
    version: DATASET_VERSION,
    meta: {
      id: exportId,
      name: `Trace ${traceId} (${variantId})`,
      description: 'Run tree snapshot exported from PromptLab Dexie',
      traceId,
      rootRunId,
      variantId,
      exportedAt,
      source: 'promptlab:dexie:runs',
    },
    nodes,
    edges,
  };
}
