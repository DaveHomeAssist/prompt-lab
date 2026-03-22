import { useState, useMemo, useCallback } from 'react';
import Ic from './icons';
import useEvalRuns from './hooks/useEvalRuns.js';
import useExperiments from './hooks/useExperiments.js';
import ABTestTab from './ABTestTab';
import { wordDiff } from './promptUtils';

const NOOP = () => {};

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
        <span>Latest: <strong className="text-violet-400">{Math.round(scores[0] * 100)}%</strong></span>
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
function RunCard({ run, prompt, m, updateRun, onSelectCompare, isCompareSelected, copyBtn, copy, onRerun }) {
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
    <div className={`${m.codeBlock} border ${m.border} rounded-lg p-3 text-xs ${isCompareSelected ? 'ring-2 ring-violet-500' : ''}`}>
      {/* Meta row */}
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`inline-block px-1.5 py-0.5 rounded font-semibold ${PROVIDER_COLORS[run.provider] || 'bg-gray-500/20 text-gray-300'}`}>
            {run.provider}
          </span>
          <span className={`${m.textMuted} truncate`}>{run.model}</span>
          <span className={`uppercase ${m.textMuted}`}>{run.mode === 'test-case' ? 'test' : run.mode}</span>
          <span className={m.textMuted}>{formatLatency(run.latencyMs)}</span>
          {version && <span className="text-violet-400 font-semibold">{version}</span>}
        </div>
        <div className="flex items-center gap-2">
          {run.verdict && (
            <span className={`px-1.5 py-0.5 rounded border text-xs font-semibold ${VERDICT_STYLES[run.verdict]}`}>
              {run.verdict}
            </span>
          )}
          <span className={`${m.textMuted} whitespace-nowrap`}>{formatTime(run.createdAt)}</span>
        </div>
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
            <button type="button" onClick={() => setExpanded(p => !p)} className="text-violet-400 hover:text-violet-300 font-semibold mt-0.5">
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
          className={`px-2 py-0.5 rounded border font-semibold transition-colors ${run.verdict ? VERDICT_STYLES[run.verdict] : `${m.border} ${m.textMuted} hover:border-violet-400`}`}>
          {run.verdict || 'unrated'}
        </button>

        <button type="button" onClick={() => onSelectCompare(run)}
          className={`px-2 py-0.5 rounded border font-semibold transition-colors ${isCompareSelected ? 'border-violet-500 text-violet-400' : `${m.border} ${m.textMuted} hover:border-violet-400`}`}>
          Compare
        </button>

        {run.output && (
          <button onClick={() => copy(run.output, 'Output copied')}
            className={`flex items-center gap-1 px-2 py-0.5 rounded font-semibold transition-colors ${copyBtn}`}>
            <Ic n="Copy" size={9} />Copy
          </button>
        )}

        {onRerun && (
          <button type="button" onClick={() => onRerun(run)}
            className={`flex items-center gap-1 px-2 py-0.5 rounded border font-semibold transition-colors ${m.border} ${m.textMuted} hover:border-violet-400 hover:text-violet-400`}>
            <Ic n="RotateCw" size={9} />Re-run
          </button>
        )}
      </div>

      {/* Notes */}
      <div className="mt-1.5">
        {editingNotes ? (
          <input type="text" value={localNotes} onChange={e => setLocalNotes(e.target.value)}
            onBlur={saveNotes} onKeyDown={e => e.key === 'Enter' && saveNotes()}
            autoFocus
            className={`w-full text-xs ${m.input} border rounded px-2 py-1 focus:outline-none focus:border-violet-500`}
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

// ── Timeline Content (extracted for tab switching) ──
function TimelineContent({ m, prompt, copy, compact, pageScroll, onRerun }) {
  const [mode, setMode] = useState('');
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  const [status, setStatus] = useState('');
  const [dateRange, setDateRange] = useState('30d');
  const [search, setSearch] = useState('');
  const [showModelCompare, setShowModelCompare] = useState(false);
  const [compareSelection, setCompareSelection] = useState([]);

  const { evalRuns, loading, hasMore, loadMore, updateRun } = useEvalRuns({
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

  const copyBtn = 'border border-violet-400/30 bg-violet-500/15 text-violet-200 hover:border-violet-300';

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

  const handleSelectCompare = (run) => {
    setCompareSelection(prev => {
      if (prev.find(r => r.id === run.id)) return prev.filter(r => r.id !== run.id);
      if (prev.length >= 2) return [prev[1], run];
      return [...prev, run];
    });
  };

  return (
    <div className={`p-4 flex flex-col gap-3 ${pageScroll ? '' : 'flex-1 min-h-0 overflow-y-auto'}`}>

      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className={`text-sm font-bold ${m.text}`}>Run History</h2>
          <p className={`text-xs ${m.textMuted} truncate`}>{prompt.title || 'Untitled prompt'}</p>
        </div>
        <span className={`text-xs ${m.textMuted}`}>{evalRuns.length} runs</span>
      </div>

      {/* Filters */}
      <div className={`flex items-center gap-2 flex-wrap ${m.surface} border ${m.border} rounded-lg p-2`}>
        <select value={mode} onChange={e => setMode(e.target.value)} aria-label="Filter by mode"
          className={`text-xs ${m.input} border rounded px-2 py-1.5 focus:outline-none focus:border-violet-500`}>
          <option value="">All modes</option>
          <option value="enhance">Enhance</option>
          <option value="ab">A/B</option>
          <option value="test-case">Test Case</option>
        </select>
        <select value={provider} onChange={e => setProvider(e.target.value)} aria-label="Filter by provider"
          className={`text-xs ${m.input} border rounded px-2 py-1.5 focus:outline-none focus:border-violet-500`}>
          <option value="">All providers</option>
          {availableProviders.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={model} onChange={e => setModel(e.target.value)} aria-label="Filter by model"
          className={`text-xs ${m.input} border rounded px-2 py-1.5 focus:outline-none focus:border-violet-500`}>
          <option value="">All models</option>
          {availableModels.map(item => <option key={item} value={item}>{item}</option>)}
        </select>
        <select value={status} onChange={e => setStatus(e.target.value)} aria-label="Filter by status"
          className={`text-xs ${m.input} border rounded px-2 py-1.5 focus:outline-none focus:border-violet-500`}>
          <option value="">All statuses</option>
          <option value="success">Success</option>
          <option value="error">Error</option>
          <option value="blocked">Blocked</option>
        </select>
        <select value={dateRange} onChange={e => setDateRange(e.target.value)} aria-label="Filter by date range"
          className={`text-xs ${m.input} border rounded px-2 py-1.5 focus:outline-none focus:border-violet-500`}>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
          <option value="90d">Last 90 days</option>
          <option value="">All time</option>
        </select>
        <input type="search" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search runs…"
          className={`flex-1 min-w-[120px] text-xs ${m.input} border rounded px-2 py-1.5 focus:outline-none focus:border-violet-500 placeholder-gray-400`} />
        {availableProviders.length >= 2 && (
          <button type="button" onClick={() => setShowModelCompare(p => !p)}
            className={`text-xs px-2 py-1.5 rounded border font-semibold transition-colors ${showModelCompare ? 'border-violet-500 text-violet-400' : `${m.border} ${m.textMuted}`}`}>
            Compare Models
          </button>
        )}
      </div>

      {/* Golden Trend */}
      <GoldenTrendBar runs={evalRuns} m={m} />

      {/* Model Comparison */}
      {showModelCompare && <ModelComparisonView runs={evalRuns} m={m} />}

      {/* Compare Panel */}
      {compareSelection.length === 2 && (
        <ComparePanel runs={compareSelection} m={m} compact={compact} copy={copy} onClose={() => setCompareSelection([])} />
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
              onRerun={onRerun}
              isCompareSelected={!!compareSelection.find(r => r.id === run.id)} />
          ))}
        </div>
      )}

      {/* Empty */}
      {!loading && evalRuns.length === 0 && (
        <div className={`text-center py-8 text-xs ${m.textMuted}`}>
          No runs yet. Use the Prompt Editor to enhance a prompt and runs will appear here.
        </div>
      )}

      {/* Load More */}
      {hasMore && (
        <button type="button" onClick={loadMore}
          className={`w-full py-2 text-xs font-semibold rounded-lg border transition-colors ${m.border} ${m.textMuted} hover:border-violet-400 hover:text-violet-400`}>
          Load more
        </button>
      )}
    </div>
  );
}

// ── Main Panel ──
export default function RunTimelinePanel({ m, prompt, copy, compact, pageScroll, runsView: runsViewProp, setRunsView: setRunsViewProp, onRerun }) {
  // Use prop-driven view if provided by App.jsx, otherwise manage locally
  const [localRunsView, setLocalRunsView] = useState('timeline');
  const activeView = runsViewProp || localRunsView;
  const setActiveView = setRunsViewProp || setLocalRunsView;

  // Experiments state for the embedded Compare view
  const experiments = useExperiments({ notify: NOOP });

  const handleTabSwitch = useCallback((view) => {
    setActiveView(view);
  }, [setActiveView]);

  if (!prompt) {
    return (
      <div className={`flex-1 flex items-center justify-center p-8 ${pageScroll ? 'min-h-[60vh]' : ''}`}>
        <p className={`text-sm ${m.textMuted}`}>Select a prompt to see its run history.</p>
      </div>
    );
  }

  return (
    <div className={`flex-1 flex flex-col ${pageScroll ? '' : 'overflow-hidden'}`}>
      {/* ── Runs tab bar ── */}
      <div className={`flex items-center gap-1 px-4 pt-3 pb-0 shrink-0`}>
        {[
          { key: 'timeline', label: 'Timeline', icon: 'Clock' },
          { key: 'compare', label: 'Compare', icon: 'GitBranch' },
        ].map(({ key, label, icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => handleTabSwitch(key)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              activeView === key
                ? 'bg-violet-600 text-white'
                : `${m.btn} ${m.textAlt} hover:text-white`
            }`}
          >
            <Ic n={icon} size={11} />
            {label}
          </button>
        ))}
      </div>

      {/* ── Active sub-view ── */}
      {activeView === 'timeline' && (
        <TimelineContent m={m} prompt={prompt} copy={copy} compact={compact} pageScroll={pageScroll} onRerun={onRerun} />
      )}

      {activeView === 'compare' && (
        <ABTestTab m={m} copy={copy} compact={compact} pageScroll={pageScroll} {...experiments} />
      )}
    </div>
  );
}
