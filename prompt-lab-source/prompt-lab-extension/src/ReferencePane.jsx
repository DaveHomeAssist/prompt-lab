import { useRef, useEffect } from 'react';
import Ic from './icons';

const MODE_LABELS = { entry: 'Entry', preview: 'Preview' };

export default function ReferencePane({ m, activePad, referenceEntryId, referenceMode, onSelectEntry, onModeChange, onClose, docked }) {
  const bodyRef = useRef(null);
  const entries = activePad?.entries || [];
  const entry = entries.find(e => e.id === referenceEntryId) || entries[0] || null;

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
  }, [referenceEntryId, referenceMode]);

  const wrapClass = docked
    ? `w-[45%] shrink-0 border-l ${m.border} flex flex-col overflow-hidden`
    : `fixed bottom-0 left-0 right-0 h-[60vh] z-50 border-t ${m.border} flex flex-col shadow-2xl`;

  const bgClass = docked ? m.bg : `${m.bg} backdrop-blur-xl`;

  return (
    <div className={`${wrapClass} ${bgClass}`}>
      {/* Header */}
      <div className={`flex items-center gap-2 px-3 py-2 border-b ${m.border} shrink-0`}>
        <Ic n="PanelRight" size={12} className={m.textMuted} />
        <span className={`text-xs font-semibold ${m.text} flex-1 truncate`}>Reference</span>

        {/* Mode toggle */}
        <div className="flex rounded-md overflow-hidden border border-white/10">
          {Object.entries(MODE_LABELS).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => onModeChange(key)}
              className={`text-[10px] px-2 py-0.5 transition-colors ${
                referenceMode === key
                  ? 'bg-violet-600 text-white'
                  : `${m.btn} ${m.textAlt}`
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={onClose}
          className={`p-1 rounded transition-colors hover:bg-white/10 ${m.textMuted}`}
          title="Close reference panel"
        >
          <Ic n="X" size={12} />
        </button>
      </div>

      {/* Entry selector */}
      <div className={`px-3 py-1.5 border-b ${m.border} shrink-0`}>
        <select
          value={entry?.id || ''}
          onChange={e => onSelectEntry(e.target.value)}
          className={`w-full text-xs rounded-lg border ${m.input} ${m.text} px-2 py-1.5 focus:outline-none focus:border-violet-500 transition-colors`}
        >
          {entries.map(ent => (
            <option key={ent.id} value={ent.id}>
              {ent.title || ent.body?.split('\n')[0]?.slice(0, 60) || 'Untitled'}
            </option>
          ))}
        </select>
      </div>

      {/* Body */}
      <div ref={bodyRef} className="flex-1 overflow-y-auto min-h-0 p-3">
        {!entry ? (
          <p className={`text-xs italic ${m.textMuted} text-center py-8`}>No entries in this pad.</p>
        ) : referenceMode === 'preview' ? (
          <div className={`text-sm leading-relaxed ${m.text} whitespace-pre-wrap break-words`}>
            {entry.body || '(empty)'}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {entry.title && (
              <div className={`text-xs font-semibold ${m.text} pb-1 border-b ${m.border}`}>
                {entry.title}
              </div>
            )}
            <textarea
              readOnly
              value={entry.body || ''}
              className={`w-full min-h-[8rem] flex-1 resize-y rounded-lg border ${m.input} p-3 text-sm leading-relaxed ${m.text} focus:outline-none cursor-text`}
              placeholder="(empty)"
            />
            <div className={`flex items-center gap-3 text-[10px] ${m.textMuted}`}>
              {entry.status && <span className="uppercase tracking-wider">{entry.status.replace('_', ' ')}</span>}
              {entry.project && <span>&middot; {entry.project}</span>}
              {entry.updatedAt && <span>&middot; {new Date(entry.updatedAt).toLocaleDateString()}</span>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
