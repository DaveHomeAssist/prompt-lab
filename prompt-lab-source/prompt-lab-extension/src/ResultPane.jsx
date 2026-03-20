import Ic from './icons';
import { wordDiff } from './promptUtils';
import MarkdownPreview from './MarkdownPreview';

// ── Result Pane ─────────────────────────────────────────────────────────────
// Pure extraction from App.jsx — enhanced output tabs, run history, golden benchmark.
export default function ResultPane({
  m,
  compact,
  colorMode,
  loading,
  enhanced,
  setEnhanced,
  streaming,
  streamPreview,
  variants,
  notes,
  showNotes,
  resultTab,
  setResultTab,
  enhMdPreview,
  setEnhMdPreview,
  activeResultTab,
  resultTabs,
  resultField,
  copyBtn,
  raw,
  goldenVerdict,
  goldenSimilarity,
  goldenThreshold,
  goldenResponse,
  comparisonText,
  comparisonSourceLabel,
  editingId,
  latestEvalRun,
  evalRuns,
  showEvalHistory,
  setShowEvalHistory,
  showGoldenComparison,
  setShowGoldenComparison,
  handleTabListKeyDown,
  copy,
  setRaw,
  notify,
  pinGoldenResponse,
  clearGoldenResponse,
  setGoldenThreshold,
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto pr-1 space-y-3">
    {/* Enhanced */}
    {(loading || enhanced) && <>
      {loading && !enhanced && (
        <div className={`${m.surface} border ${m.border} rounded-xl p-3`}>
          <div className={`flex justify-between items-start gap-3 mb-3 ${compact ? 'flex-col' : ''}`}>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-violet-400 uppercase tracking-widest font-semibold">Results</span>
                <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-violet-300 animate-pulse" />
                  {streaming ? 'Streaming' : 'Preparing'}
                </span>
              </div>
              <p className={`mt-1 text-xs ${m.textMuted}`}>Output stays live while the request is in flight.</p>
            </div>
          </div>
          <div className="pl-skeleton-stack">
            <div className="pl-skeleton-line w-4/5" />
            <div className="pl-skeleton-line w-full" />
            <div className="pl-skeleton-line w-11/12" />
          </div>
          {streamPreview && (
            <div className={`${m.codeBlock} border ${m.border} rounded-lg p-3 text-xs leading-relaxed whitespace-pre-wrap mt-3 max-h-56 overflow-y-auto`}>
              {streamPreview}
            </div>
          )}
        </div>
      )}
    {enhanced && <>
      <div className={`${m.surface} border border-violet-500/30 rounded-2xl p-4 shadow-sm ${colorMode === 'dark' ? 'bg-violet-950/10' : 'bg-violet-50/60'}`}>
        <div className={`flex justify-between items-start gap-3 mb-3 ${compact ? 'flex-col' : ''}`}>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-violet-400 uppercase tracking-widest font-semibold">Results</span>
              {goldenVerdict && (
                <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${goldenVerdict === 'pass' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
                  {goldenVerdict === 'pass' ? '\u2713' : '\u2717'} {Math.round(goldenSimilarity * 100)}%
                </span>
              )}
            </div>
            <p className={`mt-1 text-xs ${m.textMuted}`}>Review output, compare changes, and decide what to keep.</p>
          </div>
          <div className={`flex items-center gap-2 ${compact ? 'w-full flex-wrap' : 'justify-end flex-wrap'} min-w-0`}>
            {activeResultTab === 'improved' && (
              <button onClick={() => setEnhMdPreview(p => !p)} className={`ui-control flex items-center gap-1 text-sm transition-colors ${enhMdPreview ? 'text-violet-400' : `${m.textSub} hover:text-white`} shrink-0`}>
                <Ic n="Eye" size={10} />{enhMdPreview ? 'Edit' : 'Preview'}
              </button>
            )}
            {editingId && (
              <button
                onClick={() => pinGoldenResponse(editingId, {
                  text: enhanced,
                  runId: latestEvalRun?.id,
                  provider: latestEvalRun?.provider,
                  model: latestEvalRun?.model,
                })}
                disabled={!enhanced.trim()}
                className={`ui-control flex items-center gap-1.5 text-sm px-2 py-1 rounded transition-colors shrink-0 ${
                  enhanced.trim() ? 'bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25' : `${m.btn} ${m.textMuted} opacity-40 cursor-not-allowed`
                }`}
              >
                <Ic n="Save" size={12} />Pin Golden
              </button>
            )}
            <button
              onClick={() => copy(enhanced)}
              className={`ui-control flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg font-semibold transition-colors ${copyBtn} shrink-0`}
            ><Ic n="Copy" size={12} />Copy</button>
            <button
              type="button"
              onClick={() => {
                setRaw(enhanced);
                notify('Enhanced result moved to input.');
              }}
              className={`ui-control flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg font-semibold transition-colors ${m.btn} ${m.textAlt} shrink-0`}
            >
              <Ic n="ArrowLeftRight" size={12} />
              Replace Input
            </button>
          </div>
        </div>

        <div
          className="flex flex-wrap gap-1.5 mb-3"
          role="tablist"
          aria-label="Result views"
          onKeyDown={(event) => handleTabListKeyDown(event, resultTabs, activeResultTab, (id) => {
            setResultTab(id);
            if (id !== 'improved') setEnhMdPreview(false);
          })}
        >
          {resultTabs.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              role="tab"
              tabIndex={activeResultTab === id ? 0 : -1}
              aria-selected={activeResultTab === id}
              onClick={() => {
                setResultTab(id);
                if (id !== 'improved') setEnhMdPreview(false);
              }}
              className={`ui-control rounded-lg px-2.5 py-1.5 text-sm font-semibold transition-colors duration-150 ${
                activeResultTab === id
                  ? 'border-b-2 border-violet-500 bg-violet-500/10 text-violet-400'
                  : `bg-transparent ${m.btn} ${m.textAlt} hover:bg-gray-800/50 hover:text-gray-300`
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {activeResultTab === 'improved' && (
          enhMdPreview ? (
            <div className={`${resultField} border-violet-500/40 overflow-y-auto`} style={{ minHeight: '8rem', maxHeight: '24rem' }}>
              <MarkdownPreview text={enhanced} />
            </div>
          ) : (
            <textarea rows={5} className={`${resultField} border-violet-500/40`} value={enhanced} onChange={e => setEnhanced(e.target.value)} />
          )
        )}

        {activeResultTab === 'diff' && (
          <div className={`${m.codeBlock} border ${m.border} rounded-lg p-3 text-sm leading-loose overflow-x-auto whitespace-pre-wrap break-words [overflow-wrap:anywhere]`}>
            {wordDiff(raw, enhanced).map((d, i) => (
              <span key={i} className={`${d.t === 'add' ? m.diffAdd : d.t === 'del' ? m.diffDel : m.diffEq} px-0.5 rounded mr-0.5 break-words [overflow-wrap:anywhere]`}>{d.v}</span>
            ))}
          </div>
        )}

        {activeResultTab === 'variants' && variants.length > 0 && (
          <div className="flex flex-col gap-2">
            {variants.map((v, i) => (
              <div key={i} className={`${m.codeBlock} border ${m.border} ${m.borderHov} rounded-lg p-3 transition-colors`}>
                <div className="flex justify-between items-center mb-1 gap-3">
                  <span className="text-xs font-bold text-violet-400">{v.label}</span>
                  <div className="flex gap-3">
                    <button onClick={() => { setEnhanced(v.content); setResultTab('improved'); }} className={`text-xs ${m.textAlt} hover:text-violet-400 transition-colors`}>Use</button>
                    <button onClick={() => copy(v.content)} className={`${m.textAlt} hover:text-white transition-colors`}><Ic n="Copy" size={10} /></button>
                  </div>
                </div>
                <p className={`text-xs ${m.textAlt} leading-relaxed whitespace-pre-wrap`}>{v.content}</p>
              </div>
            ))}
          </div>
        )}

        {activeResultTab === 'notes' && showNotes && notes && (
          <div className={`${m.notesBg} border rounded-lg p-3`}>
            <p className={`text-xs font-bold ${m.notesText} mb-1`}>Enhancement Notes</p>
            <p className={`text-xs ${m.textBody} leading-relaxed whitespace-pre-wrap`}>{notes}</p>
          </div>
        )}
      </div>
      <div className={`${m.surface} border ${m.border} rounded-lg`}>
        <button type="button" onClick={() => setShowEvalHistory(p => !p)}
          className={`w-full flex justify-between items-center px-3 py-2 text-xs font-semibold ${m.textSub} uppercase tracking-wider`}>
          <span>{editingId ? `Run History (${evalRuns.length})` : `Recent Runs (${evalRuns.length})`}</span>
          <Ic n={showEvalHistory ? 'ChevronUp' : 'ChevronDown'} size={10} />
        </button>
        {showEvalHistory && evalRuns.length > 0 && (
          <div className="px-3 pb-3 flex flex-col gap-2 max-h-56 overflow-y-auto">
            {evalRuns.map((run) => (
              <div key={run.id} className={`${m.codeBlock} border ${m.border} rounded-lg p-2.5 text-xs`}>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="font-semibold text-violet-400 truncate">{run.variantLabel || run.promptTitle}</span>
                  <span className={m.textMuted}>{new Date(run.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                </div>
                <div className={`flex flex-wrap gap-2 mb-1 ${m.textMuted}`}>
                  <span className="uppercase">{run.mode}</span>
                  <span>{run.provider}</span>
                  <span>{run.model}</span>
                  <span>{run.latencyMs}ms</span>
                  {run.goldenScore != null && (
                    <span className={`font-semibold ${run.goldenScore >= goldenThreshold ? 'text-emerald-400' : 'text-red-400'}`}>
                      golden {Math.round(run.goldenScore * 100)}%
                    </span>
                  )}
                </div>
                <p className={`${m.textBody} leading-relaxed whitespace-pre-wrap`}>{(run.output || '').slice(0, 220)}{run.output && run.output.length > 220 ? '\u2026' : ''}</p>
                {run.output && (
                  <div className="mt-1 flex flex-wrap gap-3">
                    <button onClick={() => copy(run.output, 'Run output copied')}
                      className={`flex items-center gap-1 text-xs px-2 py-1 rounded-md font-semibold transition-colors ${copyBtn}`}>
                      <Ic n="Copy" size={10} />Copy output
                    </button>
                    {editingId && (
                      <button
                        onClick={() => pinGoldenResponse(editingId, {
                          text: run.output,
                          runId: run.id,
                          provider: run.provider,
                          model: run.model,
                        })}
                        className="flex items-center gap-1 text-emerald-400 hover:text-emerald-300 transition-colors font-semibold"
                      >
                        <Ic n="Save" size={10} />Pin as Golden
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        {showEvalHistory && evalRuns.length === 0 && (
          <div className={`ui-empty-state px-3 pb-3 text-xs ${m.textMuted}`}>No saved runs yet.</div>
        )}
      </div>
      {editingId && goldenResponse && (
        <div className={`${m.surface} border ${m.border} rounded-lg`}>
          <button
            type="button"
            onClick={() => setShowGoldenComparison((p) => !p)}
            className={`w-full flex justify-between items-center px-3 py-2 text-xs font-semibold ${m.textSub} uppercase tracking-wider`}
          >
            <span>Golden Benchmark</span>
            <Ic n={showGoldenComparison ? 'ChevronUp' : 'ChevronDown'} size={10} />
          </button>
          {showGoldenComparison && (
            <div className="px-3 pb-3 flex flex-col gap-3">
              <div className={`${m.codeBlock} border ${m.border} rounded-lg p-3`}>
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div>
                    <p className="text-xs font-semibold text-emerald-400 uppercase tracking-wider">Pinned Golden</p>
                    <p className={`text-xs ${m.textMuted} mt-1`}>
                      {goldenResponse.provider || 'Unknown provider'}
                      {goldenResponse.model ? ` \u00b7 ${goldenResponse.model}` : ''}
                      {goldenResponse.pinnedAt ? ` \u00b7 ${new Date(goldenResponse.pinnedAt).toLocaleString()}` : ''}
                    </p>
                  </div>
                  <button
                    onClick={() => clearGoldenResponse(editingId)}
                    className="flex items-center gap-1 text-xs text-red-400 hover:text-red-300 transition-colors font-semibold"
                  >
                    <Ic n="Trash2" size={10} />Clear Golden
                  </button>
                </div>
                <div className="flex items-center justify-between gap-3 mb-1">
                  <span className={`text-xs ${m.textSub}`}>Similarity vs {comparisonSourceLabel.toLowerCase()}</span>
                  <span className={`text-xs font-semibold ${goldenVerdict === 'fail' ? 'text-red-400' : 'text-emerald-400'}`}>
                    {Math.round(goldenSimilarity * 100)}%
                    {goldenVerdict && <span className="ml-1">({goldenVerdict})</span>}
                  </span>
                </div>
                <div className={`relative w-full h-2 rounded-full overflow-hidden ${m.input} border ${m.border}`}>
                  <div className={`h-full transition-all ${goldenVerdict === 'fail' ? 'bg-red-500' : 'bg-emerald-500'}`} style={{ width: `${Math.max(0, Math.min(100, goldenSimilarity * 100))}%` }} />
                  <div className="absolute top-0 bottom-0 w-px bg-white/50" style={{ left: `${goldenThreshold * 100}%` }} title={`Threshold: ${Math.round(goldenThreshold * 100)}%`} />
                </div>
                <div className="flex items-center justify-between gap-2 mt-2">
                  <label className={`text-xs ${m.textMuted}`}>Pass threshold</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="range" min="0" max="100" step="5"
                      value={Math.round(goldenThreshold * 100)}
                      onChange={(e) => setGoldenThreshold(editingId, Number(e.target.value) / 100)}
                      className="w-20 h-1 accent-emerald-500"
                    />
                    <span className={`text-xs font-mono ${m.textSub} w-8 text-right`}>{Math.round(goldenThreshold * 100)}%</span>
                  </div>
                </div>
              </div>
              {comparisonText ? (
                <div>
                  <p className={`text-xs ${m.textSub} font-semibold mb-1 uppercase tracking-wider`}>
                    Word Diff: Golden vs {comparisonSourceLabel}
                  </p>
                  <div className={`${m.codeBlock} border ${m.border} rounded-lg p-3 text-sm leading-loose`}>
                    {wordDiff(goldenResponse.text, comparisonText).map((d, i) => (
                      <span key={i} className={`${d.t === 'add' ? m.diffAdd : d.t === 'del' ? m.diffDel : m.diffEq} px-0.5 rounded mr-0.5`}>
                        {d.v}
                      </span>
                    ))}
                  </div>
                </div>
              ) : (
                <p className={`text-xs ${m.textMuted}`}>No enhanced output or eval run output is available to compare yet.</p>
              )}
            </div>
          )}
        </div>
      )}
    </>}
    </>}
    </div>
  );
}
