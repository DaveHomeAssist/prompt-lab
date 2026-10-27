import Ic from './icons.jsx';
import { arePromptSnapshotsEqual } from './lib/promptSchema.js';

const sameTags = (left, right) => {
  const a = [...(left || [])].map(String).sort();
  const b = [...(right || [])].map(String).sort();
  return a.length === b.length && a.every((tag, index) => tag === b[index]);
};

// What the Create editor is working on, for the context bar below. The pending
// Library details (saveTitle, saveCollection, saveTags) are what Save will write,
// so edits made in the details panel count as unsaved even after it closes.
export function describeEditingContext({
  currentEntry, raw, enhanced, suggestedSaveTitle, saveTitle, saveCollection, saveTags,
  resultMeta, variants, notes,
}) {
  const draft = raw ?? '';
  const result = enhanced ?? '';
  const hasContent = Boolean(draft.trim() || result.trim());
  const pendingTitle = typeof saveTitle === 'string' ? saveTitle.trim() : '';
  const pendingFolder = typeof saveCollection === 'string' ? saveCollection.trim() : undefined;
  if (currentEntry) {
    const contentChanged = !arePromptSnapshotsEqual(currentEntry, {
      original: draft,
      enhanced: result,
      resultMeta: resultMeta === undefined ? currentEntry.resultMeta : resultMeta,
      variants: variants === undefined ? currentEntry.variants : variants,
      notes: notes === undefined ? currentEntry.notes : notes,
    });
    const savedTitle = currentEntry.title || 'Untitled prompt';
    const savedFolder = currentEntry.collection || '';
    const detailsChanged = (pendingTitle && pendingTitle !== savedTitle)
      || (pendingFolder !== undefined && pendingFolder !== savedFolder)
      || (Array.isArray(saveTags) && !sameTags(saveTags, currentEntry.tags));
    const unsaved = contentChanged || detailsChanged;
    return {
      mode: 'editing',
      heading: 'Editing saved prompt:',
      title: pendingTitle || savedTitle,
      folder: pendingFolder !== undefined ? pendingFolder : savedFolder,
      unsaved,
      saveState: unsaved ? 'Unsaved changes' : 'No unsaved changes',
      saveBehavior: 'Save adds a new version',
      canStartNew: true,
    };
  }
  return {
    mode: 'new',
    heading: 'New unsaved prompt',
    title: hasContent ? (pendingTitle || suggestedSaveTitle || 'Untitled prompt') : '',
    folder: hasContent && pendingFolder ? pendingFolder : '',
    unsaved: hasContent,
    saveState: hasContent ? 'Not saved yet' : 'Empty draft',
    saveBehavior: 'Save creates a new prompt',
    canStartNew: hasContent,
  };
}

/**
 * Editing context bar — slice 2A (C7) of docs/ENHANCE_WORKSPACE_REDESIGN_BRIEF.md.
 *
 * Always says whether Create holds a new draft or a saved prompt, which folder
 * it belongs to, whether anything is unsaved, and what Save will do. New Prompt
 * lives in the shared header so this context
 * stays consistent in Write and Dual Pane without another reset control.
 */
// Opens the panel beside Write on one of its tabs (Scratch or Prompts).
function SidePanelToggle({ m, panel, label, icon, accentBadgeClass }) {
  return (
    <button
      ref={panel.buttonRef}
      type="button"
      aria-pressed={panel.open}
      onClick={panel.onToggle}
      title={`${panel.open ? 'Hide' : 'Show'} ${label} beside Write. Cmd or Ctrl + \\ toggles the panel.`}
      className={`pl-write-side-toggle ui-control inline-flex shrink-0 self-start items-center gap-1 rounded-md border px-2 min-h-8 [@media(pointer:coarse)]:min-h-11 text-[11px] font-semibold ${m.border} ${panel.open ? accentBadgeClass : m.textSub}`}
    >
      <Ic n={icon} size={12} /> {label}
    </button>
  );
}

export default function CreateContextBar({
  m, compact = false, currentEntry, raw, enhanced, suggestedSaveTitle, saveTitle, saveCollection, saveTags, canSavePanel,
  resultMeta, variants, notes,
  openSavePanel, openSection, accentTextClass, accentHoverTextClass, accentBadgeClass,
  scratchPanel = null,
  promptsPanel = null,
}) {
  const context = describeEditingContext({
    currentEntry, raw, enhanced, suggestedSaveTitle, saveTitle, saveCollection, saveTags,
    resultMeta, variants, notes,
  });
  const linkClass = `min-h-8 [@media(pointer:coarse)]:min-h-11 items-center px-2 text-[11px] font-semibold transition-colors ${accentHoverTextClass}`;
  return (
    <section
      aria-label="Editing context"
      data-editing-mode={context.mode}
      className={`flex items-center gap-x-3 gap-y-1 flex-wrap ${m.surface} border ${m.border} rounded-lg px-3 py-1`}
    >
      <details className="min-w-0 flex-1" open={!compact}>
      <summary className="pl-context-summary flex cursor-pointer items-center gap-2 min-w-0 text-xs">
        <span aria-hidden="true">▸</span>
        <span className={`text-[10px] uppercase tracking-widest font-bold shrink-0 ${accentTextClass}`}>{context.heading}</span>
        {context.title && <span className={`font-semibold ${m.text} truncate min-w-0`} title={context.title}>{context.title}</span>}
        {context.folder && (
          <span className={`inline-flex shrink-0 items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${m.codeBlock} ${m.textSub}`}>
            Folder: {context.folder}
          </span>
        )}
      </summary>
      <div className="flex items-center gap-x-3 gap-y-1 flex-wrap pt-1">
      <p className="flex items-center gap-2 text-[11px] flex-wrap">
        <span aria-live="polite" className={context.unsaved ? `rounded px-1.5 py-0.5 font-semibold ${accentBadgeClass}` : m.textMuted}>
          {context.saveState}
        </span>
        <span className={m.textSub}>{context.saveBehavior}</span>
      </p>
      <p className={`w-full text-[11px] ${m.textSub}`} data-testid="refinement-identity">
        {currentEntry
          ? 'Refine keeps this prompt. Save new version adds to its history; Save as new prompt creates a separate prompt and continues there.'
          : 'Refine keeps this draft. Save as new prompt creates its first Library version.'}
      </p>
      <div className="flex items-center gap-1 shrink-0">
        {currentEntry && (
          <button type="button" onClick={() => openSection('library')} className={`${linkClass} hidden sm:inline-flex ${m.textAlt}`}>
            View in Library
          </button>
        )}
        {canSavePanel && (currentEntry || context.unsaved) && (
          <button type="button" onClick={() => openSavePanel()} className={`${linkClass} hidden sm:inline-flex ${accentTextClass}`}>
            Library Details
          </button>
        )}
      </div>
      </div>
      </details>
      {scratchPanel && <SidePanelToggle m={m} panel={scratchPanel} label="Scratch" icon="PanelRight" accentBadgeClass={accentBadgeClass} />}
      {promptsPanel && <SidePanelToggle m={m} panel={promptsPanel} label="Prompts" icon="Star" accentBadgeClass={accentBadgeClass} />}
    </section>
  );
}
