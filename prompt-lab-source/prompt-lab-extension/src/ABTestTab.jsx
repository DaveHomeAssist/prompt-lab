import { useState } from 'react';
import Ic from './icons';
import DiffPane from './DiffPane';

export default function ABTestTab({
  m,
  copy,
  compact = false,
  pageScroll = false,
  abA,
  setAbA,
  abB,
  setAbB,
  abWinner,
  history,
  showHistory,
  setShowHistory,
  evalRuns,
  showRuns,
  setShowRuns,
  activeSide,
  setActiveSide,
  runAB,
  resetAB,
  pickWinner,
  loadHistoryEntry,
}) {
  const inp = `w-full ${m.input} border rounded-lg p-3 text-sm resize-none focus:outline-none focus:border-violet-500 transition-colors placeholder-gray-400 ${m.text}`;
  const [showDiff, setShowDiff] = useState(false);
  const bothReady = Boolean(abA.response && !abA.error && abB.response && !abB.error);

  return (
    <div className={pageScroll ? 'flex flex-col' : 'flex flex-1 flex-col overflow-hidden'}>
      <div className={`px-4 py-2 border-b ${m.border} flex items-center justify-between shrink-0`}>
        <p className={`text-xs font-semibold ${m.textSub} uppercase tracking-wider`}>A/B Prompt Testing</p>
        <div className={`flex items-center gap-3 ${compact ? 'flex-wrap justify-end' : ''}`}>
          {abWinner && <span className="text-xs font-bold text-green-400 flex items-center gap-1"><Ic n="Check" size={11} />Winner: {abWinner}</span>}
          <button type="button" onClick={() => { runAB('a'); runAB('b'); }} disabled={abA.loading || abB.loading}
            className="ui-control flex items-center gap-1.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors">
            <Ic n="FlaskConical" size={12} />Run Both
          </button>
          <button
            type="button"
            onClick={() => setShowDiff(true)}
            disabled={!bothReady}
            className={`ui-control flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors ${bothReady ? 'bg-violet-600 hover:bg-violet-500 text-white' : `${m.btn} ${m.textMuted} cursor-not-allowed`}`}
            title={bothReady ? 'Compare variant outputs' : 'Run both variants first'}
          >
            <Ic n="GitBranch" size={11} />Sync View
          </button>
          <button type="button" onClick={resetAB} className={`ui-control px-2 py-1.5 ${m.btn} rounded-lg text-xs ${m.textAlt} transition-colors`}>Reset</button>
        </div>
      </div>
      <div className={`px-4 py-2 border-b ${m.border}`}>
        <p className={`text-xs ${m.textAlt}`}>
          Each side is sent exactly as one isolated user message with no extra context.
        </p>
        <p className={`text-xs ${m.textMuted} mt-1 font-mono`}>
          Payload: <code>{`messages: [{ role: 'user', content: promptVariant }]`}</code>
        </p>
      </div>
      {compact && (
        <div className={`px-3 py-2 border-b ${m.border} flex gap-1 overflow-x-auto shrink-0`}>
          {[['A', abA], ['B', abB]].map(([side, state]) => (
            <button key={side} type="button" onClick={() => setActiveSide(side)}
              className={`ui-control px-2.5 py-1 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${activeSide === side ? 'bg-violet-600 text-white' : `${m.btn} ${m.textAlt}`}`}>
              Variant {side}{state.response ? ' Ready' : ''}
            </button>
          ))}
        </div>
      )}
      <div className={`flex ${pageScroll ? '' : 'flex-1 overflow-hidden'} ${compact ? 'flex-col' : ''}`}>
        {([['A', abA, setAbA], ['B', abB, setAbB]]).filter(([side]) => !compact || side === activeSide).map(([side, state, setter]) => (
          <div key={side} className={`flex-1 flex flex-col border-r last:border-r-0 ${m.border} ${pageScroll ? '' : 'overflow-hidden'}`}>
            <div className={`px-3 py-2 border-b ${m.border} flex items-center justify-between shrink-0`}>
              <span className="text-xs font-bold text-violet-400 uppercase">Variant {side}</span>
              <div className="flex gap-2">
                <button type="button" onClick={() => runAB(side.toLowerCase())} disabled={state.loading || !state.prompt.trim()}
                  className="ui-control flex items-center gap-1 text-xs bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white px-2 py-1 rounded-lg transition-colors">
                  {state.loading ? <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Ic n="Wand2" size={10} />}Run {side}
                </button>
                {state.response && !abWinner && (
                  <button type="button" onClick={() => pickWinner(side)} className="ui-control flex items-center gap-1 text-xs bg-green-600 hover:bg-green-500 text-white px-2 py-1 rounded-lg transition-colors"><Ic n="Check" size={10} />Pick {side}</button>
                )}
              </div>
            </div>
            <div className="flex flex-col gap-3 p-3 flex-1 overflow-y-auto">
              <div>
                <span className={`text-xs ${m.textSub} font-semibold uppercase tracking-wider block mb-1.5`}>Prompt</span>
                <textarea rows={5} className={inp} placeholder={`Prompt variant ${side}…`} value={state.prompt} onChange={e => setter(p => ({ ...p, prompt: e.target.value }))} />
              </div>
              {(state.response || state.loading) && (
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs text-violet-400 font-semibold uppercase tracking-wider">Response</span>
                    {state.response && !state.error && <span className={`text-xs ${m.textMuted}`}>~{Math.round(state.response.length / 4)} tokens</span>}
                  </div>
                  {state.loading
                    ? <div className={`${m.codeBlock} border ${m.border} rounded-lg p-3 flex items-center gap-2`}><span className="w-3 h-3 border-2 border-violet-500 border-t-transparent rounded-full animate-spin shrink-0" /><span className={`text-xs ${m.textSub}`}>Generating…</span></div>
                    : state.error
                      ? <div className={`${m.surface} border border-red-500/40 rounded-lg p-3 text-xs text-red-400 leading-relaxed`}>{state.response}</div>
                      : <div className={`${m.codeBlock} border ${m.border} rounded-lg p-3 text-xs ${m.textBody} leading-relaxed whitespace-pre-wrap max-h-72 overflow-y-auto`}>{state.response}</div>
                  }
                  {state.error && (
                    <div className="flex gap-3 mt-2">
                      <button type="button" onClick={() => runAB(side.toLowerCase())} className="text-xs text-violet-400 hover:text-violet-300 transition-colors">Retry</button>
                    </div>
                  )}
                  {state.response && !state.error && <button type="button" onClick={() => copy(state.response)} className={`flex items-center gap-1 text-xs ${m.textSub} hover:text-white transition-colors mt-1`}><Ic n="Copy" size={10} />Copy response</button>}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className={`border-t ${m.border} shrink-0`}>
        <button type="button" onClick={() => setShowRuns(p => !p)}
          className={`w-full flex justify-between items-center px-4 py-2 text-xs font-semibold ${m.textSub} uppercase tracking-wider`}>
          <span>Recent Runs ({evalRuns.length})</span>
          <Ic n={showRuns ? 'ChevronUp' : 'ChevronDown'} size={10} />
        </button>
        {showRuns && evalRuns.length > 0 && (
          <div className="px-4 pb-3 flex flex-col gap-2 max-h-48 overflow-y-auto">
            {evalRuns.map((run) => (
              <div key={run.id} className={`${m.surface} border ${m.border} rounded-lg p-2 text-xs`}>
                <div className="flex justify-between items-center gap-2">
                  <span className={`font-semibold ${m.text}`}>{run.variantLabel || run.promptTitle}</span>
                  <span className={m.textMuted}>{new Date(run.createdAt).toLocaleDateString()}</span>
                </div>
                <div className={`mt-1 flex flex-wrap gap-2 ${m.textMuted}`}>
                  <span>{run.provider}</span>
                  <span>{run.model}</span>
                  <span>{run.latencyMs}ms</span>
                </div>
              </div>
            ))}
          </div>
        )}
        {showRuns && evalRuns.length === 0 && (
          <div className={`ui-empty-state px-4 pb-3 text-xs ${m.textMuted}`}>No A/B runs saved yet.</div>
        )}
      </div>
      {/* Experiment History */}
      <div className={`border-t ${m.border} shrink-0`}>
        <button type="button" onClick={() => setShowHistory(p => !p)}
          className={`w-full flex justify-between items-center px-4 py-2 text-xs font-semibold ${m.textSub} uppercase tracking-wider`}>
          <span>History ({history.length})</span>
          <Ic n={showHistory ? 'ChevronUp' : 'ChevronDown'} size={10} />
        </button>
        {showHistory && history.length > 0 && (
          <div className="px-4 pb-3 flex flex-col gap-2 max-h-48 overflow-y-auto">
            {history.slice(0, 20).map(exp => (
              <div key={exp.id} className={`${m.surface} border ${m.border} rounded-lg p-2 text-xs`}>
                <div className="flex justify-between items-start gap-2">
                  <div className="min-w-0">
                    <span className={`font-semibold ${m.text} block truncate`}>{exp.label}</span>
                    <span className={`block mt-0.5 ${m.textMuted}`}>
                      {exp.variants?.map((variant) => variant.provider).filter(Boolean).join(' vs ') || 'Providers unavailable'}
                    </span>
                  </div>
                  <span className={`${m.textMuted} shrink-0`}>{new Date(exp.createdAt).toLocaleDateString()}</span>
                </div>
                {exp.variants?.[0]?.prompt && (
                  <p className={`mt-1 ${m.textAlt} leading-relaxed`}>
                    {exp.variants[0].prompt.slice(0, 96)}{exp.variants[0].prompt.length > 96 ? '…' : ''}
                  </p>
                )}
                {exp.outcome?.winnerVariantId && (
                  <span className="text-green-400 text-[10px]">Winner: Variant {exp.outcome.winnerVariantId}</span>
                )}
                <div className="mt-2 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => loadHistoryEntry(exp)}
                    className="text-xs font-semibold text-violet-400 hover:text-violet-300 transition-colors"
                  >
                    Load
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        {showHistory && history.length === 0 && (
          <div className={`ui-empty-state px-4 pb-3 text-xs ${m.textMuted}`}>No experiments saved yet.</div>
        )}
      </div>
      {showDiff && bothReady && (
        <DiffPane
          textA={abA.response}
          textB={abB.response}
          onClose={() => setShowDiff(false)}
          copy={copy}
          m={m}
        />
      )}
    </div>
  );
}
