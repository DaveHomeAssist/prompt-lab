import { useEffect, useRef } from 'react';
import Ic from './icons';
import { handleTabArrowKeys } from './hooks/useDialogA11y.js';

const TABS = Object.freeze([
  { id: 'scratch', label: 'Scratch', name: 'Scratch notes beside Write' },
  { id: 'prompts', label: 'Prompts', name: 'Prompts beside Write' },
]);

// The panel beside the Write editor: a resizable column on wide screens, or a
// floating panel over the editor on narrow ones. Its tabs switch between
// Scratch notes and saved prompts; `children` is the active tab's content.
export default function WriteSidePanel({
  m = {},
  tab = 'scratch',
  onTabChange,
  onClose,
  overlay = false,
  // Leave room for the phone navigation bar at the bottom of the screen.
  aboveMobileNav = false,
  width = 360,
  children,
}) {
  const active = TABS.find((item) => item.id === tab) || TABS[0];
  const panelRef = useRef(null);
  // A floating panel takes focus when it opens (the note editor, or the chosen
  // prompt list), so Escape and typing go to it. Switching tabs later keeps
  // focus on the tabs because this panel stays mounted.
  useEffect(() => {
    if (!overlay) return undefined;
    const id = setTimeout(() => {
      const panel = panelRef.current;
      (panel?.querySelector('[data-side-autofocus]') || panel?.querySelector('[role="tab"][aria-selected="true"]'))?.focus();
    }, 0);
    return () => clearTimeout(id);
    // Only on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <aside
      ref={panelRef}
      className={`pl-write-side ${overlay ? 'is-overlay' : ''} ${overlay && aboveMobileNav ? 'is-above-mobile-nav' : ''} ${m.surface || ''} ${m.border || ''}`}
      style={overlay ? { width: `min(${width}px, 92vw)` } : undefined}
      aria-label={active.name}
      data-side-tab={active.id}
      onKeyDown={(event) => { if (overlay && event.key === 'Escape') { event.stopPropagation(); onClose?.(); } }}
    >
      <header className="pl-write-side-header">
        <div className="pl-segmented pl-write-side-tabs" role="tablist" aria-label="Panel beside Write" onKeyDown={(event) => handleTabArrowKeys(event, active.id, (id) => onTabChange?.(id))}>
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={`write-side-tab-${item.id}`}
              data-tab-id={item.id}
              aria-selected={active.id === item.id}
              aria-controls="write-side-tabpanel"
              tabIndex={active.id === item.id ? 0 : -1}
              onClick={() => onTabChange?.(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <button type="button" className="ui-control pl-secondary-button" onClick={onClose} aria-label="Close side panel" title="Close (Cmd or Ctrl + \)"><Ic n="X" size={12} /></button>
      </header>
      <div id="write-side-tabpanel" role="tabpanel" aria-labelledby={`write-side-tab-${active.id}`} className="pl-write-side-body">
        {children}
      </div>
    </aside>
  );
}
