import { useMemo, useState } from 'react';
import Ic from './icons';
import MarkdownPreview from './MarkdownPreview';
import { scorePrompt, wordDiff } from './promptUtils';
import {
  normalizeResultMeta,
  replaceCandidateContent,
  revertAssumptionFromText,
} from './lib/enhancementResult.js';

const CHANGE_STYLES = {
  added: 'border-emerald-400/25 bg-emerald-500/10 text-emerald-300',
  removed: 'border-red-400/25 bg-red-500/10 text-red-300',
  changed: 'border-sky-400/25 bg-sky-500/10 text-sky-300',
};

function metricLabel(value) {
  return Number.isFinite(value) ? value.toLocaleString() : '—';
}

export default function PostEnhanceResults({
  m,
  compact,
  raw,
  enhanced,
  setEnhanced,
  variants,
  resultMeta,
  setResultMeta,
  copy,
  enhance,
  dismiss,
  editingId,
  lib,
  evalRuns,
  showInlineSaveBar,
  saveTitle,
  setSaveTitle,
  suggestedSaveTitle,
  canSavePanel,
  quickSave,
  quickSaveAsNew,
  openSavePanel,
  currentEntry,
}) {
  const [view, setView] = useState('improved');
  const [preview, setPreview] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const normalized = useMemo(
    () => normalizeResultMeta(resultMeta, { enhanced, variants }),
    [resultMeta, enhanced, variants],
  );
  const selected = normalized.candidates.find((candidate) => candidate.id === normalized.selectedCandidateId)
    || normalized.candidates[0]
    || { id: 'improved', label: 'Improved', content: enhanced };
  const quality = scorePrompt(selected.content || '');
  const qualityPoints = quality?.points ?? 0;
  const verdict = normalized.changeSummary
    || (qualityPoints >= 4
      ? 'Clear, structured, and ready to test.'
      : 'Improved structure with room for task-specific refinement.');
  const provider = normalized.provider || evalRuns?.[0]?.provider || '';
  const model = normalized.model || evalRuns?.[0]?.model || '';
  const latencyMs = normalized.latencyMs ?? evalRuns?.[0]?.latencyMs;
  const usage = normalized.usage || evalRuns?.[0]?.usage;

  const selectCandidate = (candidate) => {
    setResultMeta?.({ ...normalized, selectedCandidateId: candidate.id });
    setEnhanced(candidate.content);
    setPreview(false);
  };

  const updateCandidate = (text) => {
    setEnhanced(text);
    setResultMeta?.(replaceCandidateContent(normalized, selected.id, text));
  };

  const revertAssumption = (assumption) => {
    const reverted = revertAssumptionFromText(selected.content, assumption);
    if (reverted.changed) updateCandidate(reverted.text);
  };

  return (
    <section data-testid="output-panel" className="pl-results-shell" aria-labelledby="result-verdict-title">
      <header className="pl-results-verdict">
        <span className="sr-only">Results</span>
        <div className="min-w-0">
          <p className="pl-eyebrow">Enhancement complete</p>
          <h2 id="result-verdict-title">{verdict}</h2>
          <div className="pl-result-metrics" aria-label="Run details">
            {provider && <span>{provider}</span>}
            {model && <span>{model}</span>}
            {Number.isFinite(latencyMs) && <span>{metricLabel(latencyMs)} ms</span>}
            {usage && <span>{metricLabel(usage.input)} in · {metricLabel(usage.output)} out</span>}
            <span>{selected.content.length.toLocaleString()} chars</span>
            <span>Quality {qualityPoints}/5</span>
          </div>
        </div>
        <div className="pl-result-header-actions">
          <button type="button" onClick={() => copy(selected.content)} className="pl-secondary-button">
            <Ic n="Copy" size={13} /> Copy
          </button>
          <button type="button" onClick={enhance} className="pl-secondary-button">
            <Ic n="RefreshCw" size={13} /> Run again
          </button>
          <button type="button" onClick={dismiss} className="pl-icon-button" aria-label="Dismiss enhanced results">
            <Ic n="X" size={15} />
          </button>
        </div>
      </header>

      <div className={`pl-results-body ${compact ? 'is-compact' : ''}`}>
        <aside className="pl-candidate-rail" aria-label="Result candidates">
          <p className="pl-eyebrow">Candidates</p>
          <div role="listbox" aria-label="Enhancement candidates">
            {normalized.candidates.map((candidate, index) => (
              <button
                type="button"
                role="option"
                key={candidate.id}
                aria-selected={candidate.id === selected.id}
                onClick={() => selectCandidate(candidate)}
                className="pl-candidate-card"
              >
                <span className="pl-candidate-number">{String(index + 1).padStart(2, '0')}</span>
                <span className="min-w-0">
                  <strong>{candidate.label}</strong>
                  <small>{candidate.content.split(/\s+/).filter(Boolean).length} words</small>
                </span>
                {candidate.id === selected.id && <Ic n="Check" size={13} />}
              </button>
            ))}
          </div>
        </aside>

        <div className="pl-result-workspace">
          <button type="button" className="pl-original-toggle" aria-expanded={showOriginal} onClick={() => setShowOriginal((value) => !value)}>
            <span><Ic n="FileText" size={13} /> Original prompt</span>
            <Ic n={showOriginal ? 'ChevronUp' : 'ChevronDown'} size={13} />
          </button>
          {showOriginal && <pre className="pl-original-content">{raw}</pre>}

          <div className="pl-result-toolbar">
            <div className="pl-segmented" role="tablist" aria-label="Result views">
              {[
                ['changes', 'Changes'],
                ['improved', selected.label],
                ['compare', 'Side by side'],
              ].map(([id, label]) => (
                <button key={id} type="button" role="tab" aria-selected={view === id} onClick={() => setView(id)} className={view === id ? 'bg-orange-500/90 text-white' : ''}>{label}</button>
              ))}
            </div>
            {view === 'improved' && (
              <button type="button" className="pl-text-button" onClick={() => setPreview((value) => !value)}>
                <Ic n="Eye" size={12} /> {preview ? 'Edit' : 'Preview'}
              </button>
            )}
          </div>

          {view === 'changes' && (
            <div className="pl-change-view">
              {normalized.changes.length > 0 ? (
                <div className="pl-change-list">
                  {normalized.changes.map((change) => (
                    <div key={change.id} className={`pl-change-row ${CHANGE_STYLES[change.type] || CHANGE_STYLES.changed}`}>
                      <span>{change.type}</span><p>{change.label}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="pl-empty-copy">The provider did not return a structured change list. Use Side by side for the exact word-level comparison.</div>
              )}
              <div className="pl-diff-copy">
                {wordDiff(raw, selected.content).map((part, index) => (
                  <span key={index} className={part.t === 'add' ? m.diffAdd : part.t === 'del' ? m.diffDel : m.diffEq}>{part.v}</span>
                ))}
              </div>
            </div>
          )}

          {view === 'improved' && (preview
            ? <div className="pl-result-editor pl-markdown-result"><MarkdownPreview text={selected.content} /></div>
            : (
              <textarea
                data-testid="output-textarea"
                aria-label={`${selected.label} candidate`}
                className="pl-result-editor"
                value={selected.content}
                onChange={(event) => updateCandidate(event.target.value)}
              />
            ))}

          {view === 'compare' && (
            <div className="pl-side-by-side">
              <div><p className="pl-eyebrow">Original</p><pre>{raw}</pre></div>
              <div><p className="pl-eyebrow">{selected.label}</p><pre>{selected.content}</pre></div>
            </div>
          )}

          {normalized.assumptions.length > 0 && (
            <section className="pl-result-section">
              <div className="pl-section-heading"><div><p className="pl-eyebrow">Assumptions</p><h3>Review what the model inferred</h3></div><span>{normalized.assumptions.length}</span></div>
              <div className="pl-assumption-list">
                {normalized.assumptions.map((assumption) => {
                  const canRevert = Boolean(assumption.addedText && selected.content.includes(assumption.addedText));
                  return (
                    <div key={assumption.id} className="pl-assumption-row">
                      <p>{assumption.text}</p>
                      <button type="button" disabled={!canRevert} onClick={() => revertAssumption(assumption)}>Revert</button>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {(normalized.reasoning || normalized.changeSummary) && (
            <details className="pl-reasoning">
              <summary>Why these changes?</summary>
              <p>{normalized.reasoning || normalized.changeSummary}</p>
            </details>
          )}
        </div>
      </div>

      <footer className="pl-result-commit-bar">
        <div className="pl-commit-copy">
          <p className="pl-eyebrow">Commit result</p>
          <label htmlFor="result-save-title" className="sr-only">Prompt title</label>
          <input id="result-save-title" value={saveTitle} placeholder={suggestedSaveTitle} onChange={(event) => setSaveTitle(event.target.value)} />
        </div>
        <div className="pl-commit-actions">
          {editingId && (
            <button type="button" onClick={() => lib.pinGoldenResponse(editingId, {
              text: selected.content,
              runId: normalized.runId || evalRuns?.[0]?.id,
              provider,
              model,
            })} className="pl-secondary-button"><Ic n="Pin" size={13} /> Pin golden</button>
          )}
          {currentEntry && <button type="button" onClick={quickSaveAsNew} disabled={!canSavePanel} className="pl-secondary-button">Save as new prompt</button>}
          <button data-testid="save-to-library" type="button" onClick={quickSave} disabled={!canSavePanel} className="pl-primary-button">
            <Ic n="Save" size={13} /> {currentEntry ? 'Save new version' : 'Save to Library'}
          </button>
          {showInlineSaveBar && <button type="button" className="pl-icon-button" onClick={() => openSavePanel()} aria-label="Open library details"><Ic n="SlidersHorizontal" size={14} /></button>}
        </div>
      </footer>
    </section>
  );
}
