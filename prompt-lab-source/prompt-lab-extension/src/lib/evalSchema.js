export const EVAL_MODES = Object.freeze(['enhance', 'ab', 'test-case']);
export const VERDICT_VALUES = Object.freeze(['pass', 'fail', 'mixed']);
export const EVAL_STATUSES = Object.freeze(['success', 'error', 'blocked']);

function normalizeEntityId(value) {
  const id = String(value || '').trim();
  return id || null;
}

function normalizeVerdict(value) {
  return VERDICT_VALUES.includes(value) ? value : null;
}

function normalizeStatus(value) {
  // Preserve blocked preflight runs so aborted sends do not appear successful in history.
  return EVAL_STATUSES.includes(value) ? value : 'success';
}

export function normalizeEvalRunRecord(record) {
  const status = normalizeStatus(record.status);
  return {
    id: record.id || crypto.randomUUID(),
    createdAt: record.createdAt || new Date().toISOString(),
    promptId: normalizeEntityId(record.promptId),
    promptVersionId: normalizeEntityId(record.promptVersionId),
    promptTitle: String(record.promptTitle || 'Untitled prompt').trim() || 'Untitled prompt',
    mode: EVAL_MODES.includes(record.mode) ? record.mode : 'enhance',
    provider: String(record.provider || 'unknown').trim() || 'unknown',
    model: String(record.model || 'unknown').trim() || 'unknown',
    variantLabel: String(record.variantLabel || '').trim(),
    input: String(record.input || '').slice(0, 12000),
    output: String(record.output || '').slice(0, 20000),
    latencyMs: Number.isFinite(record.latencyMs) ? Math.max(0, Math.round(record.latencyMs)) : 0,
    verdict: normalizeVerdict(record.verdict),
    notes: String(record.notes || '').slice(0, 2000),
    status,
    testCaseId: normalizeEntityId(record.testCaseId),
    goldenScore: Number.isFinite(record.goldenScore) ? Math.max(0, Math.min(1, record.goldenScore)) : null,
  };
}

export function normalizeTestCaseRecord(record) {
  const now = new Date().toISOString();
  return {
    id: record.id || crypto.randomUUID(),
    promptId: normalizeEntityId(record.promptId),
    title: String(record.title || 'Untitled case').trim() || 'Untitled case',
    input: String(record.input || '').slice(0, 12000),
    expectedTraits: Array.isArray(record.expectedTraits)
      ? record.expectedTraits.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 12)
      : [],
    expectedExclusions: Array.isArray(record.expectedExclusions)
      ? record.expectedExclusions.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 12)
      : [],
    notes: String(record.notes || '').slice(0, 2000),
    createdAt: record.createdAt || now,
    updatedAt: record.updatedAt || now,
  };
}

export function filterEvalRuns(records, filters = {}) {
  const {
    search = '',
    promptId = '',
    mode = '',
    provider = '',
    model = '',
    status = '',
    dateRange = '',
    dateFrom = '',
    dateTo = '',
    limit = 20,
  } = filters;
  const query = String(search || '').trim().toLowerCase();
  const promptFilter = normalizeEntityId(promptId);
  const modeFilter = String(mode || '').trim();
  const providerFilter = String(provider || '').trim();
  const modelFilter = String(model || '').trim();
  const statusFilter = String(status || '').trim();
  const dateFromFilter = String(dateFrom || '').trim();
  const dateToFilter = String(dateTo || '').trim();
  const now = Date.now();
  const rangeDays = ({
    '7d': 7,
    '30d': 30,
    '90d': 90,
  })[String(dateRange || '').trim()] || 0;
  const rangeStartMs = rangeDays ? now - (rangeDays * 24 * 60 * 60 * 1000) : null;

  return records
    .map(normalizeEvalRunRecord)
    .filter((row) => {
      if (promptFilter && row.promptId !== promptFilter) return false;
      if (modeFilter && row.mode !== modeFilter) return false;
      if (providerFilter && row.provider !== providerFilter) return false;
      if (modelFilter && row.model !== modelFilter) return false;
      if (statusFilter && row.status !== statusFilter) return false;
      const createdAtMs = row.createdAt ? new Date(row.createdAt).getTime() : 0;
      if (rangeStartMs && createdAtMs < rangeStartMs) return false;
      if (dateFromFilter && createdAtMs < new Date(`${dateFromFilter}T00:00:00`).getTime()) return false;
      if (dateToFilter && createdAtMs > new Date(`${dateToFilter}T23:59:59`).getTime()) return false;
      if (query) {
        const haystack = `${row.promptTitle} ${row.model} ${row.input} ${row.output} ${row.notes}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    })
    .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt))
    .slice(0, Math.max(1, Math.min(200, Number(limit) || 20)));
}

export { normalizeEntityId };
