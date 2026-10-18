// What the Create editor is working on, for the context bar below.
export function describeEditingContext({ currentEntry, raw, enhanced, suggestedSaveTitle }) {
  const draft = raw ?? '';
  const result = enhanced ?? '';
  const hasContent = Boolean(draft.trim() || result.trim());
  if (currentEntry) {
    const unsaved = draft !== (currentEntry.original ?? '') || result !== (currentEntry.enhanced ?? '');
    return {
      mode: 'editing',
      heading: 'Editing saved prompt:',
      title: currentEntry.title || 'Untitled prompt',
      folder: currentEntry.collection || '',
      unsaved,
      saveState: unsaved ? 'Unsaved changes' : 'No unsaved changes',
      saveBehavior: 'Save adds a new version',
      canStartNew: true,
    };
  }
  return {
    mode: 'new',
    heading: 'New unsaved prompt',
    title: hasContent ? (suggestedSaveTitle || 'Untitled prompt') : '',
    folder: '',
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
 * it belongs to, whether anything is unsaved, and what Save will do. "Start new
 * prompt" uses the existing draft reset, which moves current work to session
 * recovery before clearing.
 */
export default function CreateContextBar({
  m, currentEntry, raw, enhanced, suggestedSaveTitle, canSavePanel,
  openSavePanel, openSection, onStartNew, accentTextClass, accentHoverTextClass, accentBadgeClass,
}) {
  const context = describeEditingContext({ currentEntry, raw, enhanced, suggestedSaveTitle });
  const linkClass = `min-h-8 [@media(pointer:coarse)]:min-h-11 items-center px-2 text-[11px] font-semibold transition-colors ${accentHoverTextClass}`;
  return (
    <section
      aria-label="Editing context"
      data-editing-mode={context.mode}
      className={`flex items-center gap-x-3 gap-y-1 flex-wrap ${m.surface} border ${m.border} rounded-lg px-3 py-1`}
    >
      <p className="flex items-center gap-2 min-w-0 flex-1 text-xs">
        <span className={`text-[10px] uppercase tracking-widest font-bold shrink-0 ${accentTextClass}`}>{context.heading}</span>
        {context.title && <span className={`font-semibold ${m.text} truncate min-w-0`} title={context.title}>{context.title}</span>}
        {context.folder && (
          <span className={`inline-flex shrink-0 items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${m.codeBlock} ${m.textSub}`}>
            Folder: {context.folder}
          </span>
        )}
      </p>
      <p className="flex items-center gap-2 text-[11px] flex-wrap">
        <span aria-live="polite" className={context.unsaved ? `rounded px-1.5 py-0.5 font-semibold ${accentBadgeClass}` : m.textMuted}>
          {context.saveState}
        </span>
        {/* Phones rely on the Save buttons' own labels to keep this bar short. */}
        <span className={`hidden sm:inline ${m.textSub}`}>{context.saveBehavior}</span>
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
        {context.canStartNew && typeof onStartNew === 'function' && (
          <button type="button" onClick={onStartNew} className={`${linkClass} inline-flex ${m.textAlt}`}>
            Start new prompt
          </button>
        )}
      </div>
    </section>
  );
}
