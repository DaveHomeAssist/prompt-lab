import { useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Ic from './icons';
import MarkdownPreview from './MarkdownPreview';
import { scorePrompt, wordDiff } from './promptUtils';
import { handleTabArrowKeys } from './hooks/useDialogA11y.js';
import { SAVE_LABELS } from './lib/promptLifecycle.js';
import { normalizeResultMeta, replaceCandidateContent, revertAssumptionFromText, revertStructuredEdit } from './lib/enhancementResult.js';

const CHANGE_STYLES = {
  added: 'border-emerald-400/25 bg-emerald-500/10 text-emerald-300',
  removed: 'border-red-400/25 bg-red-500/10 text-red-300',
  changed: 'border-sky-400/25 bg-sky-500/10 text-sky-300',
};
const metricLabel = value => Number.isFinite(value) ? value.toLocaleString() : '—';
function candidateMetrics(content) {
  const text = typeof content === 'string' ? content : '';
  return { words: text.trim() ? text.trim().split(/\s+/).length : 0, chars: text.length, score: scorePrompt(text)?.points ?? 0 };
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
  m, compact, raw, enhanced, setEnhanced, variants, resultMeta, setResultMeta, copy, enhance, dismiss,
  editingId, lib, evalRuns, showInlineSaveBar, saveTitle, setSaveTitle, suggestedSaveTitle, canSavePanel,
  quickSave, quickSaveAsNew, openSavePanel, currentEntry, onCandidateSelection,
  // Two-pane Create workspace (docs/ENHANCE_WORKSPACE_REDESIGN_BRIEF.md, slice 1):
  // one primary Save and Copy live in the commit bar, and the assumptions count
  // sits in the header.
  splitWorkspace = false,
  // Slice 2A: name what the candidate toolbar's Save does, as the commit bar does.
  explicitSaveLabels = false,
  saveBarTarget = null,
}) {
  const assumptionsHeadingRef = useRef(null);
  const [view, setView] = useState('improved');
  const [preview, setPreview] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const [saveFeedback, setSaveFeedback] = useState(null);
  const savePendingRef = useRef(false);
  const normalized = useMemo(() => normalizeResultMeta(resultMeta, { enhanced, variants }), [resultMeta, enhanced, variants]);
  const selected = normalized.candidates.find(candidate => candidate.id === normalized.selectedCandidateId)
    || normalized.candidates[0] || { id: 'improved', label: 'Improved', content: enhanced };
  const primaryId = normalized.primaryId || 'improved';
  const isPrimary = selected.id === primaryId;
  const assumptions = normalized.assumptions.filter(item => (item.candidateId || 'improved') === selected.id);
  const changes = normalized.changes.filter(item => (item.candidateId || 'improved') === selected.id);
  const metrics = candidateMetrics(selected.content);
  const verdict = (isPrimary && normalized.changeSummary) || 'Review this candidate against your original requirements.';
  const provider = normalized.provider || evalRuns?.[0]?.provider || '';
  const model = normalized.model || evalRuns?.[0]?.model || '';
  const latencyMs = normalized.latencyMs ?? evalRuns?.[0]?.latencyMs;
  const usage = normalized.usage || evalRuns?.[0]?.usage;
  const reversibleEdits = normalized.reversibleEdits.filter(edit => !edit.candidateId || edit.candidateId === selected.id);
  const saving = Boolean(lib?.saving || saveFeedback?.state === 'pending');
  const changedSinceSave = saveFeedback?.state === 'saved' && (
    saveFeedback.content !== selected.content || saveFeedback.raw !== raw
    || saveFeedback.candidateId !== selected.id || saveFeedback.runId !== normalized.runId
    || saveFeedback.title !== (saveTitle || suggestedSaveTitle)
  );
  const resultSaveMessage = saving ? `Saving ${selected.label}…`
    : saveFeedback?.state === 'failed' || lib?.saveError ? 'Save failed. Your result is still here. Retry saving.'
      : saveFeedback?.state === 'saved'
        ? `Saved ${saveFeedback.label} to “${saveFeedback.title}” · version ${saveFeedback.versionNumber}.${changedSinceSave ? ' Current result has unsaved changes.' : ''}`
        : currentEntry ? `Selected: ${selected.label}. Save adds a version to “${currentEntry.title}”.` : `Selected: ${selected.label}. Not saved to Library yet.`;
  const saveSelected = async (asNew = false) => {
    if (savePendingRef.current) return;
    savePendingRef.current = true;
    const snapshot = { content: selected.content, raw, candidateId: selected.id, label: selected.label, runId: normalized.runId };
    setSaveFeedback({ state: 'pending' });
    try {
      let saved = asNew ? quickSaveAsNew(selected) : quickSave(selected);
      if (saved?.then) saved = await saved;
      setSaveFeedback(saved?.id ? { ...snapshot, state: 'saved', title: saved.title || saveTitle || suggestedSaveTitle, versionNumber: saved.versionNumber || 1 } : { state: 'failed' });
    } catch {
      setSaveFeedback({ state: 'failed' });
    } finally { savePendingRef.current = false; }
  };

  const selectCandidate = (candidate, next = {}) => {
    const nextMeta = { ...normalized, selectedCandidateId: candidate.id };
    setResultMeta?.(nextMeta);
    setEnhanced(candidate.content);
    if (typeof next.view === 'string') setView(next.view);
    setPreview(typeof next.preview === 'boolean' ? next.preview : false);
    onCandidateSelection?.(candidate, nextMeta);
  };
  const updateCandidate = (text, metaOverride = normalized) => {
    setEnhanced(text);
    const nextMeta = replaceCandidateContent(metaOverride, selected.id, text);
    setResultMeta?.(nextMeta);
    onCandidateSelection?.({ ...selected, content: text }, nextMeta);
  };
  const revertAssumption = assumption => {
    const reverted = revertAssumptionFromText(selected.content, assumption);
    if (reverted.changed) updateCandidate(reverted.text);
  };
  const toggleStructuredEdit = edit => {
    const result = edit.reverted ? restoreStructuredEdit(selected.content, edit) : revertStructuredEdit(selected.content, edit);
    if (!result.changed) return;
    const nextMeta = {
      ...normalized,
      reversibleEdits: normalized.reversibleEdits.map(item => item.id === edit.id ? { ...item, reverted: !edit.reverted } : item),
    };
    updateCandidate(result.text, nextMeta);
  };
  const pinCandidate = candidate => {
    if (!editingId) return;
    lib.pinGoldenResponse(editingId, { text: candidate.content, runId: normalized.runId || evalRuns?.[0]?.id, candidateId: candidate.id, provider, model });
  };
  const handleCandidateKeyDown = event => {
    if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const options = [...event.currentTarget.querySelectorAll('[role="option"]')];
    if (!options.length) return;
    event.preventDefault();
    const activeIndex = Math.max(0, options.findIndex(option => option.dataset.candidateId === selected.id));
    const forward = ['ArrowDown', 'ArrowRight'].includes(event.key);
    const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (activeIndex + (forward ? 1 : -1) + options.length) % options.length;
    selectCandidate(normalized.candidates[nextIndex]);
    options[nextIndex]?.focus();
  };

  const saveBar = (
      <footer className="pl-result-commit-bar">
        <div className="pl-commit-copy"><p className="pl-eyebrow">Save selected result</p><label htmlFor="result-save-title" className="sr-only">Prompt title</label><input id="result-save-title" value={saveTitle} placeholder={suggestedSaveTitle} onChange={event => setSaveTitle(event.target.value)} /></div>
        <div className="pl-commit-actions">
          {splitWorkspace && (
            <button type="button" onClick={() => copy(selected.content, `${selected.label} copied`)} className="pl-secondary-button"><Ic n="Copy" size={13} /> Copy</button>
          )}
          <button data-testid="save-to-library" type="button" onClick={() => saveSelected()} disabled={!canSavePanel || saving} className="pl-primary-button"><Ic n="Save" size={13} /> {saving ? 'Saving…' : currentEntry ? 'Save new version' : 'Save as new prompt'}{splitWorkspace && <span className="pl-commit-target"> · {selected.label}</span>}</button>
          {(editingId || currentEntry || showInlineSaveBar) && <details className="pl-result-save-more" onKeyDown={event => {
            if (event.key === 'Escape') { event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus(); }
          }}>
            <summary className="pl-secondary-button">More</summary>
            <div className="pl-result-save-menu" role="group" aria-label="Secondary result actions">
              {currentEntry && <button type="button" onClick={() => saveSelected(true)} disabled={!canSavePanel || saving} className="pl-secondary-button">Save as new prompt</button>}
              {editingId && <button type="button" onClick={() => pinCandidate(selected)} title="Set the comparison baseline. This does not save a Library version." className="pl-secondary-button"><Ic n="Pin" size={13} /> Pin golden</button>}
              {showInlineSaveBar && <button type="button" className="pl-secondary-button" onClick={() => openSavePanel()}>Library details</button>}
            </div>
          </details>}
        </div>
        <p role="status" aria-live="polite" className="pl-result-save-feedback">{resultSaveMessage}</p>
      </footer>
  );

  return (
    <section data-testid="output-panel" className="pl-results-shell" aria-labelledby="result-verdict-title">
      <p className="sr-only" role="status" aria-live="polite">Enhancement complete. {normalized.candidates.length} candidate{normalized.candidates.length === 1 ? '' : 's'} available. {selected.label} selected.</p>
      {saveBarTarget ? createPortal(saveBar, saveBarTarget) : saveBar}

      <header className="pl-results-verdict">
        <span className="sr-only">Results</span>
        <div className="min-w-0">
          <p className="pl-eyebrow">What changed</p><h2 id="result-verdict-title">{verdict}</h2>
          <div className="pl-result-metrics" aria-label="Run details">
            {provider && <span>{provider}</span>}{model && <span>{model}</span>}
            {Number.isFinite(latencyMs) && <span>{metricLabel(latencyMs)} ms</span>}
            {usage && <span>{metricLabel(usage.input)} input · {metricLabel(usage.output)} output · {metricLabel(usage.total)} total tokens</span>}
            <span>{metrics.words.toLocaleString()} words · {metrics.chars.toLocaleString()} chars</span>
            <span title="Keyword-based structure checks, not an assessment of effectiveness">Structure checks {metrics.score}/5</span>
            {normalized.requestedOutputTokens && <span>{normalized.requestedOutputTokens.toLocaleString()} tokens requested; provider limits apply</span>}
          </div>
          {normalized.tags.length > 0 && <ul className="pl-result-tags" aria-label="Suggested tags">{normalized.tags.map(tag => <li key={tag}>{tag}</li>)}</ul>}
        </div>
        <div className="pl-result-header-actions" role="toolbar" aria-label="Result actions">
          {splitWorkspace ? (
            assumptions.length > 0 && (
              <button
                type="button"
                data-testid="review-assumptions"
                onClick={() => {
                  const heading = assumptionsHeadingRef.current;
                  heading?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
                  heading?.focus?.({ preventScroll: true });
                }}
                className="pl-secondary-button"
              >
                <Ic n="Eye" size={13} /> Review assumptions · {assumptions.length}
              </button>
            )
          ) : (
            <>
              <button type="button" onClick={() => copy(selected.content)} className="pl-secondary-button"><Ic n="Copy" size={13} /> Copy selected</button>
              <button type="button" onClick={enhance} className="pl-secondary-button"><Ic n="RefreshCw" size={13} /> Re-run</button>
            </>
          )}
          {normalized.schemaVersion === 2 && normalized.candidates.length === 1 && ['expanded', 'refined', 'rebuilt'].includes(primaryId) && (
            <button type="button" className="pl-secondary-button" onClick={() => enhance(undefined, { options: { alternatives: true } })}>Re-run with alternatives</button>
          )}
          <button type="button" onClick={dismiss} className="pl-icon-button" aria-label="Discard results and keep them available to restore"><Ic n="X" size={15} /></button>
        </div>
      </header>
      {normalized.metadataIncomplete && <p role="status" className="p-3 text-sm">The prompt completed, but supporting metadata was cut off. Review the full diff; assumptions and change notes may be missing.</p>}
      <div className={`pl-results-body ${compact ? 'is-compact' : ''}`}>
        <aside className="pl-candidate-rail" aria-label="Result candidates">
          <p className="pl-eyebrow">Candidates</p>
          <div role="listbox" aria-label="Enhancement candidates" onKeyDown={handleCandidateKeyDown}>
            {normalized.candidates.map((candidate, index) => {
              const candidateStats = candidateMetrics(candidate.content);
              const active = candidate.id === selected.id;
              return (
                <button key={candidate.id} type="button" role="option" data-candidate-id={candidate.id} aria-selected={active} tabIndex={active ? 0 : -1} onClick={() => selectCandidate(candidate)} className="pl-candidate-card">
                  <span className="pl-candidate-number">{String(index + 1).padStart(2, '0')}</span>
                  <span className="min-w-0"><strong>{candidate.label}</strong><small>{candidateStats.words} words · {candidateStats.chars} chars</small></span>
                  {active && <Ic n="Check" size={13} />}
                </button>
              );
            })}
          </div>
          <div className="pl-candidate-actions" role="toolbar" aria-label={`${selected.label} actions`}>
            <button type="button" onClick={() => selectCandidate(selected, { view: 'improved', preview: true })}>Preview</button>
            <button type="button" onClick={() => selectCandidate(selected, { view: 'changes', preview: false })}>Diff</button>
            {!splitWorkspace && <button type="button" onClick={() => copy(selected.content, `${selected.label} copied`)}>Copy</button>}
            {!splitWorkspace && <button type="button" disabled={!canSavePanel || saving} onClick={() => saveSelected()}>{explicitSaveLabels ? (currentEntry ? SAVE_LABELS.newVersion : SAVE_LABELS.newPrompt) : 'Save'}</button>}
            {editingId && <button type="button" onClick={() => pinCandidate(selected)}>Pin</button>}
          </div>
        </aside>
        <div className="pl-result-workspace">
          <button type="button" className="pl-original-toggle" aria-expanded={showOriginal} aria-controls="enhancement-original" onClick={() => setShowOriginal(value => !value)}>
            <span><Ic n="FileText" size={13} /> Original prompt</span><Ic n={showOriginal ? 'ChevronUp' : 'ChevronDown'} size={13} />
          </button>
          {showOriginal && <pre id="enhancement-original" className="pl-original-content">{raw}</pre>}
          <div className="pl-result-toolbar">
            <div className="pl-segmented" role="tablist" aria-label="Result views" onKeyDown={event => handleTabArrowKeys(event, view, setView)}>
              {[['changes', 'Changes'], ['improved', 'Prompt'], ['compare', 'Side-by-side']].map(([id, label]) => (
                <button key={id} type="button" id={`result-tab-${id}`} role="tab" data-tab-id={id} aria-selected={view === id} aria-controls={`result-panel-${id}`} tabIndex={view === id ? 0 : -1} onClick={() => setView(id)}>{label}</button>
              ))}
            </div>
            {view === 'improved' && <button type="button" className="pl-text-button" aria-pressed={preview} onClick={() => setPreview(value => !value)}><Ic n="Eye" size={12} /> {preview ? 'Edit' : 'Preview'}</button>}
          </div>
          {view === 'changes' && (
            <div id="result-panel-changes" role="tabpanel" aria-labelledby="result-tab-changes" className="pl-change-view">
              {changes.length > 0 ? <div className="pl-change-list">{changes.map(change => (
                <div key={change.id} className={`pl-change-row ${CHANGE_STYLES[change.type] || CHANGE_STYLES.changed}`}><span>{change.type}</span><p>{change.label}</p></div>
              ))}</div> : <div className="pl-empty-copy">No structured change list was returned for this candidate. The complete text comparison is below.</div>}
              <div className="pl-diff-copy" aria-label={`Text-level changes for ${selected.label}`}>
                {wordDiff(raw, selected.content).map((part, index) => part.t === 'add'
                  ? <ins key={index} className={m.diffAdd}>{part.v}</ins>
                  : part.t === 'del' ? <del key={index} className={m.diffDel}>{part.v}</del> : <span key={index} className={m.diffEq}>{part.v}</span>)}
              </div>
            </div>
          )}
          {view === 'improved' && (
            <div id="result-panel-improved" role="tabpanel" aria-labelledby="result-tab-improved">
              {preview ? <div className="pl-result-editor pl-markdown-result"><MarkdownPreview text={selected.content} /></div>
                : <textarea data-testid="output-textarea" aria-label={`${selected.label} candidate`} className="pl-result-editor" value={selected.content} onChange={event => updateCandidate(event.target.value)} />}
            </div>
          )}
          {view === 'compare' && <div id="result-panel-compare" role="tabpanel" aria-labelledby="result-tab-compare" className="pl-side-by-side"><div><p className="pl-eyebrow">Original</p><pre>{raw}</pre></div><div><p className="pl-eyebrow">{selected.label}</p><pre>{selected.content}</pre></div></div>}
          {assumptions.length > 0 && (
            <section className="pl-result-section">
              <div className="pl-section-heading"><div><p className="pl-eyebrow">Assumptions</p><h3 ref={assumptionsHeadingRef} tabIndex={-1}>Review what the model inferred</h3></div><span>{assumptions.length}</span></div>
              <div className="pl-assumption-list">{assumptions.map(assumption => {
                const hasStructuredEdit = reversibleEdits.some(edit => edit.after === assumption.addedText);
                const canRevert = !hasStructuredEdit && Boolean(assumption.addedText && selected.content.includes(assumption.addedText));
                return <div key={assumption.id} className="pl-assumption-row"><p>{assumption.text}</p>{assumption.addedText && <button type="button" disabled={!canRevert} onClick={() => revertAssumption(assumption)}>{hasStructuredEdit ? 'Managed below' : 'Revert'}</button>}</div>;
              })}</div>
            </section>
          )}
          {reversibleEdits.length > 0 && (
            <section className="pl-result-section">
              <div className="pl-section-heading"><div><p className="pl-eyebrow">Reversible edits</p><h3>Accept or undo model-added decisions</h3></div><span>{reversibleEdits.length}</span></div>
              <div className="pl-reversible-list">{reversibleEdits.map(edit => (
                <div key={edit.id} className="pl-reversible-row"><div><strong>{edit.label}</strong><small>{edit.operation}{edit.reverted ? ' · reverted' : ' · applied'}</small></div><button type="button" onClick={() => toggleStructuredEdit(edit)}><Ic n="RotateCcw" size={12} /> {edit.reverted ? 'Reapply' : 'Revert'}</button></div>
              ))}</div>
            </section>
          )}
          {isPrimary && (normalized.reasoning || normalized.changeSummary) && <details className="pl-reasoning"><summary>Why these changes?</summary><p>{normalized.reasoning || normalized.changeSummary}</p></details>}
          {evalRuns?.length > 0 && (
            <details className="pl-result-history"><summary>Prompt history ({evalRuns.length})</summary><ol>{evalRuns.slice(0, 5).map(run => (
              <li key={run.id}><span>{new Date(run.createdAt || run.timestamp || Date.now()).toLocaleString()}</span><strong>{run.selectedCandidateId || run.mode || run.status || 'enhance'}</strong><small>{run.provider || 'provider'}{run.model ? ` · ${run.model}` : ''}</small></li>
            ))}</ol></details>
          )}
        </div>
      </div>

    </section>
  );
}
