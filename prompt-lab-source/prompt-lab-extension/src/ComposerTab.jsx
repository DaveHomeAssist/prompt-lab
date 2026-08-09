import { useState } from 'react';
import Ic from './icons';
import { matchesLibrarySearch } from './lib/libraryMatching.js';
import ChainRunnerPanel from './ChainRunnerPanel.jsx';

const STARTER_COLLECTIONS = new Set([
  'Handoff Templates',
  'Prompt Engineering',
  'Writing',
  'Analysis',
  'Code',
]);

const STARTER_TAGS = new Set([
  'Writing',
  'System',
  'Analysis',
  'Code',
  'Research',
]);

function getEntryUseCount(entry) {
  return Number.isFinite(entry?.useCount) ? Math.max(0, entry.useCount) : 0;
}

function getComposerEntryProfile(entry) {
  const collection = typeof entry?.collection === 'string' ? entry.collection.trim() : '';
  const tags = Array.isArray(entry?.tags) ? entry.tags.filter(Boolean) : [];
  const useCount = getEntryUseCount(entry);
  const hasStarterTag = tags.some((tag) => STARTER_TAGS.has(tag));
  const hasStarterCollection = STARTER_COLLECTIONS.has(collection);

  if (useCount >= 3) {
    return {
      tone: 'popular',
      badge: 'Popular',
      dotClass: 'bg-sky-400',
      buttonLabel: 'Add Popular',
      buttonClass: 'bg-sky-600 text-white hover:bg-sky-500',
      borderClass: 'border-sky-500/35 hover:border-sky-400',
    };
  }

  if (hasStarterTag || hasStarterCollection) {
    return {
      tone: 'starter',
      badge: 'Start Here',
      dotClass: 'bg-emerald-400',
      buttonLabel: 'Add Starter',
      buttonClass: 'bg-emerald-600 text-white hover:bg-emerald-500',
      borderClass: 'border-emerald-500/35 hover:border-emerald-400',
    };
  }

  return {
    tone: 'specialist',
    badge: collection || 'Specialized',
    dotClass: 'bg-violet-400',
    buttonLabel: 'Add Block',
    buttonClass: 'bg-violet-600 text-white hover:bg-violet-500',
    borderClass: 'border-violet-500/20 hover:border-violet-400',
  };
}

function getComposerEntryPriority(entry) {
  const profile = getComposerEntryProfile(entry);
  const useCount = getEntryUseCount(entry);
  if (profile.tone === 'popular') return 200 + useCount;
  if (profile.tone === 'starter') return 100 + useCount;
  return useCount;
}

function compareComposerEntries(left, right) {
  const priorityDelta = getComposerEntryPriority(right) - getComposerEntryPriority(left);
  if (priorityDelta !== 0) return priorityDelta;

  const useDelta = getEntryUseCount(right) - getEntryUseCount(left);
  if (useDelta !== 0) return useDelta;

  return (left?.title || '').localeCompare(right?.title || '', undefined, { sensitivity: 'base' });
}

function buildComposerSections(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return [];

  const sorted = [...entries].sort(compareComposerEntries);
  const recommendedCandidates = sorted.filter((entry) => getComposerEntryPriority(entry) > 0);
  const startHere = (
    recommendedCandidates.length > 0
      ? recommendedCandidates.slice(0, Math.min(6, recommendedCandidates.length))
      : sorted.slice(0, Math.min(4, sorted.length))
  );
  const startHereIds = new Set(startHere.map((entry) => entry.id));
  const specialized = sorted.filter((entry) => !startHereIds.has(entry.id));
  const sections = [];

  if (startHere.length > 0) {
    sections.push({
      id: 'start-here',
      title: 'Start Here',
      description: 'Pinned starters and high-use blocks for fast composition.',
      entries: startHere,
    });
  }

  if (specialized.length > 0) {
    sections.push({
      id: 'specialized',
      title: 'Specialized Library',
      description: 'Collection-specific blocks for more niche workflows.',
      entries: specialized,
    });
  }

  return sections;
}

