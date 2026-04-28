import { Fragment, memo, useEffect, useState } from 'react';
import Ic from './icons';
import { extractVars, looksSensitive } from './promptUtils';
import TagChip from './TagChip';
import TestCasesPanel from './TestCasesPanel';
import MarkdownPreview from './MarkdownPreview';
import DraftBadge from './DraftBadge.jsx';
import PresetImportPanel from './PresetImportPanel.jsx';

function StarterPackCard({ pack, m, onLoad }) {
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
              : 'bg-orange-500/90 hover:bg-orange-400 text-white'
        }`}>
        {pack.loaded ? 'Loaded \u2713' : loading ? 'Loading\u2026' : 'Load'}
      </button>
    </div>
  );
}

/**
 * Library sidebar panel — extracted from App.jsx to prevent re-renders
 * when typing in the editor input field.
 *
 * Memoized: only re-renders when lib state, editor layout, or theme change.
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
}) {
  const [searchDraft, setSearchDraft] = useState(lib.search);
  const [showImportPanel, setShowImportPanel] = useState(false);
  const unloadedStarterPacks = (lib.starterLibraries || []).filter((pack) => !pack.loaded);
  const primaryStarterPack = unloadedStarterPacks[0] || null;
  const hasLibraryFilters = Boolean(lib.search || lib.activeTag || lib.activeCollection);
  const savedPromptCount = lib.library.length;
  const visiblePromptCount = lib.filtered.length;
  const readyPackCount = unloadedStarterPacks.length;
  const accentTextClass = 'text-orange-300';
  const accentFocusClass = 'focus:border-orange-400';
  const accentSolidButtonClass = 'bg-orange-500/90 hover:bg-orange-400 text-white';
  const accentSoftButtonClass = 'border border-orange-400/35 bg-orange-500/12 text-orange-100 hover:bg-orange-500/18';
  const accentPanelClass = 'border border-orange-400/20 bg-gradient-to-br from-orange-500/10 via-transparent to-amber-500/10';
  const accentToggleActiveClass = 'bg-orange-500/90 text-white';

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

  return (
    <div className={`${showEditorPane && !compact ? 'w-1/2' : 'w-full'} flex flex-col ${isWeb ? '' : 'overflow-hidden'}`}>
      <div className={`p-3 border-b ${m.border} flex flex-col gap-2 shrink-0`}>
        <div className={`flex gap-2 ${compact ? 'flex-col' : ''}`}>
          <div className="relative flex-1">
            <Ic n="Search" size={11} className={`absolute left-2.5 top-1/2 -translate-y-1/2 ${m.textMuted}`} />
            <input data-testid="library-search" className={`w-full ${m.input} border rounded-lg pl-7 pr-3 py-1.5 text-xs focus:outline-none ${accentFocusClass} ${m.text}`}
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
              className={`ui-control px-2.5 rounded-lg text-xs transition-colors ${compact ? 'flex-1 py-1.5' : ''} ${canExportLibrary ? `${m.btn} ${m.textAlt}` : accentSoftButtonClass}`}
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
            <button type="button" onClick={() => setShowImportPanel(p => !p)} aria-label="Import preset pack" className={`ui-control px-2.5 rounded-lg text-xs transition-colors ${showImportPanel ? accentToggleActiveClass : `${m.btn} ${m.textAlt}`} ${compact ? 'flex-1 py-1.5' : ''}`}>
              <span className="flex items-center gap-1"><Ic n="Upload" size={11} />Import Pack</span>
            </button>
          </div>
        </div>
        {lib.sortBy === 'manual' && (
          <p className={`text-[11px] ${m.textMuted}`}>
            Manual order is live. Drag cards or use the arrow controls to move them.
          </p>
        )}
        {canUseCollections && lib.collections.length > 0 && (
          <div className="flex gap-1 flex-wrap">
            <button type="button" onClick={() => lib.setActiveCollection(null)} className={`ui-control px-2 py-0.5 rounded-full text-xs font-medium transition-colors ${!lib.activeCollection ? accentToggleActiveClass : `${m.btn} ${m.textAlt}`}`}>All</button>
            {lib.collections.map(c => (
              <button key={c} type="button" onClick={() => lib.setActiveCollection(p => p === c ? null : c)}
                className={`ui-control px-2 py-0.5 rounded-full text-xs font-medium transition-colors flex items-center gap-1 ${lib.activeCollection === c ? accentToggleActiveClass : `${m.btn} ${m.textAlt}`}`}>
                <Ic n="FolderOpen" size={9} />{c}
              </button>
            ))}
          </div>
        )}
        {!canUseCollections && lib.collections.length > 0 && (
          <div className={`rounded-lg border px-3 py-2 text-xs leading-relaxed ${m.codeBlock} ${m.border} ${m.textMuted}`}>
            Collection filters are available on Prompt Lab Pro.
            <button type="button" onClick={() => openBilling?.('collections')} className="ml-2 text-orange-300 hover:text-orange-200 transition-colors">
              Unlock
            </button>
          </div>
        )}
        {lib.allLibTags.length > 0 && (
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
      <div className={`${isWeb ? '' : 'flex-1 overflow-y-auto'} p-3 flex flex-col gap-3`}>
        <section className={`${m.surface} ${accentPanelClass} rounded-xl p-4`}>
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <p className={`text-[11px] font-semibold uppercase tracking-[0.24em] ${accentTextClass}`}>Library deck</p>
              <h2 className={`mt-1 text-sm font-semibold ${m.text}`}>Saved prompts and starter packs.</h2>
              <p className={`mt-1 max-w-xl text-xs leading-relaxed ${m.textMuted}`}>
                Build a durable prompt shelf with reusable drafts, polished variants, and starter packs that are ready for the next workbench run.
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {primaryStarterPack && (
                <button
                  type="button"
                  onClick={() => lib.loadStarterPack(primaryStarterPack.id)}
                  className={`ui-control rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${accentSolidButtonClass}`}
                >
                  Load starter pack
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowImportPanel(true)}
                className={`ui-control rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${accentSoftButtonClass}`}
              >
                Import Pack
              </button>
            </div>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            {[
              [`${savedPromptCount} saved`, 'Prompt entries in your library'],
              [`${visiblePromptCount} visible`, hasLibraryFilters ? 'Current filters applied' : 'Visible in this view'],
              [`${readyPackCount} ready pack${readyPackCount === 1 ? '' : 's'}`, 'Starter packs still available to load'],
            ].map(([label, helper]) => (
              <div key={label} className={`${m.codeBlock} ${m.border} rounded-lg border px-3 py-2.5`}>
                <p className={`text-sm font-semibold ${m.text}`}>{label}</p>
                <p className={`mt-1 text-[11px] leading-relaxed ${m.textMuted}`}>{helper}</p>
              </div>
            ))}
          </div>
        </section>
        {lib.filtered.length === 0 && !showImportPanel && (
          <div className={`ui-empty-state h-full ${m.codeBlock} border ${m.border}`}>
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
                  className={`ui-control rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${accentSolidButtonClass}`}
                >
                  Load {primaryStarterPack.name}
                </button>
              )}
              {lib.library.length > 0 && hasLibraryFilters && (
                <button
                  type="button"
                  onClick={clearLibraryFilters}
                  className={`ui-control rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${accentSolidButtonClass}`}
                >
                  Clear Filters
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowImportPanel(true)}
                className={`ui-control rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${accentSoftButtonClass}`}
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
          const showCollectionHeader = lib.sortBy === 'group' && collectionLabel !== previousCollectionLabel;
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
              draggable={manual}
              onDragStart={e => { if (!manual) return; e.dataTransfer.setData('libraryEntryId', entry.id); lib.setDraggingLibraryId(entry.id); }}
              onDragEnd={() => { lib.setDraggingLibraryId(null); lib.setDragOverLibraryId(null); }}
              onDragOver={e => { if (!manual) return; e.preventDefault(); lib.setDragOverLibraryId(entry.id); }}
              onDrop={e => {
                if (!manual) return;
                e.preventDefault();
                const sourceId = e.dataTransfer.getData('libraryEntryId');
                const rect = e.currentTarget.getBoundingClientRect();
                const position = e.clientY > rect.top + rect.height / 2 ? 'after' : 'before';
                lib.moveLibraryEntry(sourceId, entry.id, position);
                lib.setDragOverLibraryId(null);
              }}
              className={`${m.surface} border ${editingId === entry.id ? 'border-orange-400/60 ring-1 ring-orange-400/30' : `${m.border} ${m.borderHov}`} rounded-lg overflow-hidden transition-colors ${manual ? 'cursor-grab active:cursor-grabbing' : ''} ${lib.dragOverLibraryId === entry.id ? 'border-orange-400/60' : ''} ${lib.draggingLibraryId === entry.id ? 'opacity-50' : ''}`}>
              <div className="flex items-start justify-between px-3 py-2.5 gap-2">
                <div className="flex-1 min-w-0">
                  {lib.renamingId === entry.id ? (
                    <div className="flex gap-1.5">
                      <input autoFocus value={lib.renameValue} onChange={e => lib.setRenameValue(e.target.value)}
                        className={`flex-1 ${m.input} border rounded-lg px-2 py-1 text-xs focus:outline-none ${accentFocusClass} ${m.text}`} />
                      <button type="button" onClick={() => lib.renameEntry(entry.id, lib.renameValue, editingId, setSaveTitle)} className={`ui-control px-2 py-1 text-xs rounded-lg transition-colors ${accentSolidButtonClass}`}>Save</button>
                      <button type="button" onClick={() => { lib.setRenamingId(null); lib.setRenameValue(''); }} className={`ui-control px-2 py-1 text-xs ${m.btn} ${m.textAlt} rounded-lg transition-colors`}>Cancel</button>
                    </div>
                  ) : (
                    <p className={`text-sm font-semibold ${m.text} truncate flex items-center gap-1.5`}>
                      {entry.title}
                      {(entry.metadata?.status === 'draft' || (!entry.enhanced?.trim() && !entry.original?.trim())) && <DraftBadge tone="warning">draft</DraftBadge>}
                    </p>
                  )}
                  <div className={`flex items-center gap-2 text-xs ${m.textMuted} mt-0.5 flex-wrap`}>
                    {entry.collection && <span className="flex items-center gap-1"><Ic n="FolderOpen" size={8} />{entry.collection}</span>}
                    <span>{new Date(entry.createdAt).toLocaleDateString()}</span>
                    {entry.useCount > 0 && <span className="text-orange-300">{entry.useCount}×</span>}
                    {(entry.versions || []).length > 0 && <span className="flex items-center gap-0.5 text-blue-400"><Ic n="Clock" size={8} />{entry.versions.length}v</span>}
                    {extractVars(entry.enhanced).length > 0 && <span className="text-amber-400">{'{{vars}}'}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {manual && (
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
                    className={`ui-control px-2.5 py-1 rounded ${accentSoftButtonClass} text-xs font-semibold transition-colors`}
                  >
                    Use
                  </button>
                  <button
                    type="button"
                    onClick={() => { copy(entry.enhanced); lib.bumpUse(entry.id); }}
                    className={`ui-control px-2.5 py-1 rounded ${m.btn} ${m.textAlt} text-xs font-semibold hover:text-orange-300 transition-colors`}
                  >
                    Copy
                  </button>
                  <button
                    type="button"
                    onClick={() => lib.setExpandedId(p => p === entry.id ? null : entry.id)}
                    className={`ui-control px-2.5 py-1 rounded ${m.btn} ${m.textAlt} text-xs font-semibold transition-colors flex items-center gap-1`}
                  >
                    More
                    <Ic n={lib.expandedId === entry.id ? 'ChevronUp' : 'ChevronDown'} size={11} />
                  </button>
                </div>
              </div>
              {(entry.tags || []).length > 0 && <div className="flex flex-wrap gap-1 px-3 pb-2">{entry.tags.map(t => <TagChip key={t} tag={t} />)}</div>}
              {lib.shareId === entry.id && (
                <div className={`border-t ${m.border} px-3 py-2 flex gap-2`}>
                  <input readOnly className={`flex-1 ${m.input} border rounded-lg px-2 py-1 text-xs focus:outline-none ${m.text} font-mono`} value={shareUrl || 'Unable to create share URL'} />
                  <button type="button" onClick={() => copy(shareUrl || '')} className={`ui-control px-2 py-1 rounded-lg text-xs font-medium transition-colors ${accentSolidButtonClass}`}>Copy URL</button>
                </div>
              )}
              {lib.expandedId === entry.id && (
                <div className={`border-t ${m.border} px-3 py-3 flex flex-col gap-3`}>
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
                  {[['Original', m.textSub, entry.original], ['Enhanced', accentTextClass, entry.enhanced]].map(([lbl, col, txt]) => (
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
                      {entry.variants.map((v, i) => <div key={i} className="mb-1.5"><span className="text-xs text-orange-300 font-bold">{v.label}: </span><span className={`text-xs ${m.textAlt}`}>{v.content}</span></div>)}
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
                  <div className={`pt-1 border-t ${m.border}`}>
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
          <div className={`mt-4 pt-4 border-t ${m.border}`}>
            <p className={`text-xs ${m.textSub} uppercase tracking-widest font-semibold mb-3`}>Starter Libraries</p>
            <div className="flex flex-col gap-2">
              {lib.starterLibraries.map(pack => (
                <StarterPackCard key={pack.id} pack={pack} m={m} onLoad={lib.loadStarterPack} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

export default LibraryPanel;
