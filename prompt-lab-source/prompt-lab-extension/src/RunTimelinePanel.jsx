import { useEffect, useMemo, useState } from 'react';
import Ic from './icons';
import useEvalRuns from './hooks/useEvalRuns.js';
import usePersistedState from './usePersistedState.js';
import { wordDiff } from './promptUtils';

const VERDICT_CYCLE = [null, 'pass', 'fail', 'mixed'];
const VERDICT_STYLES = {
  pass: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  fail: 'bg-red-500/20 text-red-400 border-red-500/30',
  mixed: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
};
const PROVIDER_COLORS = {
  anthropic: 'bg-orange-500/20 text-orange-300',
  openai: 'bg-emerald-500/20 text-emerald-300',
  google: 'bg-blue-500/20 text-blue-300',
  openrouter: 'bg-purple-500/20 text-purple-300',
  ollama: 'bg-gray-500/20 text-gray-300',
};
const MODEL_COMPARE_GRID_CLASS = {
  1: 'grid-cols-1',
  2: 'grid-cols-2',
  3: 'grid-cols-3',
};
const EVALUATE_TIMELINE_FILTERS_KEY = 'pl2-evaluate-timeline-filters';
const DEFAULT_EVALUATE_TIMELINE_FILTERS = Object.freeze({
  mode: '',
  provider: '',
  model: '',
  status: '',
  dateRange: '30d',
  search: '',
  showModelCompare: false,
});

const MODE_LABELS = {
  enhance: 'Enhance',
  ab: 'A/B',
  'test-case': 'Test Case',
};
const STATUS_LABELS = {
  success: 'Success',
  error: 'Error',
  blocked: 'Blocked',
};
const DATE_RANGE_LABELS = {
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
  '': 'All time',
};
const ACCENT_TEXT_CLASS = 'text-orange-300';
const ACCENT_SOLID_BUTTON_CLASS = 'bg-orange-500/90 hover:bg-orange-400 text-white';
const ACCENT_SOFT_BUTTON_CLASS = 'border border-orange-400/35 bg-orange-500/12 text-orange-100 hover:bg-orange-500/18';
const ACCENT_FOCUS_CLASS = 'focus:border-orange-400';
const ACCENT_PANEL_CLASS = 'border border-orange-400/20 bg-gradient-to-br from-orange-500/10 via-transparent to-amber-500/10';

function validateTimelineFilters(value) {
  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_EVALUATE_TIMELINE_FILTERS };
  }

  return {
    mode: ['', 'enhance', 'ab', 'test-case'].includes(value.mode) ? value.mode : DEFAULT_EVALUATE_TIMELINE_FILTERS.mode,
    provider: typeof value.provider === 'string' ? value.provider : DEFAULT_EVALUATE_TIMELINE_FILTERS.provider,
    model: typeof value.model === 'string' ? value.model : DEFAULT_EVALUATE_TIMELINE_FILTERS.model,
    status: ['', 'success', 'error', 'blocked'].includes(value.status) ? value.status : DEFAULT_EVALUATE_TIMELINE_FILTERS.status,
    dateRange: ['7d', '30d', '90d', ''].includes(value.dateRange) ? value.dateRange : DEFAULT_EVALUATE_TIMELINE_FILTERS.dateRange,
    search: typeof value.search === 'string' ? value.search : DEFAULT_EVALUATE_TIMELINE_FILTERS.search,
    showModelCompare: Boolean(value.showModelCompare),
  };
}

function formatLatency(ms) {
  if (!ms) return '—';
  return ms >= 1000 ? (ms / 1000).toFixed(1) + 's' : ms + 'ms';
}

function formatTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function formatSignedNumber(value, suffix = '') {
  if (!Number.isFinite(value) || value === 0) return `0${suffix}`;
  return `${value > 0 ? '+' : ''}${value}${suffix}`;
}

function resolveVersion(run, prompt) {
  if (!run.promptVersionId || !prompt?.versions?.length) return null;
  const idx = prompt.versions.findIndex(v => v.id === run.promptVersionId);
  return idx >= 0 ? `v${prompt.versions.length - idx}` : null;
}

