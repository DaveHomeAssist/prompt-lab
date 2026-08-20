import { useEffect, useMemo, useRef, useState } from 'react';
import Ic from './icons';
import { callModel } from './api.js';
import { extractTextFromAnthropic } from './promptUtils.js';
import { runChain } from './lib/chainRunner.js';
import { isChainEntry } from './lib/chainSchema.js';
import { initRunPersistence } from './lib/runPersistence.js';
import { scanSensitiveData } from './piiScanner.js';
import { listRunsByTrace } from './experimentStore.js';
import { buildGraphDataset } from './runs/buildGraphDataset.js';

const STEP_BADGE = {
  running: 'bg-orange-500/20 text-orange-300',
  success: 'bg-emerald-500/20 text-emerald-300',
  error: 'bg-red-500/20 text-red-300',
  blocked: 'bg-amber-500/20 text-amber-300',
  canceled: 'bg-gray-500/20 text-gray-300',
};

/**
 * Chain Lab — pick a saved chain, feed it input, watch each step stream through
 * the trace layer, and hand the final output back to the editor.
 */
export default function ChainRunnerPanel({ m, library, notify, copy, setRaw, setTab, onClose }) {
  const chains = useMemo(() => library.filter(isChainEntry), [library]);
  const [chainId, setChainId] = useState('');
  const [chainInput, setChainInput] = useState('');
  const [steps, setSteps] = useState([]);
  const [running, setRunning] = useState(false);
  const [finalOutput, setFinalOutput] = useState('');
  const [runStatus, setRunStatus] = useState('');
  const [traceGraph, setTraceGraph] = useState(null);
  const abortRef = useRef(null);

  useEffect(() => { initRunPersistence(); }, []);
  useEffect(() => {
    if (!chainId && chains.length > 0) setChainId(chains[0].id);
  }, [chains, chainId]);

  const selected = chains.find((entry) => entry.id === chainId) || null;

  const execute = async ({ prompt, provider, model, signal }) => {
    const data = await callModel({
      model: model || 'claude-sonnet-4-6',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }],
      ...(provider ? { provider } : {}),
    }, { signal });
    return extractTextFromAnthropic(data);
  };

  const run = async () => {
    if (!selected || running) return;
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    abortRef.current = controller;
    setRunning(true);
    setSteps(selected.metadata.chain.steps.map((step, index) => ({
      index,
      label: step.label || `Step ${index + 1}`,
      status: 'pending',
    })));
    setFinalOutput('');
    setRunStatus('');
    setTraceGraph(null);

    const result = await runChain({
      chainEntry: selected,
      resolveEntry: (id) => library.find((entry) => entry.id === id) || null,
      input: chainInput,
      execute,
      scan: scanSensitiveData,
      signal: controller?.signal,
      onStepUpdate: (index, update) => {
        setSteps((prev) => prev.map((row) => (row.index === index ? { ...row, ...update } : row)));
      },
    });

    setRunning(false);
    abortRef.current = null;
    setRunStatus(result.status);
    if (result.traceId) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      const traceRuns = await listRunsByTrace(result.traceId);
      const root = traceRuns.find((record) => record.parent_run_id == null) || traceRuns[0];
      if (root) {
        setTraceGraph(buildGraphDataset(traceRuns, {
          traceId: result.traceId,
          rootRunId: root.run_id,
        }));
      }
    }
    if (result.status === 'success') {
      setFinalOutput(result.output || '');
      notify?.(`Chain finished: ${result.results.length} steps.`);
    } else if (result.status === 'canceled') {
      notify?.('Chain canceled.');
    } else {
      notify?.(result.error || 'Chain failed.');
    }
  };

  const cancel = () => {
    abortRef.current?.abort();
  };

  const sendToEditor = () => {
    if (!finalOutput.trim()) return;
    setRaw(finalOutput);
    setTab('editor');
    notify?.('Chain output loaded into the editor.');
  };

  return (
    <div className={`border-t ${m.border} ${m.surface} p-3 flex flex-col gap-3`}>
      <div className="flex items-center justify-between">
        <p className={`text-xs font-semibold ${m.textSub} uppercase tracking-wider flex items-center gap-1.5`}>
          <Ic n="GitBranch" size={12} />Chain Lab
        </p>
        <button type="button" onClick={onClose} aria-label="Close chain lab" className={`ui-control px-2 py-1 rounded-lg text-xs ${m.btn} ${m.textAlt} transition-colors`}>Close</button>
      </div>

      {chains.length === 0 ? (
        <p className={`text-xs ${m.textMuted}`}>
          No chains yet. Build blocks in the composer and use “Save as chain”, then run it from here.
        </p>
      ) : (
        <>
          <div className="flex gap-2 flex-wrap items-center">
            <select value={chainId} onChange={(e) => setChainId(e.target.value)} aria-label="Select chain"
              className={`text-xs ${m.input} border rounded px-2 py-1.5 focus:outline-none flex-1 min-w-[140px]`}>
              {chains.map((entry) => (
                <option key={entry.id} value={entry.id}>{entry.title} ({entry.metadata.chain.steps.length} steps)</option>
              ))}
            </select>
            {!running ? (
              <button type="button" onClick={run} disabled={!selected}
                className="ui-control px-3 py-1.5 rounded-lg text-xs font-semibold bg-orange-600 hover:bg-orange-500 disabled:opacity-40 text-white transition-colors">
                Run Chain
              </button>
            ) : (
              <button type="button" onClick={cancel}
                className="ui-control px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-500/80 hover:bg-red-500 text-white transition-colors">
                Cancel
              </button>
            )}
          </div>
          <textarea
            rows={2}
            value={chainInput}
            onChange={(e) => setChainInput(e.target.value)}
            placeholder="Chain input (fills {{input}} / chainInput vars)…"
            aria-label="Chain input"
            className={`w-full ${m.input} border rounded-lg p-2 text-xs resize-none focus:outline-none ${m.text}`}
          />
          {steps.length > 0 && (
            <ol className="flex flex-col gap-1">
              {steps.map((step) => (
                <li key={step.index} className={`flex items-center gap-2 text-xs border ${m.border} rounded-lg px-2 py-1.5`}>
                  <span className={`px-1.5 py-0.5 rounded font-semibold ${STEP_BADGE[step.status] || `${m.btn} ${m.textMuted}`}`}>
                    {step.status}
                  </span>
                  <span className={`truncate ${m.textBody}`}>{step.index + 1}. {step.label}</span>
                </li>
              ))}
            </ol>
          )}
          {runStatus === 'success' && finalOutput && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className={`text-xs font-semibold ${m.textSub} uppercase tracking-wider`}>Final output</span>
                <div className="flex gap-2">
                  <button type="button" onClick={() => copy?.(finalOutput)} className={`text-xs ${m.textSub} hover:text-white transition-colors`}>Copy</button>
                  <button type="button" onClick={sendToEditor} className="text-xs text-orange-400 hover:text-orange-300 transition-colors">Send to editor</button>
                </div>
              </div>
              <div className={`${m.codeBlock} border ${m.border} rounded-lg p-2 text-xs ${m.textBody} whitespace-pre-wrap max-h-48 overflow-y-auto`}>
                {finalOutput}
              </div>
            </div>
          )}
          {traceGraph?.nodes?.length > 0 && (
            <div className={`${m.codeBlock} border ${m.border} rounded-lg p-2`} data-testid="chain-trace-graph">
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className={`text-xs font-semibold ${m.textSub} uppercase tracking-wider`}>Trace graph</span>
                <span className={`text-[11px] ${m.textMuted}`}>{traceGraph.nodes.length} nodes · {traceGraph.edges.length} edges</span>
              </div>
              <ol className="flex flex-col gap-1">
                {traceGraph.nodes.map((node) => (
                  <li key={node.id} className={`flex items-center gap-2 text-xs ${m.textBody}`}>
                    <span className={`w-2 h-2 rounded-full ${node.status === 'success' ? 'bg-emerald-400' : node.status === 'canceled' ? 'bg-gray-400' : 'bg-red-400'}`} />
                    <span className="font-mono truncate">{node.label}</span>
                    <span className={`ml-auto ${m.textMuted}`}>{node.meta.runtime || node.status}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </>
      )}
    </div>
  );
}
