import { memo } from 'react';
import Ic from './icons';
import { extractVars, looksSensitive } from './promptUtils';
import TagChip from './TagChip';
import TestCasesPanel from './TestCasesPanel';
import MarkdownPreview from './MarkdownPreview';

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
  loadEntry, addToComposer, openSavePanel, copy,
}) {
  return (
    <div className={`${showEditorPane && !compact ? 'w-1/2' : 'w-full'} flex flex-col ${isWeb ? '' : 'overflow-hidden'}`}>
      <div className={`p-3 border-b ${m.border} flex flex-col gap-2 shrink-0`}>
        {!showEditorPane && (
          <div className="flex gap-1">
            {[
              ['editor', 'Editor'],
              ['library', 'Prompt Library'],
              ...(!compact ? [['split', 'Split']] : []),
            ].map(([id, label]) => (
              <button key={id} type="button" onClick={() => setEditorLayout(id)}
                className={`ui-control text-xs px-2 py-1 rounded-lg transition-colors ${effectiveEditorLayout === id ? 'bg-violet-600 text-white' : `${m.btn} ${m.textAlt}`}`}>
                {label}
              </button>
            ))}
          </div>
        )}
        <div className={`flex gap-2 ${compact ? 'flex-col' : ''}`}>
          <div className="relative flex-1">
            <Ic n="Search" size={11} className={`absolute left-2.5 top-1/2 -translate-y-1/2 ${m.textMuted}`} />
            <input className={`w-full ${m.input} border rounded-lg pl-7 pr-3 py-1.5 text-xs focus:outline-none focus:border-violet-500 ${m.text}`}
              placeholder="Search…" value={lib.search} onChange={e => lib.setSearch(e.target.value)} />
          </div>
          <div className={`flex gap-2 ${compact ? 'w-full' : ''}`}>
            <select value={lib.sortBy} onChange={e => lib.setSortBy(e.target.value)}
              className={`ui-control ${m.input} border rounded-lg px-2 py-1.5 text-xs ${m.textBody} focus:outline-none ${compact ? 'flex-1' : ''}`}>
              <option value="newest">Newest</option><option value="oldest">Oldest</option><option value="most-used">Most Used</option><option value="manual">Manual</option>
            </select>
            <button type="button" onClick={lib.exportLib} className={`ui-control px-2.5 rounded-lg text-xs ${m.btn} ${m.textAlt} transition-colors ${compact ? 'flex-1 py-1.5' : ''}`}>Export</button>
          </div>
        </div>
        {lib.collections.length > 0 && (
          <div className="flex gap-1 flex-wrap">
            <button type="button" onClick={() => lib.setActiveCollection(null)} className={`ui-control px-2 py-0.5 rounded-full text-xs font-medium transition-colors ${!lib.activeCollection ? 'bg-violet-600 text-white' : `${m.btn} ${m.textAlt}`}`}>All</button>
            {lib.collections.map(c => (
              <button key={c} type="button" onClick={() => lib.setActiveCollection(p => p === c ? null : c)}
                className={`ui-control px-2 py-0.5 rounded-full text-xs font-medium transition-colors flex items-center gap-1 ${lib.activeCollection === c ? 'bg-violet-600 text-white' : `${m.btn} ${m.textAlt}`}`}>
                <Ic n="FolderOpen" size={9} />{c}
              </button>
            ))}
          </div>
        )}
        {lib.allLibTags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {lib.allLibTags.map(t => <TagChip key={t} tag={t} selected={lib.activeTag === t} onClick={() => lib.setActiveTag(p => p === t ? null : t)} />)}
          </div>
        )}
      </div>
      <div className={`${isWeb ? '' : 'flex-1 overflow-y-auto'} p-3 flex flex-col gap-2`}>
        {lib.filtered.length === 0 && (
          <div className={`ui-empty-state h-full ${m.codeBlock} border ${m.border}`}>
            <Ic n="Wand2" size={24} className={m.textMuted} />
            <p className={`text-sm ${m.textSub}`}>{lib.library.length === 0 ? 'No saved prompts yet.' : 'No results found.'}</p>
          </div>
        )}
        {lib.filtered.map(entry => {
          const manual = lib.sortBy === 'manual';
          const shareUrl = lib.shareId === entry.id ? lib.getShareUrl(entry) : null;
          return (
            <div key={entry.id}
              draggable={manual}
              onDragStart={e => { if (!manual) return; e.dataTransfer.setData('libraryEntryId', entry.id); lib.setDraggingLibraryId(entry.id); }}
              onDragEnd={() => { lib.setDraggingLibraryId(null); lib.setDragOverLibraryId(null); }}
              onDragOver={e => { if (!manual) return; e.preventDefault(); lib.setDragOverLibraryId(entry.id); }}
              onDrop={e => { if (!manual) return; e.preventDefault(); lib.moveLibraryEntry(e.dataTransfer.getData('libraryEntryId'), entry.id); lib.setDragOverLibraryId(null); }}
              className={`${m.surface} border ${editingId === entry.id ? 'border-violet-500 ring-1 ring-violet-500/30' : `${m.border} ${m.borderHov}`} rounded-lg overflow-hidden transition-colors ${manual ? 'cursor-grab active:cursor-grabbing' : ''} ${lib.dragOverLibraryId === entry.id ? 'border-violet-500' : ''} ${lib.draggingLibraryId === entry.id ? 'opacity-50' : ''}`}>
              <div className="flex items-start justify-between px-3 py-2.5 gap-2">
                <div className="flex-1 min-w-0">
                  {lib.renamingId === entry.id ? (
                    <div className="flex gap-1.5">
                      <input autoFocus value={lib.renameValue} onChange={e => lib.setRenameValue(e.target.value)}
                        className={`flex-1 ${m.input} border rounded-lg px-2 py-1 text-xs focus:outline-none focus:border-violet-500 ${m.text}`} />
                      <button type="button" onClick={() => lib.renameEntry(entry.id, lib.renameValue, editingId, setSaveTitle)} className="ui-control px-2 py-1 text-xs bg-violet-600 hover:bg-violet-500 text-white rounded-lg transition-colors">Save</button>
                      <button type="button" onClick={() => { lib.setRenamingId(null); lib.setRenameValue(''); }} className={`ui-control px-2 py-1 text-xs ${m.btn} ${m.textAlt} rounded-lg transition-colors`}>Cancel</button>
                    </div>
                  ) : (
                    <p className={`text-sm font-semibold ${m.text} truncate`}>{entry.title}</p>
                  )}
                  <div className={`flex items-center gap-2 text-xs ${m.textMuted} mt-0.5 flex-wrap`}>
                    {entry.collection && <span className="flex items-center gap-1"><Ic n="FolderOpen" size={8} />{entry.collection}</span>}
                    <span>{new Date(entry.createdAt).toLocaleDateString()}</span>
                    {entry.useCount > 0 && <span className="text-violet-400">{entry.useCount}×</span>}
                    {(entry.versions || []).length > 0 && <span className="flex items-center gap-0.5 text-blue-400"><Ic n="Clock" size={8} />{entry.versions.length}v</span>}
                    {extractVars(entry.enhanced).length > 0 && <span className="text-amber-400">{'{{vars}}'}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {manual && <Ic n="GripVertical" size={12} className={m.textMuted} />}
                  <button type="button" onClick={() => { copy(entry.enhanced); lib.bumpUse(entry.id); }} className={`ui-control p-1.5 rounded ${m.btn} ${m.textSub} hover:text-violet-400 transition-colors`}><Ic n="Copy" size={12} /></button>
                  <button type="button" onClick={() => loadEntry(entry)} className={`ui-control px-2 py-1 rounded ${m.btn} text-violet-400 text-xs font-semibold transition-colors`}>Load</button>
                  <button type="button" onClick={() => lib.setExpandedId(p => p === entry.id ? null : entry.id)} className={`ui-control p-1.5 rounded ${m.btn} ${m.textSub} transition-colors`}>
                    {lib.expandedId === entry.id ? <Ic n="ChevronUp" size={12} /> : <Ic n="ChevronDown" size={12} />}
                  </button>
                </div>
              </div>
              {(entry.tags || []).length > 0 && <div className="flex flex-wrap gap-1 px-3 pb-2">{entry.tags.map(t => <TagChip key={t} tag={t} />)}</div>}
              {lib.shareId === entry.id && (
                <div className={`border-t ${m.border} px-3 py-2 flex gap-2`}>
                  <input readOnly className={`flex-1 ${m.input} border rounded-lg px-2 py-1 text-xs focus:outline-none ${m.text} font-mono`} value={shareUrl || 'Unable to create share URL'} />
                  <button type="button" onClick={() => copy(shareUrl || '')} className="ui-control px-2 py-1 bg-violet-600 hover:bg-violet-500 text-white rounded-lg text-xs font-medium transition-colors">Copy URL</button>
                </div>
              )}
              {lib.expandedId === entry.id && (
                <div className={`border-t ${m.border} px-3 py-3 flex flex-col gap-3`}>
                  <div className={`flex flex-wrap gap-2`}>
                    <button type="button" onClick={() => addToComposer(entry)} className={`ui-control px-2 py-1 rounded ${m.btn} ${m.textAlt} text-xs transition-colors flex items-center gap-1`}><Ic n="Layers" size={11} />Add to Compose</button>
                    <button type="button" onClick={() => {
                      if ((looksSensitive(entry.original) || looksSensitive(entry.enhanced) || looksSensitive(entry.notes))
                        && !window.confirm('This shared link may include sensitive content. Continue?')) return;
                      lib.setShareId(p => p === entry.id ? null : entry.id);
                    }} className={`ui-control px-2 py-1 rounded ${m.btn} ${m.textAlt} text-xs transition-colors flex items-center gap-1`}><Ic n="Share2" size={11} />Share</button>
                    <button type="button" onClick={() => { loadEntry(entry); openSavePanel(entry); }} className={`ui-control px-2 py-1 rounded ${m.btn} ${m.textAlt} text-xs transition-colors`}>Edit</button>
                    <button type="button" onClick={() => { lib.setRenamingId(entry.id); lib.setRenameValue(entry.title); }} className={`ui-control px-2 py-1 rounded ${m.btn} ${m.textAlt} text-xs transition-colors`}>Rename</button>
                    <button type="button" onClick={() => lib.del(entry.id)} className="ui-control px-2 py-1 rounded bg-red-600 hover:bg-red-500 text-white text-xs transition-colors flex items-center gap-1"><Ic n="Trash2" size={11} />Delete</button>
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
                  {[['Original', m.textSub, entry.original], ['Enhanced', 'text-violet-400', entry.enhanced]].map(([lbl, col, txt]) => (
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
                      {entry.variants.map((v, i) => <div key={i} className="mb-1.5"><span className="text-xs text-violet-400 font-bold">{v.label}: </span><span className={`text-xs ${m.textAlt}`}>{v.content}</span></div>)}
                    </div>
                  )}
                  {(entry.versions || []).length > 0 && (
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-xs text-blue-400 font-semibold uppercase tracking-wider flex items-center gap-1"><Ic n="Clock" size={9} />Version History ({entry.versions.length})</p>
                        <button
                          onClick={() => lib.openVersionHistory(entry.id, 0)}
                          className={`text-xs ${m.textSub} hover:text-white transition-colors flex items-center gap-1`}
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
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
});

export default LibraryPanel;
