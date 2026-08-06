import { useEffect, useRef } from 'react';
import Ic from '../icons';

function relativeTime(value) {
  const timestamp = new Date(value || 0).getTime();
  if (!timestamp || Number.isNaN(timestamp)) return '';
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function PadSidebar({ payload, m, renamingId, renameValue, onRenameValue, onStartRename, onCommitRename, onCancelRename, onSelect, onCreate }) {
  const inputRef = useRef(null);
  useEffect(() => {
    if (renamingId) inputRef.current?.select();
  }, [renamingId]);

  return (
    <aside className={`flex w-full shrink-0 flex-col border-b sm:w-[210px] sm:border-b-0 sm:border-r ${m.border}`} aria-label="Scratchpads">
      <div className={`flex items-center justify-between border-b px-3 py-2 ${m.border}`}>
        <span className={`text-xs font-semibold ${m.text}`}>Scratchpads</span>
        <button type="button" onClick={onCreate} className={`ui-control flex h-8 w-8 items-center justify-center rounded-md ${m.btn} ${m.textAlt}`} title="New pad" aria-label="New pad">
          <Ic n="Plus" size={13} />
        </button>
      </div>
      <div className="flex max-h-36 gap-1 overflow-x-auto p-1 sm:max-h-none sm:flex-1 sm:flex-col sm:overflow-x-hidden sm:overflow-y-auto">
        {payload.pads.map((pad) => {
          const active = pad.id === payload.activePadId;
          if (renamingId === pad.id) {
            return (
              <input
                key={pad.id}
                ref={inputRef}
                aria-label={`Rename ${pad.name}`}
                value={renameValue}
                onChange={(event) => onRenameValue(event.target.value)}
                onBlur={onCommitRename}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') { event.preventDefault(); onCommitRename(); }
                  if (event.key === 'Escape') { event.preventDefault(); onCancelRename(); }
                }}
                className={`min-w-40 rounded-md border px-2 py-2 text-xs sm:w-full ${m.input} ${m.border} ${m.text}`}
              />
            );
          }
          return (
            <button
              key={pad.id}
              type="button"
              onClick={() => onSelect(pad.id)}
              onDoubleClick={() => onStartRename(pad)}
              title="Double-click to rename"
              className={`min-w-40 border-r-2 px-3 py-2 text-left transition-colors sm:w-full ${active ? 'border-orange-400 bg-orange-500/12' : `${m.btn} border-transparent`}`}
            >
              <span className={`block truncate text-xs font-medium ${active ? 'text-orange-300' : m.text}`}>{pad.name}</span>
              <span className={`mt-0.5 block truncate text-[10px] ${m.textMuted}`}>{pad.plainText || 'Empty pad'}</span>
              <span className={`mt-0.5 block text-[10px] ${m.textMuted}`}>{relativeTime(pad.updatedAt)}</span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