function buildFilterBadges(filters) {
  const items = [];
  if (filters.mode) items.push(`Mode: ${MODE_LABELS[filters.mode] || filters.mode}`);
  if (filters.provider) items.push(`Provider: ${filters.provider}`);
  if (filters.model) items.push(`Model: ${filters.model}`);
  if (filters.status) items.push(`Status: ${STATUS_LABELS[filters.status] || filters.status}`);
  if (filters.dateRange !== DEFAULT_EVALUATE_TIMELINE_FILTERS.dateRange) {
    items.push(`Range: ${DATE_RANGE_LABELS[filters.dateRange] || filters.dateRange}`);
  }
  if (filters.search) items.push(`Search: ${filters.search}`);
  if (filters.showModelCompare) items.push('Model compare');
  return items;
}

// ── Golden Trend Bar ──
function GoldenTrendBar({ runs, m }) {
  const scores = runs.filter(r => r.goldenScore != null).slice(0, 10).map(r => r.goldenScore);
  if (scores.length < 2) return null;
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  const best = Math.max(...scores);
  return (
    <div className={`${m.surface} border ${m.border} rounded-lg p-3 mb-3`}>
      <p className={`text-xs font-semibold ${m.textSub} uppercase tracking-wider mb-2`}>Golden Trend (last {scores.length})</p>
      <div className="flex items-end gap-1 h-6 mb-2">
        {scores.map((s, i) => (
          <div key={i} className={`flex-1 rounded-sm ${s >= 0.7 ? 'bg-emerald-500/60' : s >= 0.4 ? 'bg-amber-500/60' : 'bg-red-500/60'}`}
            style={{ height: `${Math.max(10, s * 100)}%` }} title={`${Math.round(s * 100)}%`} />
        ))}
      </div>
      <div className={`flex gap-4 text-xs ${m.textMuted}`}>
        <span>Latest: <strong className={ACCENT_TEXT_CLASS}>{Math.round(scores[0] * 100)}%</strong></span>
        <span>Avg: <strong>{Math.round(avg * 100)}%</strong></span>
        <span>Best: <strong className="text-emerald-400">{Math.round(best * 100)}%</strong></span>
      </div>
    </div>
  );
}

