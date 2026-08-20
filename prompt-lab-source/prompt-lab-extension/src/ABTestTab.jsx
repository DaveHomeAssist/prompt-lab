import { useEffect, useState } from 'react';
import Ic from './icons';
import DiffPane from './DiffPane';
import { getConfiguredProviders } from './lib/platform.js';
import { handleTabArrowKeys } from './hooks/useDialogA11y.js';

export default function ABTestTab({
  m,
  copy,
  compact = false,
  pageScroll = false,
  abA,
  abB,
  abWinner,
  history,
  showHistory,
  setShowHistory,
  evalRuns,
  showRuns,
  setShowRuns,
  activeSide,
  setActiveSide,
  abProviders = { a: null, b: null },
  setSideProvider,
  runAB,
  resetAB,
  pickWinner,
  variants = [],
  setVariant,
  addVariant,
  removeVariant,
  runAll,
  promoteToGolden,
  pinGoldenResponse,
}) {
  const inp = `w-full ${m.input} border rounded-lg p-3 text-sm resize-none focus:outline-none focus:border-orange-500 transition-colors placeholder-gray-400 ${m.text}`;
  const [showDiff, setShowDiff] = useState(false);
  const [availableProviders, setAvailableProviders] = useState([]);
  const [baselineId, setBaselineId] = useState('a');
  const arenaVariants = variants.length >= 2 ? variants : [
    { id: 'a', label: 'A', ...abA },
    { id: 'b', label: 'B', ...abB },
  ];
  const baseline = arenaVariants.find((variant) => variant.id === baselineId) || arenaVariants[0];
  const diffTarget = arenaVariants.find((variant) => variant.id !== baseline.id && variant.response && !variant.error);
  const canDiff = Boolean(baseline?.response && !baseline.error && diffTarget);
  const anyLoading = arenaVariants.some((variant) => variant.loading);

  useEffect(() => {
    let active = true;
    getConfiguredProviders()
      .then((list) => { if (active) setAvailableProviders(Array.isArray(list) ? list : []); })
      .catch(() => { /* provider discovery is best-effort; the default provider still works */ });
    return () => { active = false; };
  }, []);

  return (
    <div className={pageScroll ? 'flex flex-col' : 'flex flex-1 flex-col overflow-hidden'}>
      <div className={`px-4 py-2 border-b ${m.border} flex items-center justify-between shrink-0`}>
        <p className={`text-xs font-semibold ${m.textSub} uppercase tracking-wider`}>Model Arena · {arenaVariants.length} variants</p>
        <div className={`flex items-center gap-3 ${compact ? 'flex-wrap justify-end' : ''}`}>
          {abWinner && <span className="text-xs font-bold text-green-400 flex items-center gap-1"><Ic n="Check" size={11} />Winner: {abWinner}</span>}
          <button type="button" onClick={runAll} disabled={anyLoading || !arenaVariants.some((variant) => variant.prompt.trim())}
            className="ui-control flex items-center gap-1.5 bg-orange-600 hover:bg-orange-500 disabled:opacity-40 text-white px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors">
            <Ic n="FlaskConical" size={12} />Run All
          </button>
          <button type="button" onClick={addVariant} disabled={arenaVariants.length >= 5}
            className={`ui-control px-2.5 py-1.5 rounded-lg text-xs font-semibold ${m.btn} ${m.textAlt} disabled:opacity-40 transition-colors`}>+ Variant</button>
          <button
            type="button"
            onClick={() => setShowDiff(true)}
            disabled={!canDiff}
            className={`ui-control flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors ${canDiff ? 'bg-orange-600 hover:bg-orange-500 text-white' : `${m.btn} ${m.textMuted} cursor-not-allowed`}`}
            title={canDiff ? 'Compare the baseline with another completed output' : 'Run at least two variants first'}
          >
            <Ic n="GitBranch" size={11} />Sync View
          </button>
          <button type="button" onClick={resetAB} className={`ui-control px-2 py-1.5 ${m.btn} rounded-lg text-xs ${m.textAlt} transition-colors`}>Reset</button>
        </div>
      </div>
      <div className={`px-4 py-2 border-b ${m.border}`}>
        <p className={`text-xs ${m.textAlt}`}>
          Compare 2–5 prompt/model combinations concurrently. Each variant is sent as one isolated user message with no extra context.
        </p>
        <p className={`text-xs ${m.textMuted} mt-1 font-mono`}>
          Payload: <code>{`messages: [{ role: 'user', content: promptVariant }]`}</code>
        </p>
      </div>
      {compact && (
        <div className={`px-3 py-2 border-b ${m.border} flex gap-1 overflow-x-auto shrink-0`} role="tablist" aria-label="Prompt variants" onKeyDown={(event) => handleTabArrowKeys(event, activeSide, setActiveSide)}>
          {arenaVariants.map((state) => (
            <button key={state.id} type="button" role="tab" data-tab-id={state.label} aria-selected={activeSide === state.label} tabIndex={activeSide === state.label ? 0 : -1} onClick={() => setActiveSide(state.label)}
              className={`ui-control px-2.5 py-1 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${activeSide === state.label ? 'bg-orange-600 text-white' : `${m.btn} ${m.textAlt}`}`}>
              Variant {state.label}{state.response ? ' Ready' : ''}
            </button>
          ))}
        </div>
      )}
      <div className={`flex ${pageScroll ? '' : 'flex-1 overflow-hidden'} ${compact ? 'flex-col' : 'overflow-x-auto'}`}>
        {arenaVariants.filter((state) => !compact || state.label === activeSide).map((state) => {
          const side = state.label;
          const setter = (updater) => setVariant(state.id, updater);
          return (
          <div key={state.id} className={`flex flex-col border-r last:border-r-0 ${m.border} ${pageScroll ? '' : 'overflow-hidden'} ${compact ? 'flex-1' : 'min-w-[19rem] flex-1'}`}>
            <div className={`px-3 py-2 border-b ${m.border} flex items-center justify-between gap-2 shrink-0`}>
              <span className="text-xs font-bold text-orange-400 uppercase shrink-0">Variant {side}</span>
              {availableProviders.length > 0 && typeof setSideProvider === 'function' && (
                <select
                  aria-label={`Provider for variant ${side}`}
                  value={abProviders[state.id] ? `${abProviders[state.id].provider}::${abProviders[state.id].model}` : ''}
                  onChange={(e) => {
                    const descriptor = availableProviders.find((p) => `${p.provider}::${p.model}` === e.target.value) || null;
                    setSideProvider(state.id, descriptor);
                  }}
                  className={`text-xs ${m.input} border rounded px-1.5 py-1 min-w-0 flex-1 focus:outline-none focus:border-orange-500`}>
                  <option value="">Default provider</option>
                  {availableProviders.map((p) => (
                    <option key={`${p.provider}-${p.model}`} value={`${p.provider}::${p.model}`}>{p.provider} · {p.model}</option>
                  ))}
                </select>
              )}
              <div className="flex gap-2 shrink-0">
                <button type="button" onClick={() => runAB(state.id)} disabled={state.loading || !state.prompt.trim()}
                  className="ui-control flex items-center gap-1 text-xs bg-orange-600 hover:bg-orange-500 disabled:opacity-40 text-white px-2 py-1 rounded-lg transition-colors">
                  {state.loading ? <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Ic n="Wand2" size={10} />}Run {side}
                </button>
                {state.response && !abWinner && (
                  <button type="button" onClick={() => pickWinner(side)} className="ui-control flex items-center gap-1 text-xs bg-green-600 hover:bg-green-500 text-white px-2 py-1 rounded-lg transition-colors"><Ic n="Check" size={10} />Pick {side}</button>
                )}
                {arenaVariants.length > 2 && state.id !== 'a' && state.id !== 'b' && (
                  <button type="button" onClick={() => removeVariant(state.id)} aria-label={`Remove variant ${side}`}
                    className="ui-control text-xs text-red-300 px-1">×</button>
                )}
              </div>
            </div>
            <div className="flex flex-col gap-3 p-3 flex-1 overflow-y-auto">
              <div>
                <span className={`text-xs ${m.textSub} font-semibold uppercase tracking-wider block mb-1.5`}>Prompt</span>
                <textarea rows={5} aria-label={`Prompt for variant ${side}`} className={inp} placeholder={`Prompt variant ${side}…`} value={state.prompt} onChange={e => setter(p => ({ ...p, prompt: e.target.value }))} />
              </div>
              {(state.response || state.loading) && (
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs text-orange-400 font-semibold uppercase tracking-wider">Response</span>
                    {state.response && !state.error && <span className={`text-xs ${m.textMuted}`}>~{Math.round(state.response.length / 4)} tokens</span>}
                  </div>
                  {state.loading
                    ? <div className={`${m.codeBlock} border ${m.border} rounded-lg p-3 flex items-center gap-2`}><span className="w-3 h-3 border-2 border-orange-500 border-t-transparent rounded-full animate-spin shrink-0" /><span className={`text-xs ${m.textSub}`}>Generating…</span></div>
                    : state.error
                      ? <div className={`${m.surface} border border-red-500/40 rounded-lg p-3 text-xs text-red-400 leading-relaxed`}>{state.response}</div>
                      : <div className={`${m.codeBlock} border ${m.border} rounded-lg p-3 text-xs ${m.textBody} leading-relaxed whitespace-pre-wrap max-h-72 overflow-y-auto`}>{state.response}</div>
                  }
                  {state.error && (
                    <div className="flex gap-3 mt-2">
                      <button type="button" onClick={() => runAB(state.id)} className="text-xs text-orange-400 hover:text-orange-300 transition-colors">Retry</button>
                    </div>
                  )}
                  {state.response && !state.error && (
                    <div className="mt-1 flex flex-wrap gap-3">
                      <button type="button" onClick={() => copy(state.response)} className={`flex items-center gap-1 text-xs ${m.textSub} hover:text-white transition-colors`}><Ic n="Copy" size={10} />Copy response</button>
                      <button type="button" onClick={() => promoteToGolden(state.id, pinGoldenResponse)}
                        className="text-xs text-amber-300 hover:text-amber-200 transition-colors">Promote to Golden</button>
                      <label className={`flex items-center gap-1 text-xs ${m.textMuted}`}>
                        <input type="radio" name="arena-baseline" checked={baselineId === state.id} onChange={() => setBaselineId(state.id)} />Baseline
                      </label>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        );})}
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
          <div className={`ui-empty-state px-4 pb-3 text-xs ${m.textMuted}`}>
            No compare runs yet. Load prompts from the library or paste two variants, then run both to start the Evaluate log.
          </div>
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
                <div className="flex justify-between items-center">
                  <span className={`font-semibold ${m.text}`}>{exp.label}</span>
                  <span className={m.textMuted}>{new Date(exp.createdAt).toLocaleDateString()}</span>
                </div>
                {exp.outcome?.winnerVariantId && (
                  <span className="text-green-400 text-[10px]">Winner: Variant {exp.outcome.winnerVariantId}</span>
                )}
              </div>
            ))}
          </div>
        )}
        {showHistory && history.length === 0 && (
          <div className={`ui-empty-state px-4 pb-3 text-xs ${m.textMuted}`}>
            No comparison history yet. Pick a winner after running both variants and the decision trail will show up here.
          </div>
        )}
      </div>
      {showDiff && canDiff && (
        <DiffPane
          textA={baseline.response}
          textB={diffTarget.response}
          onClose={() => setShowDiff(false)}
          copy={copy}
          m={m}
        />
      )}
    </div>
  );
}
