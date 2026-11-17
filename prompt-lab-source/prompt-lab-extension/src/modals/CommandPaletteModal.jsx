import { useCallback, useRef, useState } from 'react';
import Ic from '../icons';
import useDialogA11y from '../hooks/useDialogA11y.js';
import { PALETTE_GROUP_LABELS } from '../lib/commandPaletteSearch.js';

export default function CommandPaletteModal({ m, cmdQuery, setCmdQuery, filteredCmds, onClose }) {
  const inputRef = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const closeDialog = useCallback(() => closeRef.current?.(), []);
  const dialogRef = useDialogA11y({ onClose: closeDialog, initialFocusRef: inputRef });
  const items = Array.isArray(filteredCmds) ? filteredCmds : [];
  const resultKey = items.map((item) => `${item.kind || 'action'}:${item.label}`).join('|');
  const [active, setActive] = useState({ key: resultKey, index: 0 });
  const activeIndex = active.key === resultKey ? Math.min(active.index, Math.max(0, items.length - 1)) : 0;
  const setActiveIndex = (updater) => {
    setActive((current) => {
      const index = current.key === resultKey ? current.index : 0;
      const next = typeof updater === 'function' ? updater(index) : updater;
      return { key: resultKey, index: next };
    });
  };

  const runAt = (index) => {
    const item = items[index];
    if (typeof item?.action === 'function') item.action();
  };

  const onSearchKeyDown = (event) => {
    if (!items.length) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => Math.min(items.length - 1, index + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => Math.max(0, index - 1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      runAt(activeIndex);
    }
  };

  const groups = PALETTE_GROUP_LABELS.map(([kind, label]) => {
    const rows = items.map((item, index) => ({ item, index })).filter(({ item }) => (item.kind || 'action') === kind);
    return { kind, label, rows };
  }).filter((group) => group.rows.length > 0);

  return (
    <div className={`fixed inset-0 ${m.modalBg} flex items-start justify-center z-[90] pt-20 p-4`} onClick={closeDialog}>
      <div
        ref={dialogRef}
        className={`pl-modal-panel ${m.modal} border rounded-xl w-full max-w-md overflow-hidden shadow-2xl`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="command-palette-title"
        aria-describedby="command-palette-description"
        tabIndex={-1}
        onClick={e => e.stopPropagation()}
        data-testid="command-palette"
      >
        <h2 id="command-palette-title" className="sr-only">Command palette</h2>
        <p id="command-palette-description" className="sr-only">
          Search prompts, actions, and settings. Arrow keys move through results, Enter runs the highlighted result, and Escape closes.
        </p>
        <div className={`flex items-center gap-2 px-4 py-3 border-b ${m.border}`}>
          <Ic n="Search" size={13} className={m.textSub} />
          <input
            ref={inputRef}
            className={`flex-1 bg-transparent text-sm ${m.text} focus:outline-none placeholder-gray-500`}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded="true"
            aria-controls="command-palette-results"
            aria-activedescendant={items[activeIndex] ? `command-palette-option-${activeIndex}` : undefined}
            aria-label="Search prompts, actions, and settings"
            placeholder="Search prompts, actions, and settings…"
            value={cmdQuery}
            onChange={e => setCmdQuery(e.target.value)}
            onKeyDown={onSearchKeyDown}
          />
          <span aria-hidden="true" className={`text-xs ${m.textSub} font-mono`}>ESC</span>
        </div>
        <p className="sr-only" role="status" aria-live="polite">
          {items.length} result{items.length === 1 ? '' : 's'}.
        </p>
        <div id="command-palette-results" className="max-h-80 overflow-y-auto" aria-label="Command results">
          {groups.map((group) => (
            <section key={group.kind} aria-label={group.label}>
              <h3 className={`px-4 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wider ${m.textSub}`}>{group.label}</h3>
              {group.rows.map(({ item, index }) => (
                <button
                  key={`${group.kind}-${item.id || item.label}-${index}`}
                  id={`command-palette-option-${index}`}
                  type="button"
                  onClick={() => runAt(index)}
                  onMouseEnter={() => setActiveIndex(index)}
                  aria-current={index === activeIndex ? 'true' : undefined}
                  className={`w-full min-h-11 flex items-center justify-between gap-3 px-4 py-2.5 text-sm text-left transition-colors ${index === activeIndex ? 'bg-orange-600 text-white' : `${m.textBody} hover:bg-orange-600 hover:text-white`}`}
                >
                  <span className="min-w-0">
                    <span className="block truncate">{item.label}</span>
                    {item.detail ? <span className={`block truncate text-xs ${index === activeIndex ? 'text-white/80' : m.textMuted}`}>{item.detail}</span> : null}
                  </span>
                  {item.hint ? <kbd className={`shrink-0 text-xs font-mono px-1.5 py-0.5 ${m.pill} rounded`}>{item.hint}</kbd> : null}
                </button>
              ))}
            </section>
          ))}
          {items.length === 0 && <div className={`ui-empty-state text-xs ${m.textMuted}`}>No prompts, actions, or settings match</div>}
        </div>
      </div>
    </div>
  );
}