// ── Model Comparison View ──
function ModelComparisonView({ runs, m }) {
  const byModel = useMemo(() => {
    const map = {};
    for (const r of runs) {
      const key = `${r.provider}/${r.model}`;
      if (!map[key]) map[key] = r;
    }
    return Object.values(map);
  }, [runs]);

  if (byModel.length < 2) return null;
  const gridClass = MODEL_COMPARE_GRID_CLASS[Math.min(byModel.length, 3)] || 'grid-cols-2';

  return (
    <div className={`${m.surface} border ${m.border} rounded-lg p-3 mb-3`}>
      <p className={`text-xs font-semibold ${m.textSub} uppercase tracking-wider mb-2`}>Model Comparison (latest per model)</p>
      <div className={`grid gap-2 ${gridClass}`}>
        {byModel.slice(0, 4).map(run => (
          <div key={run.id} className={`${m.codeBlock} border ${m.border} rounded-lg p-2.5 text-xs`}>
            <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-semibold mb-1 ${PROVIDER_COLORS[run.provider] || 'bg-gray-500/20 text-gray-300'}`}>
              {run.model}
            </span>
            <div className={`flex flex-wrap gap-2 ${m.textMuted} mt-1`}>
              <span>{formatLatency(run.latencyMs)}</span>
              {run.goldenScore != null && <span className={run.goldenScore >= 0.7 ? 'text-emerald-400' : 'text-red-400'}>{Math.round(run.goldenScore * 100)}%</span>}
              {run.verdict && <span className={`px-1.5 py-0.5 rounded border text-xs font-semibold ${VERDICT_STYLES[run.verdict]}`}>{run.verdict}</span>}
            </div>
            <p className={`${m.textBody} mt-1.5 leading-relaxed whitespace-pre-wrap line-clamp-3`}>{(run.output || '').slice(0, 200)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Run Card ──
function RunCard({ run, prompt, m, updateRun, onSelectCompare, isCompareSelected, copyBtn, copy }) {
  const [expanded, setExpanded] = useState(false);
  const [editingNotes, setEditingNotes] = useState(false);
  const [localNotes, setLocalNotes] = useState(run.notes || '');
  const version = resolveVersion(run, prompt);

  const cycleVerdict = () => {
    const idx = VERDICT_CYCLE.indexOf(run.verdict);
    const next = VERDICT_CYCLE[(idx + 1) % VERDICT_CYCLE.length];
    updateRun(run.id, { verdict: next });
  };

  const saveNotes = () => {
    setEditingNotes(false);
    if (localNotes !== (run.notes || '')) {
      updateRun(run.id, { notes: localNotes });
    }
  };

  return (
    <div className={`${m.codeBlock} border ${m.border} rounded-lg p-3 text-xs ${isCompareSelected ? 'ring-2 ring-orange-400/60' : ''}`}>
      {/* Meta row */}
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`inline-block px-1.5 py-0.5 rounded font-semibold ${PROVIDER_COLORS[run.provider] || 'bg-gray-500/20 text-gray-300'}`}>
            {run.provider}
          </span>
          <span className={`${m.textMuted} truncate`}>{run.model}</span>
          <span className={`uppercase ${m.textMuted}`}>{run.mode === 'test-case' ? 'test' : run.mode}</span>
          <span className={m.textMuted}>{formatLatency(run.latencyMs)}</span>
          {version && <span className={`${ACCENT_TEXT_CLASS} font-semibold`}>{version}</span>}
        </div>
        <span className={`${m.textMuted} whitespace-nowrap`}>{formatTime(run.createdAt)}</span>
      </div>

      {/* Input preview */}
      {run.input && (
        <p className={`${m.textMuted} mb-1 truncate`}>{run.input.slice(0, 120)}</p>
      )}

      {/* Output preview */}
      {run.output && (
        <div className="mb-1.5">
          <button type="button" onClick={() => setExpanded(p => !p)} className={`text-left w-full ${m.textBody} leading-relaxed whitespace-pre-wrap hover:opacity-80 transition-opacity`}>
            {expanded ? run.output : (run.output.slice(0, 200) + (run.output.length > 200 ? '…' : ''))}
          </button>
          {run.output.length > 200 && (
            <button type="button" onClick={() => setExpanded(p => !p)} className="text-orange-300 hover:text-orange-200 font-semibold mt-0.5">
              {expanded ? 'Collapse' : 'Expand'}
            </button>
          )}
        </div>
      )}

      {/* Golden + Verdict + Actions row */}
      <div className="flex items-center flex-wrap gap-2 mt-1">
        {run.goldenScore != null && (
          <div className="flex items-center gap-1.5">
            <div className="w-16 h-1.5 rounded-full bg-gray-700 overflow-hidden">
              <div className={`h-full rounded-full ${run.goldenScore >= 0.7 ? 'bg-emerald-500' : run.goldenScore >= 0.4 ? 'bg-amber-500' : 'bg-red-500'}`}
                style={{ width: `${Math.round(run.goldenScore * 100)}%` }} />
            </div>
            <span className={run.goldenScore >= 0.7 ? 'text-emerald-400 font-semibold' : 'text-red-400 font-semibold'}>
              {Math.round(run.goldenScore * 100)}%
            </span>
          </div>
        )}

        <button type="button" onClick={cycleVerdict}
          className={`px-2 py-0.5 rounded border font-semibold transition-colors ${run.verdict ? VERDICT_STYLES[run.verdict] : `${m.border} ${m.textMuted} hover:border-orange-400/60`}`}>
          {run.verdict || 'unrated'}
        </button>

        <button type="button" onClick={() => onSelectCompare(run)}
          className={`px-2 py-0.5 rounded border font-semibold transition-colors ${isCompareSelected ? 'border-orange-400/60 text-orange-200' : `${m.border} ${m.textMuted} hover:border-orange-400/60`}`}>
          Compare
        </button>

        {run.output && (
          <button onClick={() => copy(run.output, 'Output copied')}
            className={`flex items-center gap-1 px-2 py-0.5 rounded font-semibold transition-colors ${copyBtn}`}>
            <Ic n="Copy" size={9} />Copy
          </button>
        )}
      </div>

      {/* Notes */}
      <div className="mt-1.5">
        {editingNotes ? (
          <input type="text" value={localNotes} onChange={e => setLocalNotes(e.target.value)}
            onBlur={saveNotes} onKeyDown={e => e.key === 'Enter' && saveNotes()}
            autoFocus
            className={`w-full text-xs ${m.input} border rounded px-2 py-1 focus:outline-none ${ACCENT_FOCUS_CLASS}`}
            placeholder="Add notes…" />
        ) : (
          <button type="button" onClick={() => { setLocalNotes(run.notes || ''); setEditingNotes(true); }}
            className={`${m.textMuted} hover:${m.textBody} italic transition-colors`}>
            {run.notes || 'Add notes…'}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Compare Panel ──
function ComparePanel({ runs, m, compact, copy, onClose }) {
  if (runs.length < 2) return null;
  const [a, b] = runs;
  const diffSegments = wordDiff(a.output || '', b.output || '');
  const outputDelta = (b.output || '').length - (a.output || '').length;
  const latencyDelta = (b.latencyMs || 0) - (a.latencyMs || 0);
  const goldenDelta = (b.goldenScore ?? 0) - (a.goldenScore ?? 0);
  const compareSummary = [
    `${a.provider}/${a.model} · ${formatTime(a.createdAt)}`,
    a.output || '(no output)',
    '',
    `${b.provider}/${b.model} · ${formatTime(b.createdAt)}`,
    b.output || '(no output)',
  ].join('\n');

  return (
    <div className={`${m.surface} border ${m.border} rounded-lg p-3 mb-3`}>
      <div className="flex justify-between items-center mb-2">
        <p className={`text-xs font-semibold ${m.textSub} uppercase tracking-wider`}>Side-by-Side Compare</p>
        <button type="button" onClick={onClose} className={`${m.textMuted} hover:text-red-400 transition-colors`}>
          <Ic n="X" size={12} />
        </button>
      </div>
      <div className={`grid gap-2 mb-3 ${compact ? 'grid-cols-1' : 'grid-cols-3'}`}>
        <div className={`${m.codeBlock} border ${m.border} rounded-lg px-3 py-2 text-xs`}>
          <p className={`text-[11px] font-semibold ${m.textSub} uppercase tracking-wider mb-1`}>Output Delta</p>
          <span className={`${outputDelta >= 0 ? 'text-emerald-400' : 'text-amber-400'} font-semibold`}>
            {formatSignedNumber(outputDelta, ' chars')}
          </span>
        </div>
        <div className={`${m.codeBlock} border ${m.border} rounded-lg px-3 py-2 text-xs`}>
          <p className={`text-[11px] font-semibold ${m.textSub} uppercase tracking-wider mb-1`}>Latency Delta</p>
          <span className={`${latencyDelta <= 0 ? 'text-emerald-400' : 'text-amber-400'} font-semibold`}>
            {formatSignedNumber(latencyDelta, 'ms')}
          </span>
        </div>
        <div className={`${m.codeBlock} border ${m.border} rounded-lg px-3 py-2 text-xs`}>
          <p className={`text-[11px] font-semibold ${m.textSub} uppercase tracking-wider mb-1`}>Golden Delta</p>
          <span className={`${goldenDelta >= 0 ? 'text-emerald-400' : 'text-red-400'} font-semibold`}>
            {formatSignedNumber(Math.round(goldenDelta * 100), '%')}
          </span>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {[a, b].map(run => (
          <div key={run.id} className={`${m.codeBlock} border ${m.border} rounded-lg p-2.5 text-xs`}>
            <div className="flex items-center gap-2 mb-1">
              <span className={`px-1.5 py-0.5 rounded font-semibold ${PROVIDER_COLORS[run.provider] || 'bg-gray-500/20 text-gray-300'}`}>{run.provider}</span>
              <span className={m.textMuted}>{run.model}</span>
              <span className={m.textMuted}>{formatTime(run.createdAt)}</span>
            </div>
            {run.goldenScore != null && (
              <span className={`font-semibold ${run.goldenScore >= 0.7 ? 'text-emerald-400' : 'text-red-400'}`}>
                Golden: {Math.round(run.goldenScore * 100)}%
              </span>
            )}
            <div className={`${m.textBody} leading-relaxed whitespace-pre-wrap mt-1.5 max-h-80 overflow-y-auto`}>
              {run.output || '(no output)'}
            </div>
          </div>
        ))}
      </div>
      <div className={`${m.codeBlock} border ${m.border} rounded-lg p-3 text-sm leading-loose mt-3`}>
        <div className="flex items-center justify-between gap-2 mb-2">
          <p className={`text-[11px] font-semibold ${m.textSub} uppercase tracking-wider`}>Diff Highlight</p>
          <button
            type="button"
            onClick={() => copy(compareSummary, 'Comparison copied')}
            className={`inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-semibold transition-colors ${m.btn} ${m.textAlt}`}
          >
            <Ic n="Copy" size={10} />
            Copy Comparison
          </button>
        </div>
        {diffSegments.map((segment, index) => (
          <span
            key={`${segment.t}-${index}`}
            className={`${segment.t === 'add' ? m.diffAdd : segment.t === 'del' ? m.diffDel : m.diffEq} px-0.5 rounded mr-0.5`}
          >
            {segment.v}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Main Panel ──
export default function RunTimelinePanel({
  m,
  prompt,
  copy,
  compact,
  pageScroll,
  onQuickStart,
  onOpenCompare,
}) {
  const [timelineFilters, setTimelineFilters] = usePersistedState(
    EVALUATE_TIMELINE_FILTERS_KEY,
    { ...DEFAULT_EVALUATE_TIMELINE_FILTERS },
    { validate: validateTimelineFilters }
  );
  const {
    mode,
    provider,
    model,
    status,
    dateRange,
    search,
    showModelCompare,
  } = timelineFilters;
  const [compareSelectionIds, setCompareSelectionIds] = useState([]);

  const {
    evalRuns,
    totalRuns,
    loading,
    error,
    hasMore,
    loadMore,
    refreshEvalRuns,
    updateRun,
  } = useEvalRuns({
    promptId: prompt?.id || null,
    tab: 'history',
    limit: 20,
    mode,
    provider,
    model,
    status,
    search,
    dateRange,
  });

  const copyBtn = 'border border-orange-400/35 bg-orange-500/12 text-orange-100 hover:border-orange-300';

  // Derive available providers from data
  const availableProviders = useMemo(() => {
    const set = new Set(evalRuns.map(r => r.provider));
    return [...set].sort();
  }, [evalRuns]);

  const availableModels = useMemo(() => {
    const set = new Set(
      evalRuns
        .filter((run) => !provider || run.provider === provider)
        .map((run) => run.model)
    );
    return [...set].sort();
  }, [evalRuns, provider]);
  const canToggleModelCompare = showModelCompare || availableProviders.length >= 2;

  const compareSelection = useMemo(() => (
    compareSelectionIds
      .map((id) => evalRuns.find((run) => run.id === id))
      .filter(Boolean)
  ), [compareSelectionIds, evalRuns]);

  const hasActiveFilters = Boolean(
    mode
    || provider
    || model
    || status
    || search
    || dateRange !== DEFAULT_EVALUATE_TIMELINE_FILTERS.dateRange
    || showModelCompare
  );
  const filterBadges = useMemo(() => buildFilterBadges(timelineFilters), [timelineFilters]);
  const showingSummary = totalRuns > evalRuns.length
    ? `Showing ${evalRuns.length} of ${totalRuns} runs`
    : `${totalRuns} run${totalRuns === 1 ? '' : 's'}`;
  const showNoMatches = !loading && !error && evalRuns.length === 0 && hasActiveFilters;
  const showEmptyState = !loading && !error && evalRuns.length === 0 && !hasActiveFilters;

  const setTimelineFilter = (key, value) => {
    setTimelineFilters((prev) => {
      const next = { ...prev, [key]: value };
      if (key === 'provider' && value !== prev.provider) {
        next.model = '';
      }
      return next;
    });
  };

  const resetTimelineFilters = () => {
    setTimelineFilters({ ...DEFAULT_EVALUATE_TIMELINE_FILTERS });
  };

  useEffect(() => {
    setCompareSelectionIds((prev) => prev.filter((id) => evalRuns.some((run) => run.id === id)));
  }, [evalRuns]);

  const handleSelectCompare = (run) => {
    setCompareSelectionIds((prev) => {
      if (prev.includes(run.id)) return prev.filter((id) => id !== run.id);
      if (prev.length >= 2) return [prev[1], run.id];
      return [...prev, run.id];
    });
  };

  return (
    <div className={`flex-1 flex flex-col ${pageScroll ? '' : 'overflow-hidden'}`}>
      <div className={`p-4 flex flex-col gap-3 ${pageScroll ? '' : 'h-full min-h-0 overflow-y-auto'}`}>

        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className={`text-sm font-bold ${m.text}`}>{prompt ? 'Run History' : 'Evaluate Timeline'}</h2>
            <p className={`text-xs ${m.textMuted} truncate`}>
              {prompt?.title || 'All prompts · select a library entry to narrow this timeline'}
            </p>
          </div>
          <span className={`text-xs ${m.textMuted}`}>{loading && evalRuns.length === 0 ? 'Loading…' : showingSummary}</span>
        </div>

        <section className={`${m.surface} ${ACCENT_PANEL_CLASS} rounded-xl p-4`}>
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <p className={`text-[11px] font-semibold uppercase tracking-[0.24em] ${ACCENT_TEXT_CLASS}`}>Evaluate deck</p>
              <h2 className={`mt-1 text-sm font-semibold ${m.text}`}>Compare saved runs and keep the winners.</h2>
              <p className={`mt-1 max-w-xl text-xs leading-relaxed ${m.textMuted}`}>
                {prompt
                  ? 'Track how this prompt performs across versions, models, and notes without losing the thread of what changed.'
                  : 'Review output quality, latency, and verdicts in one place so strong runs rise above the noise.'}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={onQuickStart}
                className={`ui-control inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${ACCENT_SOLID_BUTTON_CLASS}`}
              >
                <Ic n="Wand2" size={11} />
                Open Workbench
              </button>
              {!prompt && (
                <button
                  type="button"
                  onClick={onOpenCompare}
                  className={`ui-control inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${ACCENT_SOFT_BUTTON_CLASS}`}
                >
                  <Ic n="GitBranch" size={11} />
                  Compare View
                </button>
              )}
            </div>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            {[
              [showingSummary, 'Runs available in the current timeline view'],
              [`${compareSelectionIds.length}/2 compare ready`, compareSelectionIds.length > 0 ? 'Select one more run to open side-by-side compare' : 'Pick two runs to unlock compare mode'],
              [`${filterBadges.length} filter${filterBadges.length === 1 ? '' : 's'} active`, hasActiveFilters ? 'Narrowed to a focused slice of history' : 'Showing the broader evaluation picture'],
            ].map(([label, helper]) => (
              <div key={label} className={`${m.codeBlock} ${m.border} rounded-lg border px-3 py-2.5`}>
                <p className={`text-sm font-semibold ${m.text}`}>{label}</p>
                <p className={`mt-1 text-[11px] leading-relaxed ${m.textMuted}`}>{helper}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Filters */}
        <div className={`flex items-center gap-2 flex-wrap ${m.surface} border ${m.border} rounded-lg p-2`}>
          <select value={mode} onChange={e => setTimelineFilter('mode', e.target.value)} aria-label="Filter by mode"
            className={`text-xs ${m.input} border rounded px-2 py-1.5 focus:outline-none ${ACCENT_FOCUS_CLASS}`}>
            <option value="">All modes</option>
            <option value="enhance">Enhance</option>
            <option value="ab">A/B</option>
            <option value="test-case">Test Case</option>
          </select>
          <select value={provider} onChange={e => setTimelineFilter('provider', e.target.value)} aria-label="Filter by provider"
            className={`text-xs ${m.input} border rounded px-2 py-1.5 focus:outline-none ${ACCENT_FOCUS_CLASS}`}>
            <option value="">All providers</option>
            {availableProviders.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <select value={model} onChange={e => setTimelineFilter('model', e.target.value)} aria-label="Filter by model"
            className={`text-xs ${m.input} border rounded px-2 py-1.5 focus:outline-none ${ACCENT_FOCUS_CLASS}`}>
            <option value="">All models</option>
            {availableModels.map(item => <option key={item} value={item}>{item}</option>)}
          </select>
          <select value={status} onChange={e => setTimelineFilter('status', e.target.value)} aria-label="Filter by status"
            className={`text-xs ${m.input} border rounded px-2 py-1.5 focus:outline-none ${ACCENT_FOCUS_CLASS}`}>
            <option value="">All statuses</option>
            <option value="success">Success</option>
            <option value="error">Error</option>
            <option value="blocked">Blocked</option>
          </select>
          <select value={dateRange} onChange={e => setTimelineFilter('dateRange', e.target.value)} aria-label="Filter by date range"
            className={`text-xs ${m.input} border rounded px-2 py-1.5 focus:outline-none ${ACCENT_FOCUS_CLASS}`}>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="90d">Last 90 days</option>
            <option value="">All time</option>
          </select>
          <input type="search" value={search} onChange={e => setTimelineFilter('search', e.target.value)}
            placeholder="Search runs…"
            className={`flex-1 min-w-[120px] text-xs ${m.input} border rounded px-2 py-1.5 focus:outline-none ${ACCENT_FOCUS_CLASS} placeholder-gray-400`} />
          {canToggleModelCompare && (
            <button type="button" onClick={() => setTimelineFilter('showModelCompare', !showModelCompare)}
              className={`text-xs px-2 py-1.5 rounded border font-semibold transition-colors ${showModelCompare ? 'border-orange-400/60 text-orange-200' : `${m.border} ${m.textMuted}`}`}>
              Compare Models
            </button>
          )}
          {hasActiveFilters && (
            <button
              type="button"
              onClick={resetTimelineFilters}
              className={`text-xs px-2 py-1.5 rounded border font-semibold transition-colors ${m.border} ${m.textMuted} hover:border-orange-400/60 hover:text-orange-200`}
            >
              Reset Filters
            </button>
          )}
        </div>

        {(filterBadges.length > 0 || totalRuns > 0) && (
          <div className={`${m.codeBlock} border ${m.border} rounded-lg px-3 py-2`}>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <p className={`text-[11px] font-semibold uppercase tracking-wider ${m.textSub}`}>
                {showingSummary}
              </p>
              {hasActiveFilters && (
                <span className={`text-[11px] ${m.textMuted}`}>
                  Filtered view
                </span>
              )}
            </div>
            {filterBadges.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {filterBadges.map((badge) => (
                  <span
                    key={badge}
                    className={`rounded-full border ${m.border} px-2 py-0.5 text-[11px] font-medium ${m.textAlt}`}
                  >
                    {badge}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {error && (
          <div role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2.5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-red-300">Evaluate timeline unavailable</p>
                <p className="mt-1 text-xs text-red-100">{error}</p>
              </div>
              <button
                type="button"
                onClick={() => refreshEvalRuns(prompt?.id || null)}
                className="ui-control rounded-lg border border-red-400/30 px-2.5 py-1 text-xs font-semibold text-red-100 transition-colors hover:border-red-300"
              >
                Retry
              </button>
            </div>
          </div>
        )}

        {/* Golden Trend */}
        <GoldenTrendBar runs={evalRuns} m={m} />

        {/* Model Comparison */}
        {showModelCompare && <ModelComparisonView runs={evalRuns} m={m} />}

        {/* Compare Panel */}
        {compareSelection.length === 2 && (
          <ComparePanel runs={compareSelection} m={m} compact={compact} copy={copy} onClose={() => setCompareSelectionIds([])} />
        )}

        {/* Loading */}
        {loading && evalRuns.length === 0 && (
          <div className={`text-center py-8 text-xs ${m.textMuted}`}>Loading runs…</div>
        )}

        {/* Run Cards */}
        {evalRuns.length > 0 && (
          <div className="flex flex-col gap-2">
            {evalRuns.map(run => (
              <RunCard key={run.id} run={run} prompt={prompt} m={m}
                updateRun={updateRun} copy={copy} copyBtn={copyBtn}
                onSelectCompare={handleSelectCompare}
                isCompareSelected={compareSelectionIds.includes(run.id)} />
            ))}
          </div>
        )}

        {/* Empty */}
        {showNoMatches && (
          <div className={`${m.surface} border ${m.border} rounded-lg p-4 text-center`}>
            <p className={`text-sm font-semibold ${m.text}`}>No runs match current filters.</p>
            <p className={`mt-1 text-xs ${m.textMuted}`}>
              {prompt
                ? 'Reset the filters to see the rest of this prompt history, or generate a fresh run from Create.'
                : 'Clear the filters to widen the timeline, or run a new prompt to generate a fresh result.'}
            </p>
            <div className="mt-3 flex items-center justify-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={resetTimelineFilters}
                className={`ui-control inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${ACCENT_SOLID_BUTTON_CLASS}`}
              >
                <Ic n="RotateCcw" size={11} />
                Reset All Filters
              </button>
              <button
                type="button"
                onClick={onQuickStart}
                className={`ui-control inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${m.btn} ${m.textAlt}`}
              >
                <Ic n="Wand2" size={11} />
                {prompt ? 'Open Create' : 'Quick Start'}
              </button>
            </div>
          </div>
        )}

        {showEmptyState && (
          <div className={`${m.surface} border ${m.border} rounded-lg p-4 text-center`}>
            <p className={`text-sm font-semibold ${m.text}`}>
              {prompt ? 'No runs for this prompt yet.' : 'No evaluate runs yet.'}
            </p>
            <p className={`mt-1 text-xs ${m.textMuted}`}>
              {prompt
                ? 'Enhance this prompt, run its test cases, or compare variants and the timeline will fill in here.'
                : 'Enhance a prompt or run an A/B compare and every saved run will appear here.'}
            </p>
            <div className="mt-3 flex items-center justify-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={onQuickStart}
                className={`ui-control inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${ACCENT_SOLID_BUTTON_CLASS}`}
              >
                <Ic n="Wand2" size={11} />
                {prompt ? 'Open Create' : 'Quick Start'}
              </button>
              {!prompt && (
                <button
                  type="button"
                  onClick={onOpenCompare}
                  className={`ui-control inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${m.btn} ${m.textAlt}`}
                >
                  <Ic n="GitBranch" size={11} />
                  Open Compare
                </button>
              )}
            </div>
            {!prompt && (
              <p className={`mt-2 text-[11px] ${m.textMuted}`}>
                Quick Start loads a starter prompt into Create so you can generate your first saved run.
              </p>
            )}
          </div>
        )}

        {/* Load More */}
        {hasMore && (
          <button type="button" onClick={loadMore}
            className={`w-full py-2 text-xs font-semibold rounded-lg border transition-colors ${m.border} ${m.textMuted} hover:border-orange-400/60 hover:text-orange-200`}>
            Load more
          </button>
        )}
      </div>
    </div>
  );
}