export default function ComposerTab({ m, library, composerBlocks, setComposerBlocks, addToComposer, notify, copy, setRaw, setTab, saveChain, compact = false, pageScroll = false }) {
  const [dragOverComposer, setDragOverComposer] = useState(false);
  const [draggingLibId, setDraggingLibId] = useState(null);
  const [dragOverBlockIdx, setDragOverBlockIdx] = useState(null);
  const [mobileView, setMobileView] = useState('canvas');
  const [search, setSearch] = useState('');
  const [showChainLab, setShowChainLab] = useState(false);

  const composedPrompt = composerBlocks.map(b => `# ${b.label}\n${b.content}`).join('\n\n---\n\n');
  const filtered = library.filter(entry => matchesLibrarySearch(entry, search));
  const composerSections = buildComposerSections(filtered);
  const showLibrary = !compact || mobileView === 'library';
  const showCanvas = !compact || mobileView === 'canvas';
  const showPreview = !compact || mobileView === 'preview';

  const moveBlock = (fromIdx, toIdx) => {
    if (toIdx < 0 || toIdx >= composerBlocks.length || fromIdx === toIdx) return;
    setComposerBlocks((prev) => {
      const next = [...prev];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return next;
    });
  };

  const renderLibraryEntry = (entry, { draggable }) => {
    const profile = getComposerEntryProfile(entry);
    const useCount = getEntryUseCount(entry);

    return (
      <div
        key={entry.id}
        draggable={draggable}
        onDragStart={draggable ? (event) => {
          event.dataTransfer.setData('entryId', entry.id);
          setDraggingLibId(entry.id);
        } : undefined}
        onDragEnd={draggable ? (() => setDraggingLibId(null)) : undefined}
        className={`border rounded-lg p-2.5 transition-colors ${m.draggable} ${profile.borderClass} ${draggingLibId === entry.id ? 'opacity-40' : ''} ${draggable ? 'cursor-grab active:cursor-grabbing' : ''}`}
      >
        <div className="flex items-center gap-2">
          {draggable && <Ic n="GripVertical" size={11} className={m.textMuted} />}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className={`text-xs font-semibold ${m.text} truncate`}>{entry.title}</p>
              <span className={`inline-flex items-center gap-1 rounded-full border ${m.border} ${m.codeBlock} px-1.5 py-0.5 text-[10px] font-semibold ${m.textSub}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${profile.dotClass}`} />
                {profile.badge}
              </span>
            </div>
            <div className={`mt-1 flex flex-wrap items-center gap-2 text-[10px] ${m.textMuted}`}>
              {entry.collection && <span>{entry.collection}</span>}
              {useCount > 0 && <span>{useCount} use{useCount === 1 ? '' : 's'}</span>}
            </div>
            <p className={`text-xs ${m.textAlt} line-clamp-1 mt-1`}>{entry.enhanced}</p>
          </div>
          <button
            type="button"
            onClick={() => addToComposer(entry)}
            className={`ui-control shrink-0 rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${profile.buttonClass}`}
          >
            {profile.buttonLabel}
          </button>
        </div>
      </div>
    );
  };

  const renderLibraryList = ({ draggable }) => (
    <>
      {library.length === 0 && <p className={`text-xs ${m.textMuted} p-2`}>No saved prompts yet.</p>}
      {library.length > 0 && filtered.length === 0 && <p className={`text-xs ${m.textMuted} p-2`}>No matches for &lsquo;{search}&rsquo;</p>}
      {composerSections.map((section) => (
        <div key={section.id} className="flex flex-col gap-1.5">
          <div className="px-1 pt-1">
            <div className="flex items-center gap-2">
              <span className={`text-[10px] font-semibold uppercase tracking-wider ${m.textSub}`}>{section.title}</span>
              <span className={`text-[10px] ${m.textMuted}`}>{section.entries.length}</span>
            </div>
            <p className={`text-[11px] ${m.textMuted} mt-1`}>{section.description}</p>
          </div>
          {section.entries.map((entry) => renderLibraryEntry(entry, { draggable }))}
        </div>
      ))}
    </>
  );

  return (
    <div className={pageScroll ? `flex ${compact ? 'flex-col' : ''}` : 'flex flex-1 overflow-hidden'}>
      <div className={`${compact ? 'hidden' : 'w-72 shrink-0'} flex flex-col border-r ${m.border} ${pageScroll ? '' : 'overflow-hidden'}`}>
        <div className={`px-3 py-2 border-b ${m.border} shrink-0`}>
          <p className={`text-xs font-semibold ${m.textSub} uppercase tracking-wider`}>Library</p>
          <p className={`text-xs ${m.textMuted} mt-1`}>Start with pinned blocks, then pull in specialized prompts when you need them. Drag remains optional.</p>
        </div>
        <div className={`px-2 pt-2 shrink-0`}>
          <div className="relative">
            <Ic n="Search" size={12} className={`absolute left-2 top-1/2 -translate-y-1/2 ${m.textMuted}`} />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Filter library..."
              className={`w-full text-xs ${m.input} border ${m.border} rounded-lg pl-7 pr-7 py-1.5 outline-none`}
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className={`absolute right-2 top-1/2 -translate-y-1/2 ${m.textMuted} hover:${m.text}`}
              >
                <Ic n="X" size={12} />
              </button>
            )}
          </div>
          <p className={`text-[11px] ${m.textMuted} mt-1 px-0.5`}>{filtered.length} of {library.length}</p>
        </div>
        <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-3">
          {renderLibraryList({ draggable: true })}
        </div>
      </div>

      <div className={`flex-1 flex flex-col ${pageScroll ? '' : 'overflow-hidden'}`}>
        <div className={`px-4 py-2 border-b ${m.border} flex items-center justify-between shrink-0`}>
          <div>
            <p className={`text-xs font-semibold ${m.textSub} uppercase tracking-wider`}>Canvas ({composerBlocks.length} blocks)</p>
            <p className={`text-xs ${m.textMuted} mt-1`}>Pinned starters are meant to get you moving. Use Add Popular, Add Starter, and Add Block for more deliberate composition.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {composerBlocks.length > 0 && <>
              <button onClick={() => copy(composedPrompt, 'Composed prompt copied!')} className={`flex items-center gap-1 text-xs ${m.btn} ${m.textAlt} px-2 py-1 rounded-lg transition-colors`}><Ic n="Copy" size={11} />Copy All</button>
              <button onClick={() => { setRaw(composedPrompt); setTab('editor'); notify('Loaded into editor!'); }} className="flex items-center gap-1.5 text-xs bg-violet-600 hover:bg-violet-500 text-white px-2 py-1 rounded-lg transition-colors"><Ic n="ArrowRight" size={11} />Send to Editor</button>
              {typeof saveChain === 'function' && (
                <button onClick={() => { const saved = saveChain(composerBlocks); if (saved) setShowChainLab(true); }} disabled={composerBlocks.length === 0}
                  className={`flex items-center gap-1 text-xs ${m.btn} ${m.textAlt} disabled:opacity-40 px-2 py-1 rounded-lg transition-colors`}>
                  <Ic n="GitBranch" size={11} />Save as Chain
                </button>
              )}
              <button onClick={() => setShowChainLab(p => !p)}
                className={`flex items-center gap-1 text-xs px-2 py-1 rounded-lg transition-colors ${showChainLab ? 'bg-violet-600 text-white' : `${m.btn} ${m.textAlt}`}`}>
                <Ic n="GitBranch" size={11} />Chain Lab
              </button>
              <button onClick={() => setComposerBlocks([])} className={`flex items-center gap-1 text-xs ${m.dangerBtn} px-2 py-1 rounded-lg transition-colors`}><Ic n="Trash2" size={11} />Clear</button>
            </>}
          </div>
        </div>

        {compact && (
          <div className={`px-3 py-2 border-b ${m.border} flex gap-1 overflow-x-auto shrink-0`}>
            {[['library', `Library (${library.length})`], ['canvas', `Canvas (${composerBlocks.length})`], ['preview', 'Preview']].map(([id, label]) => (
              <button key={id} onClick={() => setMobileView(id)}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${mobileView === id ? 'bg-violet-600 text-white' : `${m.btn} ${m.textAlt}`}`}>
                {label}
              </button>
            ))}
          </div>
        )}

        <div className={`flex ${pageScroll ? '' : 'flex-1 overflow-hidden'} gap-3 p-3 ${compact ? 'flex-col' : ''}`}>
          {showLibrary && (
            <div className={`${compact ? 'min-h-0 max-h-56' : 'hidden'} rounded-xl border ${m.border} overflow-hidden`}>
              <div className={`px-3 py-2 border-b ${m.border} shrink-0`}>
                <p className={`text-xs font-semibold ${m.textSub} uppercase tracking-wider`}>Library</p>
                <p className={`text-xs ${m.textMuted} mt-1`}>Start with pinned blocks, then reach for specialized prompts when the job gets more specific.</p>
              </div>
              <div className={`px-2 pt-2 shrink-0`}>
                <div className="relative">
                  <Ic n="Search" size={12} className={`absolute left-2 top-1/2 -translate-y-1/2 ${m.textMuted}`} />
                  <input
                    type="text"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Filter library..."
                    className={`w-full text-xs ${m.input} border ${m.border} rounded-lg pl-7 pr-7 py-1.5 outline-none`}
                  />
                  {search && (
                    <button
                      type="button"
                      onClick={() => setSearch('')}
                      className={`absolute right-2 top-1/2 -translate-y-1/2 ${m.textMuted} hover:${m.text}`}
                    >
                      <Ic n="X" size={12} />
                    </button>
                  )}
                </div>
                <p className={`text-[11px] ${m.textMuted} mt-1 px-0.5`}>{filtered.length} of {library.length}</p>
              </div>
              <div className="overflow-y-auto p-2 flex flex-col gap-3 h-full">
                {renderLibraryList({ draggable: false })}
              </div>
            </div>
          )}

          {showCanvas && (
            <div
              onDragOver={e => { e.preventDefault(); setDragOverComposer(true); }}
              onDragLeave={() => setDragOverComposer(false)}
              onDrop={e => { e.preventDefault(); setDragOverComposer(false); const id = e.dataTransfer.getData('entryId'); const entry = library.find(x => x.id === id); if (entry) addToComposer(entry); }}
              className={`flex-1 rounded-xl border-2 transition-colors overflow-y-auto flex flex-col gap-2 p-3 ${dragOverComposer ? m.dropOver : m.dropZone}`}>
              {composerBlocks.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full gap-2 pointer-events-none">
                  <Ic n="Layers" size={28} className={m.textMuted} />
                  <p className={`text-sm ${m.textSub}`}>Start with a pinned block or add a specialized prompt to begin building.</p>
                </div>
              )}
              {composerBlocks.map((block, idx) => (
                <div key={block.id} draggable
                  onDragStart={e => e.dataTransfer.setData('blockIdx', String(idx))}
                  onDragOver={e => { e.preventDefault(); setDragOverBlockIdx(idx); }}
                  onDragLeave={() => setDragOverBlockIdx(null)}
                  onDrop={e => { e.stopPropagation(); const from = parseInt(e.dataTransfer.getData('blockIdx')); if (!isNaN(from) && from !== idx) { setComposerBlocks(prev => { const a = [...prev]; const [mv] = a.splice(from, 1); a.splice(idx, 0, mv); return a; }); } setDragOverBlockIdx(null); }}
                  className={`border rounded-lg p-3 cursor-grab active:cursor-grabbing transition-colors ${m.composedBlock} ${m.border} ${dragOverBlockIdx === idx ? 'border-violet-500' : ''}`}>
                  <div className="flex items-start gap-2">
                    <Ic n="GripVertical" size={11} className={`${m.textMuted} mt-0.5 shrink-0`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div>
                          <span className="text-xs font-bold text-violet-400">{block.label}</span>
                          <p className={`text-[11px] ${m.textMuted} mt-1`}>Block {idx + 1} of {composerBlocks.length}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setComposerBlocks(prev => prev.filter((_, i) => i !== idx))}
                          className={`${m.textMuted} hover:text-red-400 transition-colors`}
                          aria-label={`Remove ${block.label}`}
                        >
                          <Ic n="X" size={11} />
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-2 mb-2">
                        <button
                          type="button"
                          onClick={() => moveBlock(idx, idx - 1)}
                          disabled={idx === 0}
                          className={`ui-control px-2 py-1 rounded-lg text-xs font-semibold transition-colors ${idx === 0 ? `${m.btn} ${m.textMuted} opacity-40 cursor-not-allowed` : `${m.btn} ${m.textAlt}`}`}
                        >
                          Move Up
                        </button>
                        <button
                          type="button"
                          onClick={() => moveBlock(idx, idx + 1)}
                          disabled={idx === composerBlocks.length - 1}
                          className={`ui-control px-2 py-1 rounded-lg text-xs font-semibold transition-colors ${idx === composerBlocks.length - 1 ? `${m.btn} ${m.textMuted} opacity-40 cursor-not-allowed` : `${m.btn} ${m.textAlt}`}`}
                        >
                          Move Down
                        </button>
                      </div>
                      <div className={`text-[11px] ${m.textMuted} mb-1`}>
                        Use Move Up / Move Down to reorder. Drag to reorder is also available.
                      </div>
                      <p className={`text-xs ${m.textBody} leading-relaxed line-clamp-3`}>{block.content}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {showPreview && (
            <div className={`${compact ? 'flex-1 min-h-0' : 'w-2/5'} flex flex-col`}>
              <p className={`text-xs font-semibold ${m.textSub} uppercase tracking-wider mb-2`}>Preview</p>
              <div className={`flex-1 ${m.codeBlock} border ${m.border} rounded-xl p-3 overflow-y-auto`}>
                {composerBlocks.length > 0
                  ? <pre className={`text-xs ${m.textBody} whitespace-pre-wrap leading-relaxed font-mono`}>{composedPrompt}</pre>
                  : <p className={`text-sm ${m.textMuted}`}>Add blocks to see the combined prompt.</p>}
              </div>
            </div>
          )}
        </div>
      </div>
      {showChainLab && (
        <ChainRunnerPanel
          m={m}
          library={library}
          notify={notify}
          copy={copy}
          setRaw={setRaw}
          setTab={setTab}
          onClose={() => setShowChainLab(false)}
        />
      )}
    </div>
  );
}
