import { useState } from 'react';
import Ic from './icons';

const BLOCK_CATEGORIES = ['Role', 'Task', 'Constraints', 'Format', 'Context', 'Examples', 'Custom'];
const CATEGORY_COLORS = {
  Role:        { border: 'border-l-violet-500',  bg: 'bg-violet-500/15', text: 'text-violet-400' },
  Task:        { border: 'border-l-blue-500',    bg: 'bg-blue-500/15',   text: 'text-blue-400' },
  Constraints: { border: 'border-l-amber-500',   bg: 'bg-amber-500/15',  text: 'text-amber-400' },
  Format:      { border: 'border-l-green-500',   bg: 'bg-green-500/15',  text: 'text-green-400' },
  Context:     { border: 'border-l-teal-500',    bg: 'bg-teal-500/15',   text: 'text-teal-400' },
  Examples:    { border: 'border-l-pink-500',     bg: 'bg-pink-500/15',   text: 'text-pink-400' },
  Custom:      { border: 'border-l-gray-500',    bg: 'bg-gray-500/15',   text: 'text-gray-400' },
};

export default function ComposerTab({ m, library, composerBlocks, setComposerBlocks, addToComposer, notify, copy, setRaw, setTab, compact = false, pageScroll = false }) {
  const [dragOverComposer, setDragOverComposer] = useState(false);
  const [draggingLibId, setDraggingLibId] = useState(null);
  const [dragOverBlockIdx, setDragOverBlockIdx] = useState(null);
  const [mobileView, setMobileView] = useState('canvas');
  const [search, setSearch] = useState('');

  const cycleCategory = (idx) => {
    setComposerBlocks(prev => prev.map((b, i) => {
      if (i !== idx) return b;
      const cur = b.category || 'Custom';
      const next = BLOCK_CATEGORIES[(BLOCK_CATEGORIES.indexOf(cur) + 1) % BLOCK_CATEGORIES.length];
      return { ...b, category: next };
    }));
  };

  const composedPrompt = composerBlocks.map(b => `# ${b.label}\n${b.content}`).join('\n\n---\n\n');
  const filtered = library.filter(e => !search || e.title?.toLowerCase().includes(search.toLowerCase()) || e.enhanced?.toLowerCase().includes(search.toLowerCase()));
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

  return (
    <div className={pageScroll ? `flex ${compact ? 'flex-col' : ''}` : 'flex flex-1 overflow-hidden'}>
      <div className={`${compact ? 'hidden' : 'w-64 shrink-0'} flex flex-col border-r ${m.border} ${pageScroll ? '' : 'overflow-hidden'}`}>
        <div className={`px-3 py-2 border-b ${m.border} shrink-0`}>
          <p className={`text-xs font-semibold ${m.textSub} uppercase tracking-wider`}>Library</p>
          <p className={`text-xs ${m.textMuted} mt-1`}>Click Add to insert a block. Drag is available if you prefer.</p>
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
        <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1.5">
          {library.length === 0 && <p className={`text-xs ${m.textMuted} p-2`}>No saved prompts yet. Save a prompt from the Editor to use it here.</p>}
          {library.length > 0 && filtered.length === 0 && <p className={`text-xs ${m.textMuted} p-2`}>No matches for &lsquo;{search}&rsquo;</p>}
          {filtered.map(entry => (
            <div key={entry.id} draggable
              onDragStart={e => { e.dataTransfer.setData('entryId', entry.id); setDraggingLibId(entry.id); }}
              onDragEnd={() => setDraggingLibId(null)}
              className={`border rounded-lg p-2.5 cursor-grab active:cursor-grabbing transition-colors ${m.draggable} ${draggingLibId === entry.id ? 'opacity-40' : ''}`}>
              <div className="flex items-center gap-2">
                <Ic n="GripVertical" size={11} className={m.textMuted} />
                <div className="flex-1 min-w-0">
                  <p className={`text-xs font-semibold ${m.text} truncate`}>{entry.title}</p>
                  <p className={`text-xs ${m.textAlt} line-clamp-1 mt-0.5`}>{entry.enhanced}</p>
                </div>
                <button
                  type="button"
                  onClick={() => addToComposer(entry)}
                  className="ui-control shrink-0 rounded-lg bg-violet-600 px-2.5 py-1 text-xs font-semibold text-white transition-colors hover:bg-violet-500"
                >
                  Add
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className={`flex-1 flex flex-col ${pageScroll ? '' : 'overflow-hidden'}`}>
        <div className={`px-4 py-2 border-b ${m.border} flex items-center justify-between shrink-0`}>
          <div>
            <p className={`text-xs font-semibold ${m.textSub} uppercase tracking-wider`}>Canvas ({composerBlocks.length} blocks)</p>
            <p className={`text-xs ${m.textMuted} mt-1`}>Use Add, Move up, and Move down for precise ordering. Drag remains optional.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {composerBlocks.length > 0 && <>
              <button onClick={() => copy(composedPrompt, 'Composed prompt copied!')} className={`flex items-center gap-1 text-xs ${m.btn} ${m.textAlt} px-2 py-1 rounded-lg transition-colors`}><Ic n="Copy" size={11} />Copy All</button>
              <button onClick={() => { setRaw(composedPrompt); setTab('editor'); notify('Loaded into editor!'); }} className="flex items-center gap-1.5 text-xs bg-violet-600 hover:bg-violet-500 text-white px-2 py-1 rounded-lg transition-colors"><Ic n="ArrowRight" size={11} />Send to Editor</button>
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
          <div className={`${compact ? 'min-h-0 max-h-44' : 'hidden'} rounded-xl border ${m.border} overflow-hidden`}>
            <div className={`px-3 py-2 border-b ${m.border} shrink-0`}>
              <p className={`text-xs font-semibold ${m.textSub} uppercase tracking-wider`}>Library</p>
              <p className={`text-xs ${m.textMuted} mt-1`}>Click Add on any prompt to add it to the canvas.</p>
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
            <div className="overflow-y-auto p-2 flex flex-col gap-1.5 h-full">
              {library.length === 0 && <p className={`text-xs ${m.textMuted} p-2`}>No saved prompts yet. Save a prompt from the Editor to use it here.</p>}
              {library.length > 0 && filtered.length === 0 && <p className={`text-xs ${m.textMuted} p-2`}>No matches for &lsquo;{search}&rsquo;</p>}
              {filtered.map(entry => (
                <div key={entry.id} className={`border rounded-lg p-2.5 transition-colors ${m.draggable}`}>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <p className={`text-xs font-semibold ${m.text} truncate`}>{entry.title}</p>
                      <p className={`text-xs ${m.textAlt} line-clamp-1 mt-0.5`}>{entry.enhanced}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => addToComposer(entry)}
                      className="ui-control shrink-0 rounded-lg bg-violet-600 px-2.5 py-1 text-xs font-semibold text-white transition-colors hover:bg-violet-500"
                    >
                      Add
                    </button>
                  </div>
                </div>
              ))}
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
              <div className={`ui-empty-state ${m.surface} border ${m.border} rounded-xl p-6`}>
                <Ic n="Layers" size={28} className={m.textMuted} />
                <p className={`text-sm font-semibold ${m.text}`}>Start composing</p>
                <p className={`text-xs ${m.textMuted} max-w-xs`}>
                  Click "Add" on a saved prompt from the library, or drag it onto the canvas.
                  Blocks combine into a structured system prompt.
                </p>
              </div>
            )}
            {composerBlocks.map((block, idx) => {
              const cat = block.category || 'Custom';
              const cc = CATEGORY_COLORS[cat] || CATEGORY_COLORS.Custom;
              return (
              <div key={block.id} draggable
                onDragStart={e => e.dataTransfer.setData('blockIdx', String(idx))}
                onDragOver={e => { e.preventDefault(); setDragOverBlockIdx(idx); }}
                onDragLeave={() => setDragOverBlockIdx(null)}
                onDrop={e => { e.stopPropagation(); const from = parseInt(e.dataTransfer.getData('blockIdx')); if (!isNaN(from) && from !== idx) { setComposerBlocks(prev => { const a = [...prev]; const [mv] = a.splice(from, 1); a.splice(idx, 0, mv); return a; }); } setDragOverBlockIdx(null); }}
                className={`border border-l-4 ${cc.border} rounded-lg p-3 cursor-grab active:cursor-grabbing transition-colors ${m.composedBlock} ${m.border} ${dragOverBlockIdx === idx ? 'border-violet-500' : ''}`}>
                <div className="flex items-start gap-2">
                  <div className="flex flex-col items-center gap-1 shrink-0">
                    <span className={`flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold ${cc.bg} ${cc.text}`}>{idx + 1}</span>
                    <Ic n="GripVertical" size={11} className={`${m.textMuted}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => cycleCategory(idx)}
                          className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${cc.bg} ${cc.text} transition-colors hover:opacity-80`}
                          title="Click to change category"
                        >
                          {cat}
                        </button>
                        <span className="text-xs font-bold text-violet-400">{block.label}</span>
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
              );
            })}
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
    </div>
  );
}
