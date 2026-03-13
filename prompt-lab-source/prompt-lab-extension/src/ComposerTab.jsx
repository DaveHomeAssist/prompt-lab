import { useState } from 'react';
import Ic from './icons';

export default function ComposerTab({ m, library, composerBlocks, setComposerBlocks, addToComposer, notify, copy, setRaw, setTab, compact = false }) {
  const [dragOverComposer, setDragOverComposer] = useState(false);
  const [draggingLibId, setDraggingLibId] = useState(null);
  const [dragOverBlockIdx, setDragOverBlockIdx] = useState(null);
  const [mobileView, setMobileView] = useState('canvas');

  const composedPrompt = composerBlocks.map(b => `# ${b.label}\n${b.content}`).join('\n\n---\n\n');
  const showLibrary = !compact || mobileView === 'library';
  const showCanvas = !compact || mobileView === 'canvas';
  const showPreview = !compact || mobileView === 'preview';

  return (
    <div className="flex flex-1 overflow-hidden">
      <div className={`${compact ? 'hidden' : 'w-64 shrink-0'} flex flex-col border-r ${m.border} overflow-hidden`}>
        <div className={`px-3 py-2 border-b ${m.border} shrink-0`}><p className={`text-xs font-semibold ${m.textSub} uppercase tracking-wider`}>Library · Drag to add</p></div>
        <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1.5">
          {library.length === 0 && <p className={`text-xs ${m.textMuted} p-2`}>No saved prompts yet.</p>}
          {library.map(entry => (
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
                <button onClick={() => addToComposer(entry)} className="text-violet-400 hover:text-violet-300 shrink-0 transition-colors"><Ic n="Plus" size={14} /></button>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className={`px-4 py-2 border-b ${m.border} flex items-center justify-between shrink-0`}>
          <p className={`text-xs font-semibold ${m.textSub} uppercase tracking-wider`}>Canvas ({composerBlocks.length} blocks)</p>
          <div className="flex gap-2">
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
        <div className={`flex flex-1 overflow-hidden gap-3 p-3 ${compact ? 'flex-col' : ''}`}>
          {showLibrary && (
          <div className={`${compact ? 'min-h-0 max-h-44' : 'hidden'} rounded-xl border ${m.border} overflow-hidden`}>
            <div className={`px-3 py-2 border-b ${m.border} shrink-0`}>
              <p className={`text-xs font-semibold ${m.textSub} uppercase tracking-wider`}>Library</p>
            </div>
            <div className="overflow-y-auto p-2 flex flex-col gap-1.5 h-full">
              {library.length === 0 && <p className={`text-xs ${m.textMuted} p-2`}>No saved prompts yet.</p>}
              {library.map(entry => (
                <div key={entry.id} className={`border rounded-lg p-2.5 transition-colors ${m.draggable}`}>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <p className={`text-xs font-semibold ${m.text} truncate`}>{entry.title}</p>
                      <p className={`text-xs ${m.textAlt} line-clamp-1 mt-0.5`}>{entry.enhanced}</p>
                    </div>
                    <button onClick={() => addToComposer(entry)} className="text-violet-400 hover:text-violet-300 shrink-0 transition-colors"><Ic n="Plus" size={14} /></button>
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
              <div className="flex flex-col items-center justify-center h-full gap-2 pointer-events-none">
                <Ic n="Layers" size={28} className={m.textMuted} />
                <p className={`text-sm ${m.textSub}`}>Drop prompts here</p>
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
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-bold text-violet-400">{block.label}</span>
                      <button onClick={() => setComposerBlocks(prev => prev.filter((_, i) => i !== idx))} className={`${m.textMuted} hover:text-red-400 transition-colors`}><Ic n="X" size={11} /></button>
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
    </div>
  );
}
