import { Fragment, memo, useEffect, useState } from 'react';
import Ic from './icons';
import { extractVars, looksSensitive } from './promptUtils';
import TagChip from './TagChip';
import TestCasesPanel from './TestCasesPanel';
import MarkdownPreview from './MarkdownPreview';
import DraftBadge from './DraftBadge.jsx';
import PresetImportPanel from './PresetImportPanel.jsx';
import {
  DEFAULT_LIBRARY_TWEAKS,
  resolveLibraryTweaks,
} from './lib/libraryTweaks.js';

function StarterPackCard({ pack, m, accent, onLoad }) {
  const [loading, setLoading] = useState(false);
  const handleClick = async () => {
    if (pack.loaded || loading) return;
    setLoading(true);
    try { onLoad(pack.id); } finally { setLoading(false); }
  };
  return (
    <div className={`${m.surface} border ${m.border} rounded-lg p-3 flex items-start gap-3`}>
      <span className="text-lg shrink-0">{pack.icon}</span>
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-semibold ${m.text}`}>{pack.name}</p>
        <p className={`text-xs ${m.textMuted} mt-0.5 leading-relaxed`}>{pack.description}</p>
        <span className={`text-xs ${m.textSub} mt-1 inline-block`}>{pack.promptCount} prompts</span>
      </div>
      <button type="button" onClick={handleClick} disabled={pack.loaded || loading}
        className={`ui-control shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
          pack.loaded
            ? `${m.btn} text-green-500 cursor-default`
            : loading
              ? `${m.btn} ${m.textMuted} cursor-wait`
              : `${accent.solid} ${accent.solidText}`
        }`}>
        {pack.loaded ? 'Loaded ✓' : loading ? 'Loading…' : 'Load'}
      </button>
    </div>
  );
}

const FALLBACK_TW = resolveLibraryTweaks(DEFAULT_LIBRARY_TWEAKS);

/**
 * Library sidebar panel — extracted from App.jsx to prevent re-renders
 * when typing in the editor input field.
 *
 * Memoized: only re-renders when lib state, editor layout, theme, or tweaks change.
 *
 * Visual presets: density × accent × signature flow in via the optional `tw` prop
 * (resolved from useLibraryTweaks). When omitted, falls back to v2 defaults
 * (gallery / ink / ticket). Compact-shell side-panel forces density=default
 * because the gallery grid does not fit in the 420px width.
 */
const LibraryPanel = memo(function LibraryPanel({
  m, lib, compact, isWeb, showEditorPane,
  effectiveEditorLayout, setEditorLayout,
  editingId, setSaveTitle,
  testCasesByPrompt, evalRuns, editingCaseId,
  caseFormPromptId,
  caseTitle, setCaseTitle, caseInput, setCaseInput,
  caseTraits, setCaseTraits, caseExclusions, setCaseExclusions,
  caseNotes, setCaseNotes,
  openCaseForm, resetCaseForm, saveCaseForPrompt,
  loadCaseIntoEditor, runSingleCase, removeCase,
  loadEntry, addToComposer, openSavePanel, sendToABTest, copy,
  canUseCollections = true,
  canExportLibrary = true,
  openBilling,
  tw,
}) {
  let resolvedTw = tw || FALLBACK_TW;
  if (compact && resolvedTw.density.grid) {
    resolvedTw = resolveLibraryTweaks({ ...resolvedTw.raw, density: 'default' });
  }
  const d = resolvedTw.density;
  const a = resolvedTw.accent;
  const s = resolvedTw.signature;

  const [searchDraft, setSearchDraft] = useState(lib.search);
  const [showImportPanel, setShowImportPanel] = useState(false);
  const unloadedStarterPacks = (lib.starterLibraries || []).filter((pack) => !pack.loaded);
  const primaryStarterPack = unloadedStarterPacks[0] || null;
  const hasLibraryFilters = Boolean(lib.search || lib.activeTag || lib.activeCollection);
  const usePaneScroll = !isWeb || (showEditorPane && !compact);

  useEffect(() => {
    setSearchDraft(lib.search);
  }, [lib.search]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      if (searchDraft !== lib.search) {
        lib.setSearch(searchDraft);
      }
    }, 250);
    return () => window.clearTimeout(timeoutId);
  }, [lib.search, lib.setSearch, searchDraft]);

  const clearLibraryFilters = () => {
    setSearchDraft('');
    lib.setSearch('');
    lib.setActiveTag(null);
    lib.setActiveCollection(null);
  };

  const metaCase = s.uppercaseMeta ? 'uppercase tracking-wider' : '';
  const metaClass = `${d.metaSize} ${m.textMuted} ${s.metaFont} ${s.metaTracking} ${metaCase}`;

  const listLayoutClass = d.grid
    ? `${usePaneScroll ? 'flex-1 min-h-0 overflow-y-auto' : ''} ${d.listPad} grid grid-cols-2 ${d.listGap} content-start`
    : `${usePaneScroll ? 'flex-1 min-h-0 overflow-y-auto' : ''} ${d.listPad} flex flex-col ${d.listGap}`;

  return (
    <div className={`${showEditorPane && !compact ? 'w-1/2' : 'w-full'} flex min-h-0 flex-col ${usePaneScroll ? 'overflow-hidden' : ''}`}>
      <div className={`${d.toolbarPad} border-b ${m.border} flex flex-col ${d.toolbarGap} shrink-0`}>
        <div className={`flex gap-2 ${compact ? 'flex-col' : ''}`}>
          <div className="relative flex-1">
            <Ic n="Search" size={11} className={`absolute left-2.5 top-1/2 -translate-y-1/2 ${m.textMuted}`} />
            <input className={`w-full ${m.input} border rounded-lg pl-7 pr-3 py-1.5 text-xs focus:outline-none ${a.focusBorder} ${m.text}`}
              placeholder="Search…" value={searchDraft} onChange={e => setSearchDraft(e.target.value)} />
          </div>
          <div className={`flex gap-2 ${compact ? 'w-full' : ''}`}>
            <select value={lib.sortBy} onChange={e => lib.setSortBy(e.target.value)}
              className={`ui-control ${m.input} border rounded-lg px-2 py-1.5 text-xs ${m.textBody} focus:outline-none ${compact ? 'flex-1' : ''}`}>
              <option value="newest">Newest</option><option value="oldest">Oldest</option><option value="a-z">A → Z</option><option value="z-a">Z → A</option><option value="group">By collection</option><option value="most-used">Most Used</option><option value="manual">Manual</option>
            </select>
            <button
              type="button"
              onClick={canExportLibrary ? lib.exportLib : () => openBilling?.('export')}
              className={`ui-control px-2.5 rounded-lg text-xs transition-colors ${compact ? 'flex-1 py-1.5' : ''} ${canExportLibrary ? `${m.btn} ${m.textAlt}` : `border ${a.subtle}`}`}
            >
              {canExportLibrary ? 'Export' : 'Export Pro'}
            </button>
            {isWeb && typeof lib.recoverLegacyWebLibrary === 'function' && (
              <button
                type="button"
                onClick={() => lib.recoverLegacyWebLibrary({ force: true })}
                disabled={lib.recoveringLegacyLibrary}
                className={`ui-control px-2.5 rounded-lg text-xs transition-colors ${lib.recoveringLegacyLibrary ? `${m.btn} ${m.textMuted} cursor-wait` : `${m.btn} ${m.textAlt}`} ${compact ? 'flex-1 py-1.5' : ''}`}
              >
                {lib.recoveringLegacyLibrary ? 'Checking...' : 'Recover'}
              </button>
            )}
            <button type="button" onClick={() => setShowImportPanel(p => !p)} aria-label="Import preset pack" className={`ui-control px-2.5 rounded-lg text-xs transition-colors ${showImportPanel ? a.active : `${m.btn} ${m.textAlt}`} ${compact ? 'flex-1 py-1.5' : ''}`}>
              <span className="flex items-center gap-1"><Ic n="Upload" size={11} />Import Pack</span>
            </button>
          </div>
        </div>
        {d.showToolbarHint && lib.sortBy === 'manual' && (
          <p className={`text-[11px] ${m.textMuted}`}>
            Manual order is live. Drag cards or use the arrow controls to move them.
          </p>
        )}
        {canUseCollections && lib.collections.length > 0 && (
          <div className="flex gap-1 flex-wrap">
            <button type="button" onClick={() => lib.setActiveCollection(null)} className={`ui-control px-2 py-0.5 rounded-full text-xs font-medium transition-colors ${!lib.activeCollection ? a.active : `${m.btn} ${m.textAlt}`}`}>All</button>
            {lib.collections.map(c => (
              <button key={c} type="button" onClick={() => lib.setActiveCollection(p => p === c ? null : c)}
                className={`ui-control px-2 py-0.5 rounded-full text-xs font-medium transition-colors flex items-center gap-1 ${lib.activeCollection === c ? a.active : `${m.btn} ${m.textAlt}`}`}>
                <Ic n="FolderOpen" size={9} />{c}
              </button>
            ))}
          </div>
        )}
        {!canUseCollections && lib.collections.length > 0 && (
          <div className={`rounded-lg border px-3 py-2 text-xs leading-relaxed ${m.codeBlock} ${m.border} ${m.textMuted}`}>
            Collection filters are available on Prompt Lab Pro.
            <button type="button" onClick={() => openBilling?.('collections')} className={`ml-2 ${a.text} hover:${a.textSoft} transition-colors`}>
              Unlock
            </button>
          </div>
        )}
        {d.showTagFilters && lib.allLibTags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {lib.allLibTags.map(t => <TagChip key={t} tag={t} selected={lib.activeTag === t} onClick={() => lib.setActiveTag(p => p === t ? null : t)} />)}
          </div>
        )}
      </div>
      {showImportPanel && (
        <PresetImportPanel
          m={m}
          lib={lib}
          compact={compact}
          onClose={() => setShowImportPanel(false)}
        />
      )}
      <div
        data-testid="library-scroll-region"
        className={listLayoutClass}
      >
        {lib.filtered.length === 0 && !showImportPanel && (
          <div className={`ui-empty-state h-full ${m.codeBlock} border ${m.border} ${d.grid ? 'col-span-2' : ''}`}>
            <Ic n="Wand2" size={24} className={m.textMuted} />
            <p className={`text-sm font-semibold ${m.textSub}`}>
              {lib.library.length === 0 ? 'No saved prompts yet.' : 'No results found.'}
            </p>
            <p className={`mt-1 max-w-sm text-xs leading-relaxed ${m.textMuted}`}>
              {lib.library.length === 0
                ? 'Load a starter library, import a pack, or save your current draft to seed the workspace.'
                : 'Your current search, tag, or collection filters are hiding every saved prompt.'}
            </p>
            <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
              {lib.library.length === 0 && primaryStarterPack && (
                <button
                  type="button"
                  onClick={() => lib.loadStarterPack(primaryStarterPack.id)}
                  className={`ui-control rounded-lg ${a.solid} px-3 py-1.5 text-xs font-semibold ${a.solidText} transition-colors`}
                >
                  Load {primaryStarterPack.name}
                </button>
              )}
              {lib.library.length > 0 && hasLibraryFilters && (
                <button
                  type="button"
                  onClick={clearLibraryFilters}
                  className={`ui-control rounded-lg ${a.solid} px-3 py-1.5 text-xs font-semibold ${a.solidText} transition-colors`}
                >
                  Clear Filters
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowImportPanel(true)}
                className={`ui-control rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${m.btn} ${m.textAlt}`}
              >
                Import Pack
              </button>
            </div>
          </div>
        )}
        {lib.filtered.map((entry, index) => {
          const manual = lib.sortBy === 'manual';
          const shareUrl = lib.shareId === entry.id ? lib.getShareUrl(entry) : null;
          const collectionLabel = entry.collection || 'Unassigned';
          const previousCollectionLabel = index > 0 ? (lib.filtered[index - 1].collection || 'Unassigned') : null;
          // Collection headers are stack-only — suppress in grid mode where they
          // would break the 2-up flow.
          const showCollectionHeader = lib.sortBy === 'group'
            && !d.grid
            && collectionLabel !== previousCollectionLabel;
          const vars = extractVars(entry.enhanced);
          const isExpanded = lib.expandedId === entry.id;
          const previewText = entry.enhanced?.trim() || entry.original?.trim() || '';
          const showPreview = d.showInlinePreview && previewText && !isExpanded;
          const previewLines = d.previewLines || 2;

          const rowFrameBase = s.rowFrame(m, a);
          const editingActive = editingId === entry.id ? `border-violet-500 ring-1 ring-violet-500/30` : '';
          const dragOver = lib.dragOverLibraryId === entry.id ? 'border-violet-500' : '';
          const draggingOpacity = lib.draggingLibraryId === entry.id ? 'opacity-50' : '';
          const dragCursor = manual && !d.grid ? 'cursor-grab active:cursor-grabbing' : '';

          return (
            <Fragment key={entry.id}>
              {showCollectionHeader && (
                <div className={`flex items-center gap-2 ${index === 0 ? '' : 'pt-2'}`}>
                  <span className={`text-[11px] font-semibold uppercase tracking-wider ${m.textSub}`}>
                    {collectionLabel}
                  </span>
                  <div className={`flex-1 border-t ${m.border}`} />
                </div>
              )}
            <div
              draggable={manual && !d.grid}
              onDragStart={e => { if (!manual || d.grid) return; e.dataTransfer.setData('libraryEntryId', entry.id); lib.setDraggingLibraryId(entry.id); }}
              onDragEnd={() => { lib.setDraggingLibraryId(null); lib.setDragOverLibraryId(null); }}
              onDragOver={e => { if (!manual || d.grid) return; e.preventDefault(); lib.setDragOverLibraryId(entry.id); }}
              onDrop={e => {
                if (!manual || d.grid) return;
                e.preventDefault();
                const sourceId = e.dataTransfer.getData('libraryEntryId');
                const rect = e.currentTarget.getBoundingClientRect();
                const position = e.clientY > rect.top + rect.height / 2 ? 'after' : 'before';
                lib.moveLibraryEntry(sourceId, entry.id, position);
                lib.setDragOverLibraryId(null);
              }}
              className={`${rowFrameBase} ${editingActive} ${dragOver} ${draggingOpacity} ${dragCursor} transition-colors`}>
              <div className={`flex items-start justify-between ${d.rowPad} gap-2`}>
                <div className="flex-1 min-w-0">
                  {lib.renamingId === entry.id ? (
                    <div className="flex gap-1.5">
                      <input autoFocus value={lib.renameValue} onChange={e => lib.setRenameValue(e.target.value)}
                        className={`flex-1 ${m.input} border rounded-lg px-2 py-1 text-xs focus:outline-none ${a.focusBorder} ${m.text}`} />
                      <button type="button" onClick={() => lib.renameEntry(entry.id, lib.renameValue, editingId, setSaveTitle)} className={`ui-control px-2 py-1 text-xs ${a.solid} ${a.solidText} rounded-lg transition-colors`}>Save</button>
                      <button type="button" onClick={() => { lib.setRenamingId(null); lib.setRenameValue(''); }} className={`ui-control px-2 py-1 text-xs ${m.btn} ${m.textAlt} rounded-lg transition-colors`}>Cancel</button>
                    </div>
                  ) : (
                    <p className={`${d.titleSize} ${s.titleWeight} ${s.titleFont} ${m.text} truncate flex items-center gap-1.5`}>
                      {entry.title}
                      {(entry.metadata?.status === 'draft' || (!entry.enhanced?.trim() && !entry.original?.trim())) && <DraftBadge tone="warning">draft</DraftBadge>}
                    </p>
                  )}
                  <div className={`flex items-center gap-2 ${metaClass} mt-0.5 flex-wrap`}>
                    {d.metaVisible.collection && entry.collection && (
                      <span className="flex items-center gap-1"><Ic n="FolderOpen" size={8} />{entry.collection}</span>
                    )}
                    {d.metaVisible.date && <span>{new Date(entry.createdAt).toLocaleDateString()}</span>}
                    {d.metaVisible.useCount && entry.useCount > 0 && <span className={a.text}>{entry.useCount}×</span>}
                    {d.metaVisible.versions && (entry.versions || []).length > 0 && (
                      <span className="flex items-center gap-0.5 text-blue-400"><Ic n="Clock" size={8} />{entry.versions.length}v</span>
                    )}
                    {d.metaVisible.vars && vars.length > 0 && <span className="text-amber-400">{'{{vars}}'}</span>}
                  </div>
                  {showPreview && (
                    <p className={`${d.metaSize} ${m.textAlt} mt-1.5 leading-relaxed`}
                       style={{ display: '-webkit-box', WebkitLineClamp: previewLines, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      {previewText}
                    </p>
                  )}
                </div>
                <div className={`flex items-center gap-1 shrink-0 ${d.grid ? 'flex-col' : ''}`}>
                  {manual && !d.grid && (
                    <>
                      <Ic n="GripVertical" size={12} className={m.textMuted} />
                      <button
                        type="button"
                        aria-label={`Move ${entry.title} up`}
                        disabled={index === 0}
                        onClick={() => lib.moveLibraryEntryByOffset(entry.id, -1, lib.filtered)}
                        className={`ui-control px-1.5 py-1 rounded ${m.btn} ${m.textAlt} text-xs transition-colors disabled:opacity-40`}
                      >
                        <Ic n="ChevronUp" size={11} />
                      </button>
                      <button
                        type="button"
                        aria-label={`Move ${entry.title} down`}
                        disabled={index === lib.filtered.length - 1}
                        onClick={() => lib.moveLibraryEntryByOffset(entry.id, 1, lib.filtered)}
                        className={`ui-control px-1.5 py-1 rounded ${m.btn} ${m.textAlt} text-xs transition-colors disabled:opacity-40`}
                      >
                        <Ic n="ChevronDown" size={11} />
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => { loadEntry(entry); }}
                    className={`ui-control rounded ${m.btn} ${a.text} ${d.actionSize} font-semibold transition-colors`}
                  >
                    Use
                  </button>
                  <button
                    type="button"
                    onClick={() => { copy(entry.enhanced); lib.bumpUse(entry.id); }}
                    className={`ui-control rounded ${m.btn} ${m.textAlt} ${d.actionSize} font-semibold hover:${a.text} transition-colors`}
                  >
                    Copy
                  </button>
                  <button
                    type="button"
                    onClick={() => lib.setExpandedId(p => p === entry.id ? null : entry.id)}
                    className={`ui-control rounded ${m.btn} ${m.textAlt} ${d.actionSize} font-semibold transition-colors flex items-center gap-1`}
                  >
                    More
                    <Ic n={isExpanded ? 'ChevronUp' : 'ChevronDown'} size={11} />
                  </button>
                </div>
              </div>
              {(entry.tags || []).length > 0 && (
                <div className={`flex flex-wrap gap-1 px-3 pb-2 ${d.grid ? 'pt-0' : ''}`}>
                  {entry.tags.slice(0, d.grid ? 3 : entry.tags.length).map(t => <TagChip key={t} tag={t} />)}
                  {d.grid && entry.tags.length > 3 && (
                    <span className={`text-[10px] ${m.textMuted} self-center`}>+{entry.tags.length - 3}</span>
                  )}
                </div>
              )}
              {lib.shareId === entry.id && (
                <div className={`${s.divider(m)} px-3 py-2 flex gap-2`}>
                  <input readOnly className={`flex-1 ${m.input} border rounded-lg px-2 py-1 text-xs focus:outline-none ${m.text} font-mono`} value={shareUrl || 'Unable to create share URL'} />
                  <button type="button" onClick={() => copy(shareUrl || '')} className={`ui-control px-2 py-1 ${a.solid} ${a.solidText} rounded-lg text-xs font-medium transition-colors`}>Copy URL</button>
                </div>
              )}
              {isExpanded && (
                <div className={`${s.divider(m)} px-3 py-3 flex flex-col gap-3`}>
                  <div className={`flex flex-wrap gap-2`}>
                    <button type="button" onClick={() => openSavePanel(entry)} className={`ui-control px-2 py-1 rounded ${m.btn} ${m.textAlt} text-xs transition-colors`}>Edit details</button>
                    <button type="button" onClick={() => addToComposer(entry)} className={`ui-control px-2 py-1 rounded ${m.btn} ${m.textAlt} text-xs transition-colors flex items-center gap-1`}><Ic n="Layers" size={11} />Build Sequence</button>
                    <button type="button" onClick={() => sendToABTest(entry, 'a')} className={`ui-control px-2 py-1 rounded ${m.btn} ${m.textAlt} text-xs transition-colors flex items-center gap-1`}><Ic n="FlaskConical" size={11} />A/B A</button>
                    <button type="button" onClick={() => sendToABTest(entry, 'b')} className={`ui-control px-2 py-1 rounded ${m.btn} ${m.textAlt} text-xs transition-colors flex items-center gap-1`}><Ic n="FlaskConical" size={11} />A/B B</button>
                    <button type="button" onClick={() => {
                      if ((looksSensitive(entry.original) || looksSensitive(entry.enhanced) || looksSensitive(entry.notes))
                        && !window.confirm('This shared link may include sensitive content. Continue?')) return;
                      lib.setShareId(p => p === entry.id ? null : entry.id);
                    }} className={`ui-control px-2 py-1 rounded ${m.btn} ${m.textAlt} text-xs transition-colors flex items-center gap-1`}><Ic n="Share2" size={11} />Share link</button>
                    <button type="button" onClick={() => { lib.setRenamingId(entry.id); lib.setRenameValue(entry.title); }} className={`ui-control px-2 py-1 rounded ${m.btn} ${m.textAlt} text-xs transition-colors`}>Rename</button>
                  </div>
                  <TestCasesPanel
                    m={m} entry={entry} cases={testCasesByPrompt[entry.id] || []}
                    evalRuns={evalRuns} editingCaseId={editingCaseId}
                    caseFormPromptId={caseFormPromptId}
                    caseTitle={caseTitle} setCaseTitle={setCaseTitle}
                    caseInput={caseInput} setCaseInput={setCaseInput}
                    caseTraits={caseTraits} setCaseTraits={setCaseTraits}
                    caseExclusions={caseExclusions} setCaseExclusions={setCaseExclusions}
                    caseNotes={caseNotes} setCaseNotes={setCaseNotes}
                    openCaseForm={openCaseForm} resetCaseForm={resetCaseForm}
                    saveCaseForPrompt={saveCaseForPrompt}
                    loadCaseIntoEditor={loadCaseIntoEditor}
                    runSingleCase={runSingleCase} removeCase={removeCase}
                  />
                  {[['Original', m.textSub, entry.original], ['Enhanced', a.text, entry.enhanced]].map(([lbl, col, txt]) => (
                    <div key={lbl}>
                      <p className={`text-xs ${col} font-semibold mb-1 uppercase tracking-wider`}>{lbl}</p>
                      <div className={`text-xs ${m.textBody} leading-relaxed ${m.codeBlock} rounded-lg p-2`}>
                        <MarkdownPreview text={txt || ''} className="text-xs" />
                      </div>
                    </div>
                  ))}
                  {entry.notes && <div><p className={`text-xs ${m.notesText} font-semibold mb-1 uppercase tracking-wider`}>Notes</p><p className={`text-xs ${m.textAlt} leading-relaxed`}>{entry.notes}</p></div>}
                  {(entry.variants || []).length > 0 && (
                    <div><p className={`text-xs ${m.textSub} font-semibold mb-1.5 uppercase tracking-wider`}>Variants</p>
                      {entry.variants.map((v, i) => <div key={i} className="mb-1.5"><span className={`text-xs ${a.text} font-bold`}>{v.label}: </span><span className={`text-xs ${m.textAlt}`}>{v.content}</span></div>)}
                    </div>
                  )}
                  {(entry.versions || []).length > 0 && (
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-xs text-blue-400 font-semibold uppercase tracking-wider flex items-center gap-1"><Ic n="Clock" size={9} />Version History ({entry.versions.length})</p>
                        <button
                          onClick={() => lib.openVersionHistory(entry.id, 0)}
                          className={`text-xs ${m.textSub} hover:text-white transition-colors flex items-center gap-1 rounded-lg px-1.5 py-0.5`}
                        >
                          <Ic n="GitBranch" size={9} />
                          Open History
                        </button>
                      </div>
                      <div className={`${m.codeBlock} border ${m.border} rounded-lg p-2.5 text-xs ${m.textAlt}`}>
                        <div className="flex items-center justify-between gap-3">
                          <span>Latest snapshot: {new Date(entry.versions[entry.versions.length - 1].savedAt).toLocaleString()}</span>
                          <span className={m.textMuted}>Restore and compare in modal</span>
                        </div>
                      </div>
                    </div>
                  )}
                  <div className={`pt-1 ${s.divider(m)}`}>
                    <button
                      type="button"
                      onClick={() => lib.del(entry.id)}
                      className="ui-control px-2.5 py-1.5 rounded bg-red-600 hover:bg-red-500 text-white text-xs font-semibold transition-colors flex items-center gap-1"
                    >
                      <Ic n="Trash2" size={11} />Delete Prompt
                    </button>
                  </div>
                </div>
              )}
            </div>
            </Fragment>
          );
        })}
        {lib.starterLibraries && lib.starterLibraries.some(p => !p.loaded) && (
          <div className={`mt-4 pt-4 border-t ${m.border} ${d.grid ? 'col-span-2' : ''}`}>
            <p className={`text-xs ${m.textSub} uppercase tracking-widest font-semibold mb-3`}>Starter Libraries</p>
            <div className="flex flex-col gap-2">
              {lib.starterLibraries.map(pack => (
                <StarterPackCard key={pack.id} pack={pack} m={m} accent={a} onLoad={lib.loadStarterPack} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

export default LibraryPanel;
