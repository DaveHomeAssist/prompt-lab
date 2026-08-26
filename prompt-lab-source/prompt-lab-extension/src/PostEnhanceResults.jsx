import { useMemo, useState } from 'react';
import Ic from './icons';
import MarkdownPreview from './MarkdownPreview';
import { scorePrompt, wordDiff } from './promptUtils';
import { handleTabArrowKeys } from './hooks/useDialogA11y.js';
import {
  normalizeResultMeta,
  replaceCandidateContent,
  revertAssumptionFromText,
  revertStructuredEdit,
} from './lib/enhancementResult.js';

const CHANGE_STYLES = {
  added: 'border-emerald-400/25 bg-emerald-500/10 text-emerald-300',
  removed: 'border-red-400/25 bg-red-500/10 text-red-300',
  changed: 'border-sky-400/25 bg-sky-500/10 text-sky-300',
};

function metricLabel(value) {
  return Number.isFinite(value) ? value.toLocaleString() : '—';
}

function candidateMetrics(content) {
  const text = typeof content === 'string' ? content : '';
  return {
    words: text.trim() ? text.trim().split(/\s+/).length : 0,
    chars: text.length,
    score: scorePrompt(text)?.points ?? 0,
  };
}

function restoreStructuredEdit(text, edit) {
  const source = typeof text === 'string' ? text : '';
  const before = typeof edit?.before === 'string' ? edit.before : '';
  const after = typeof edit?.after === 'string' ? edit.after : '';
  if (!after) return { changed: false, text: source };
  if (before && source.includes(before)) {
    const next = source.replace(before, after);
    return { changed: next !== source, text: next };
  }
  if (!source.includes(after)) {
    const next = `${source.trim()}\n\n${after}`.trim();
    return { changed: next !== source.trim(), text: next };
  }
  return { changed: false, text: source };
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
  onCandidateSelection,
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
  const quality = candidateMetrics(selected.content);
  const qualityPoints = quality.score;
  const verdict = normalized.changeSummary
    || (qualityPoints >= 4
      ? 'Clear, structured, and ready to test.'
      : 'Improved structure with room for task-specific refinement.');
  const provider = normalized.provider || evalRuns?.[0]?.provider || '';
  const model = normalized.model || evalRuns?.[0]?.model || '';
  const latencyMs = normalized.latencyMs ?? evalRuns?.[0]?.latencyMs;
  const usage = normalized.usage || evalRuns?.[0]?.usage;
  const reversibleEdits = normalized.reversibleEdits.filter((edit) => (
    !edit.candidateId || edit.candidateId === selected.id || (edit.candidateId === 'improved' && selected.id === 'improved')
  ));

  const selectCandidate = (candidate, next = {}) => {
    const nextMeta = { ...normalized, selectedCandidateId: candidate.id };
    setResultMeta?.(nextMeta);
    setEnhanced(candidate.content);
    if (typeof next.view === 'string') setView(next.view);
    if (typeof next.preview === 'boolean') setPreview(next.preview);
    else setPreview(false);
    onCandidateSelection?.(candidate, nextMeta);
  };

  const updateCandidate = (text, metaOverride = normalized) => {
    setEnhanced(text);
    const nextMeta = replaceCandidateContent(metaOverride, selected.id, text);
    setResultMeta?.(nextMeta);
    onCandidateSelection?.({ ...selected, content: text }, nextMeta);
  };

  const revertAssumption = (assumption) => {
    const reverted = revertAssumptionFromText(selected.content, assumption);
    if (reverted.changed) updateCandidate(reverted.text);
  };

  const toggleStructuredEdit = (edit) => {
    const result = edit.reverted
      ? restoreStructuredEdit(selected.content, edit)
      : revertStructuredEdit(selected.content, edit);
    if (!result.changed) return;
    const nextMeta = {
      ...normalized,
      reversibleEdits: normalized.reversibleEdits.map((item) => (
        item.id === edit.id ? { ...item, reverted: !edit.reverted } : item
      )),
    };
    updateCandidate(result.text, nextMeta);
  };

  const pinCandidate = (candidate) => {
    if (!editingId) return;
    lib.pinGoldenResponse(editingId, {
      text: candidate.content,
      runId: normalized.runId || evalRuns?.[0]?.id,
      candidateId: candidate.id,
      provider,
      model,
    });
  };

  const handleCandidateKeyDown = (event) => {
    if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const options = [...event.currentTarget.querySelectorAll('[role="option"]')];
    if (options.length === 0) return;
    event.preventDefault();
    const activeIndex = Math.max(0, options.findIndex((option) => option.dataset.candidateId === selected.id));
    const forward = ['ArrowDown', 'ArrowRight'].includes(event.key);
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? options.length - 1
        : (activeIndex + (forward ? 1 : -1) + options.length) % options.length;
    const nextCandidate = normalized.candidates[nextIndex];
    selectCandidate(nextCandidate);
    options[nextIndex]?.focus();
  };

  return (
    <section data-testid="output-panel" className="pl-results-shell" aria-labelledby="result-verdict-title">
      <p className="sr-only" role="status" aria-live="polite">
        Enhancement complete. {normalized.candidates.length} candidate{normalized.candidates.length === 1 ? '' : 's'} available. {selected.label} selected.
      </p>
      <header className="pl-results-verdict">
        <span className="sr-only">Results</span>
        <div className="min-w-0">
          <p className="pl-eyebrow">What changed</p>
          <h2 id="result-verdict-title">{verdict}</h2>
          <div className="pl-result-metrics" aria-label="Run details">
            {provider && <span>{provider}</span>}
            {model && <span>{model}</span>}
            {Number.isFinite(latencyMs) && <span>{metricLabel(latencyMs)} ms</span>}
            {usage && <span>{metricLabel(usage.input)} input · {metricLabel(usage.output)} output · {metricLabel(usage.total)} total tokens</span>}
            <span>{quality.words.toLocaleString()} words · {quality.chars.toLocaleString()} chars</span>
            <span>Quality {qualityPoints}/5</span>
          </div>
          {normalized.tags.length > 0 && (
            <ul className="pl-result-tags" aria-label="Suggested tags">
              {normalized.tags.map((tag) => <li key={tag}>{tag}</li>)}
            </ul>
          )}
        </div>
        <div className="pl-result-header-actions" role="toolbar" aria-label="Result actions">
          <button type="button" onClick={() => copy(selected.content)} className="pl-secondary-button">
            <Ic n="Copy" size={13} /> Copy selected
          </button>
          <button type="button" onClick={enhance} className="pl-secondary-button">
            <Ic n="RefreshCw" size={13} /> Re-run
          </button>
          <button type="button" onClick={dismiss} className="pl-icon-button" aria-label="Discard results and keep them available to restore">
            <Ic n="X" size={15} />
          </button>
        </div>
      </header>

      <div className={`pl-results-body ${compact ? 'is-compact' : ''}`}>
        <aside className="pl-candidate-rail" aria-label="Result candidates">
          <p className="pl-eyebrow">Candidates</p>
          <div role="listbox" aria-label="Enhancement candidates" onKeyDown={handleCandidateKeyDown}>
            {normalized.candidates.map((candidate, index) => {
              const metrics = candidateMetrics(candidate.content);
              const active = candidate.id === selected.id;
              return (
                <button
                  key={candidate.id}
                  type="button"
                  role="option"
                  data-candidate-id={candidate.id}
                  aria-selected={active}
                  tabIndex={active ? 0 : -1}
                  onClick={() => selectCandidate(candidate)}
                  className="pl-candidate-card"
                >
                  <span className="pl-candidate-number">{String(index + 1).padStart(2, '0')}</span>
                  <span className="min-w-0">
                    <strong>{candidate.label}</strong>
                    <small>{metrics.score}/5 · {metrics.words} words · {metrics.chars} chars</small>
                  </span>
                  {active && <Ic n="Check" size={13} />}
                </button>
              );
            })}
          </div>
          <div className="pl-candidate-actions" role="toolbar" aria-label={`${selected.label} actions`}>
            <button type="button" onClick={() => selectCandidate(selected, { view: 'improved', preview: true })}>Preview</button>
            <button type="button" onClick={() => selectCandidate(selected, { view: 'compare', preview: false })}>Diff</button>
            <button type="button" onClick={() => copy(selected.content, `${selected.label} copied`)}>Copy</button>
            <button type="button" disabled={!canSavePanel} onClick={() => quickSave(selected)}>Save</button>
            {editingId && <button type="button" onClick={() => pinCandidate(selected)}>Pin</button>}
          </div>
        </aside>

        <div className="pl-result-workspace">
          <button type="button" className="pl-original-toggle" aria-expanded={showOriginal} aria-controls="enhancement-original" onClick={() => setShowOriginal((value) => !value)}>
            <span><Ic n="FileText" size={13} /> Original prompt</span>
            <Ic n={showOriginal ? 'ChevronUp' : 'ChevronDown'} size={13} />
          </button>
          {showOriginal && <pre id="enhancement-original" className="pl-original-content">{raw}</pre>}

          <div className="pl-result-toolbar">
            <div
              className="pl-segmented"
              role="tablist"
              aria-label="Result views"
              onKeyDown={(event) => handleTabArrowKeys(event, view, setView)}
            >
              {[
                ['changes', 'Changes'],
                ['improved', 'Improved'],
                ['compare', 'Side-by-side'],
              ].map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  id={`result-tab-${id}`}
                  role="tab"
                  data-tab-id={id}
                  aria-selected={view === id}
                  aria-controls={`result-panel-${id}`}
                  tabIndex={view === id ? 0 : -1}
                  onClick={() => setView(id)}
                >
                  {label}
                </button>
              ))}
            </div>
            {view === 'improved' && (
              <button type="button" className="pl-text-button" aria-pressed={preview} onClick={() => setPreview((value) => !value)}>
                <Ic n="Eye" size={12} /> {preview ? 'Edit' : 'Preview'}
              </button>
            )}
          </div>

          {view === 'changes' && (
            <div id="result-panel-changes" role="tabpanel" aria-labelledby="result-tab-changes" className="pl-change-view">
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
              <div className="pl-diff-copy" aria-label={`Word-level changes for ${selected.label}`}>
                {wordDiff(raw, selected.content).map((part, index) => (
                  part.t === 'add'
                    ? <ins key={index} className={m.diffAdd}>{part.v}</ins>
                    : part.t === 'del'
                      ? <del key={index} className={m.diffDel}>{part.v}</del>
                      : <span key={index} className={m.diffEq}>{part.v}</span>
                ))}
              </div>
            </div>
          )}

          {view === 'improved' && (
            <div id="result-panel-improved" role="tabpanel" aria-labelledby="result-tab-improved">
              {preview
                ? <div className="pl-result-editor pl-markdown-result"><MarkdownPreview text={selected.content} /></div>
                : (
                  <textarea
                    data-testid="output-textarea"
                    aria-label={`${selected.label} candidate`}
                    className="pl-result-editor"
                    value={selected.content}
                    onChange={(event) => updateCandidate(event.target.value)}
                  />
                )}
            </div>
          )}

          {view === 'compare' && (
            <div id="result-panel-compare" role="tabpanel" aria-labelledby="result-tab-compare" className="pl-side-by-side">
              <div><p className="pl-eyebrow">Original</p><pre>{raw}</pre></div>
              <div><p className="pl-eyebrow">{selected.label}</p><pre>{selected.content}</pre></div>
            </div>
          )}

          {normalized.assumptions.length > 0 && (
            <section className="pl-result-section">
              <div className="pl-section-heading"><div><p className="pl-eyebrow">Assumptions</p><h3>Review what the model inferred</h3></div><span>{normalized.assumptions.length}</span></div>
              <div className="pl-assumption-list">
                {normalized.assumptions.map((assumption) => {
                  const hasStructuredEdit = reversibleEdits.some((edit) => edit.after === assumption.addedText);
                  const canRevert = !hasStructuredEdit && Boolean(assumption.addedText && selected.content.includes(assumption.addedText));
                  return (
                    <div key={assumption.id} className="pl-assumption-row">
                      <p>{assumption.text}</p>
                      {assumption.addedText && (
                        <button type="button" disabled={!canRevert} onClick={() => revertAssumption(assumption)}>
                          {hasStructuredEdit ? 'Managed below' : 'Revert'}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {reversibleEdits.length > 0 && (
            <section className="pl-result-section">
              <div className="pl-section-heading"><div><p className="pl-eyebrow">Reversible edits</p><h3>Accept or undo model-added decisions</h3></div><span>{reversibleEdits.length}</span></div>
              <div className="pl-reversible-list">
                {reversibleEdits.map((edit) => (
                  <div key={edit.id} className="pl-reversible-row">
                    <div>
                      <strong>{edit.label}</strong>
                      <small>{edit.operation}{edit.reverted ? ' · reverted' : ' · applied'}</small>
                    </div>
                    <button type="button" onClick={() => toggleStructuredEdit(edit)}>
                      <Ic n="RotateCcw" size={12} /> {edit.reverted ? 'Reapply' : 'Revert'}
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}

          {(normalized.reasoning || normalized.changeSummary) && (
            <details className="pl-reasoning">
              <summary>Why these changes?</summary>
              <p>{normalized.reasoning || normalized.changeSummary}</p>
            </details>
          )}

          {evalRuns?.length > 0 && (
            <details className="pl-result-history">
              <summary>Prompt history ({evalRuns.length})</summary>
              <ol>
                {evalRuns.slice(0, 5).map((run) => (
                  <li key={run.id}>
                    <span>{new Date(run.createdAt || run.timestamp || Date.now()).toLocaleString()}</span>
                    <strong>{run.selectedCandidateId || run.mode || run.status || 'enhance'}</strong>
                    <small>{run.provider || 'provider'}{run.model ? ` · ${run.model}` : ''}</small>
                  </li>
                ))}
              </ol>
            </details>
          )}
        </div>
      </div>

      <footer className="pl-result-commit-bar">
        <div className="pl-commit-copy">
          <p className="pl-eyebrow">Commit selected result</p>
          <label htmlFor="result-save-title" className="sr-only">Prompt title</label>
          <input id="result-save-title" value={saveTitle} placeholder={suggestedSaveTitle} onChange={(event) => setSaveTitle(event.target.value)} />
        </div>
        <div className="pl-commit-actions">
          {editingId && (
            <button type="button" onClick={() => pinCandidate(selected)} className="pl-secondary-button"><Ic n="Pin" size={13} /> Pin golden</button>
          )}
          {currentEntry && <button type="button" onClick={() => quickSaveAsNew(selected)} disabled={!canSavePanel} className="pl-secondary-button">Save as new prompt</button>}
          <button data-testid="save-to-library" type="button" onClick={() => quickSave(selected)} disabled={!canSavePanel} className="pl-primary-button">
            <Ic n="Save" size={13} /> {currentEntry ? 'Save new version' : 'Save as new prompt'}
          </button>
          {showInlineSaveBar && <button type="button" className="pl-icon-button" onClick={() => openSavePanel()} aria-label="Open library details"><Ic n="SlidersHorizontal" size={14} /></button>}
        </div>
      </footer>
    </section>
  );
}
