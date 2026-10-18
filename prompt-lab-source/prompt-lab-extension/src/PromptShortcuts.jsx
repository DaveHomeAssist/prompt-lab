import { useEffect, useId, useState } from 'react';
import Ic from './icons';
import {
  PROMPT_SHORTCUTS_SHORT_QUERY, matchesMedia, readPromptShortcutsOpen, writePromptShortcutsOpen,
} from './lib/promptShortcutsPreference.js';

function useShortViewport() {
  const [short, setShort] = useState(() => matchesMedia(PROMPT_SHORTCUTS_SHORT_QUERY));
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const query = window.matchMedia(PROMPT_SHORTCUTS_SHORT_QUERY);
    const update = () => setShort(query.matches);
    query.addEventListener?.('change', update);
    return () => query.removeEventListener?.('change', update);
  }, []);
  return short;
}

/**
 * Prompt shortcuts — slice 2A (C6) of docs/ENHANCE_WORKSPACE_REDESIGN_BRIEF.md.
 *
 * Folds the Recent and Quick chip rows into one collapsible section with a
 * count. Phones start closed so the editor keeps its space; the choice is
 * remembered. Loading still goes through `loadEntry`, which keeps the existing
 * draft-preservation behaviour.
 */
export default function PromptShortcuts({
  m, recentPrompts = [], quickInject = [], loadEntry, copy, bumpUse,
  accentTextClass, accentHoverTextClass,
}) {
  const [open, setOpen] = useState(readPromptShortcutsOpen);
  const short = useShortViewport();
  const listId = useId();
  const recent = Array.isArray(recentPrompts) ? recentPrompts : [];
  const quick = Array.isArray(quickInject) ? quickInject : [];
  const count = new Set([...recent, ...quick].map(entry => entry.id)).size;
  if (count === 0) return null;

  const toggle = () => {
    setOpen(prev => {
      const next = !prev;
      writePromptShortcutsOpen(next);
      return next;
    });
  };
  // 44px targets for touch; compact on mouse and trackpad so the editor keeps its place.
  const touchTarget = 'min-h-8 [@media(pointer:coarse)]:min-h-11';
  const actionClass = `${touchTarget} shrink-0 px-1.5 text-[11px] font-semibold transition-colors ${accentHoverTextClass}`;

  const renderGroup = (label, entries, { withCopy }) => (
    <div className={short ? 'flex items-center gap-1.5 shrink-0' : 'flex items-start gap-2'}>
      <h3 className={`text-[10px] ${m.textMuted} uppercase tracking-wider font-semibold shrink-0 ${short ? '' : 'pt-2'}`}>{label}</h3>
      <ul className={`flex gap-1.5 ${short ? 'flex-nowrap' : 'flex-wrap min-w-0'}`}>
        {entries.map(entry => (
          <li key={entry.id} className={`inline-flex items-center gap-0.5 min-w-0 max-w-full ${m.codeBlock} border ${m.border} rounded-md pl-2`}>
            <span className={`text-[11px] ${m.textBody} truncate max-w-[14rem]`} title={entry.title}>{entry.title}</span>
            {withCopy && (
              <button
                type="button"
                aria-label={`Copy ${entry.title}`}
                onClick={() => { copy(entry.enhanced, `Copied: ${entry.title}`); bumpUse(entry.id); }}
                className={`${actionClass} ${m.textAlt}`}
              >
                Copy
              </button>
            )}
            <button
              type="button"
              aria-label={`Load ${entry.title}`}
              onClick={() => loadEntry(entry)}
              className={`${actionClass} ${accentTextClass}`}
            >
              Load
            </button>
          </li>
        ))}
      </ul>
    </div>
  );

  return (
    <section
      className={`${m.surface} border ${m.border} rounded-lg ${short && open ? 'flex items-center min-w-0' : ''}`}
      aria-label="Prompt shortcuts"
      data-layout={short ? 'row' : 'stack'}
    >
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={listId}
        className={`${short && open ? 'w-auto shrink-0' : 'w-full'} ${touchTarget} flex justify-between items-center gap-2 px-3 py-1 text-xs font-semibold ${m.textSub}`}
      >
        <span className="flex items-center gap-1.5">
          <Ic n="Zap" size={11} className="text-yellow-500" />
          Prompt shortcuts
          <span className={`font-normal ${m.textMuted}`}>({count})</span>
        </span>
        <Ic n={open ? 'ChevronUp' : 'ChevronDown'} size={12} />
      </button>
      <div id={listId} hidden={!open} className={`${open ? 'flex' : 'hidden'} ${short ? 'min-w-0 flex-1 flex-row items-center gap-3 overflow-x-auto pr-2 py-1' : 'px-3 pb-2 max-h-40 overflow-y-auto flex-col gap-1.5'}`}>
        {recent.length > 0 && renderGroup('Recent', recent, { withCopy: false })}
        {quick.length > 0 && renderGroup('Quick prompts', quick, { withCopy: true })}
      </div>
    </section>
  );
}
