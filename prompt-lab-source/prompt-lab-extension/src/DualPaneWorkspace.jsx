import { useMemo, useRef, useState } from 'react';
import Ic from './icons';

function promptContent(entry) {
  return entry?.enhanced || entry?.original || '';
}

export default function DualPaneWorkspace({ library, raw, setRaw, notify, openEntry }) {
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState(library[0]?.id || '');
  const [leftWidth, setLeftWidth] = useState(42);
  const [swapped, setSwapped] = useState(false);
  const [mobilePane, setMobilePane] = useState('library');
  const textareaRef = useRef(null);
  const selected = library.find((entry) => entry.id === selectedId) || library[0] || null;
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return library;
    return library.filter((entry) => [entry.title, entry.collection, ...(entry.tags || []), promptContent(entry)].join(' ').toLowerCase().includes(needle));
  }, [library, query]);

  const applyPrompt = (mode) => {
    const content = promptContent(selected);
    if (!content) return;
    const input = textareaRef.current;
    const start = input?.selectionStart ?? raw.length;
    const end = input?.selectionEnd ?? start;
    let next = raw;
    let caret = start + content.length;
    if (mode === 'replace') next = raw.slice(0, start) + content + raw.slice(end);
    if (mode === 'insert') next = raw.slice(0, start) + content + raw.slice(start);
    if (mode === 'append') {
      const separator = raw.trim() ? '\n\n' : '';
      next = raw + separator + content;
      caret = next.length;
    }
    setRaw(next);
    setMobilePane('editor');
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(caret, caret);
    });
    notify(`${mode[0].toUpperCase()}${mode.slice(1)}ed ${selected.title}.`);
  };

  const beginResize = (event) => {
    const root = event.currentTarget.parentElement;
    if (!root) return;
    const onMove = (moveEvent) => {
      const bounds = root.getBoundingClientRect();
      const relative = ((moveEvent.clientX - bounds.left) / bounds.width) * 100;
      const next = swapped ? 100 - relative : relative;
      setLeftWidth(Math.min(68, Math.max(28, next)));
    };
    const stop = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', stop);
      document.body.style.cursor = '';
    };
    document.body.style.cursor = 'col-resize';
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', stop);
  };

  const libraryPane = (
    <section className={`pl-dual-library ${mobilePane === 'library' ? 'is-mobile-active' : ''}`} aria-label="Dual pane library">
      <header><div><p className="pl-eyebrow">Source pane</p><h2>Library</h2></div><span>{filtered.length}</span></header>
      <label><Ic n="Search" size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a prompt…" /></label>
      <div className="pl-dual-prompt-list">
        {filtered.map((entry) => <button type="button" key={entry.id} aria-current={selected?.id === entry.id ? 'true' : undefined} onClick={() => setSelectedId(entry.id)}>
          <strong>{entry.title}</strong><span>{promptContent(entry).slice(0, 120)}</span><small>{entry.collection || 'Unfiled'} · {entry.useCount || 0} uses</small>
        </button>)}
      </div>
    </section>
  );

  const editorPane = (
    <section className={`pl-dual-editor ${mobilePane === 'editor' ? 'is-mobile-active' : ''}`} aria-label="Dual pane editor">
      <header>
        <div><p className="pl-eyebrow">Target pane</p><h2>Write</h2></div>
        <div><span>{raw.length.toLocaleString()} chars</span><button type="button" className="pl-icon-button" onClick={() => setSwapped((value) => !value)} aria-label="Swap panes"><Ic n="ArrowRightLeft" size={14} /></button></div>
      </header>
      {selected && <div className="pl-dual-insert-bar">
        <div><p className="pl-eyebrow">Selected</p><strong>{selected.title}</strong></div>
        <div>
          <button type="button" onClick={() => applyPrompt('insert')}>Insert</button>
          <button type="button" onClick={() => applyPrompt('replace')}>Replace selection</button>
          <button type="button" onClick={() => applyPrompt('append')}>Append</button>
          <button type="button" onClick={() => openEntry(selected)}>Open full</button>
        </div>
      </div>}
      <textarea ref={textareaRef} value={raw} onChange={(event) => setRaw(event.target.value)} aria-label="Dual pane prompt editor" placeholder="Write here, then insert or replace from the selected library prompt…" />
    </section>
  );

  return (
    <div className="pl-dual-workspace">
      <div className="pl-dual-mobile-tabs" role="tablist" aria-label="Dual pane mobile view">
        <button type="button" role="tab" aria-selected={mobilePane === 'library'} onClick={() => setMobilePane('library')}>Library</button>
        <button type="button" role="tab" aria-selected={mobilePane === 'editor'} onClick={() => setMobilePane('editor')}>Write</button>
      </div>
      <div className={`pl-dual-grid ${swapped ? 'is-swapped' : ''}`} style={{ '--pl-dual-left': `${leftWidth}%` }}>
        {swapped ? editorPane : libraryPane}
        <button type="button" className="pl-dual-resizer" aria-label="Resize dual panes" onPointerDown={beginResize}><span /></button>
        {swapped ? libraryPane : editorPane}
      </div>
    </div>
  );
}
