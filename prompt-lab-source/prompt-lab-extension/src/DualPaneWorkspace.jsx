import { useEffect, useMemo, useRef, useState } from 'react';
import Ic from './icons';
import { handleTabArrowKeys } from './hooks/useDialogA11y.js';

const MIN_PANE_WIDTH = 28;
const MAX_PANE_WIDTH = 72;
const PANE_STEP = 4;

function promptContent(entry) {
  return entry?.enhanced || entry?.original || '';
}

function clampPaneWidth(value) {
  return Math.min(MAX_PANE_WIDTH, Math.max(MIN_PANE_WIDTH, value));
}

function autosaveLabel(status, dirty) {
  if (status === 'saving') return 'Saving…';
  if (status === 'error') return 'Save failed';
  if (status === 'pending' || status === 'dirty' || dirty) return 'Unsaved changes';
  if (status === 'saved') return 'Saved';
  return 'Ready';
}

export default function DualPaneWorkspace({
  library = [],
  raw,
  setRaw,
  notify = () => {},
  openEntry,
  copy,
  draftTitle,
  onDraftTitleChange,
  dirty,
  autosaveStatus,
  onAutosave,
  onEnhance,
  onSave,
  onSaveVersion,
  enhancing = false,
  saving = false,
  mobilePane: controlledMobilePane,
  onMobilePaneChange,
}) {
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState(library[0]?.id || '');
  const [splitPosition, setSplitPosition] = useState(50);
  const [swapped, setSwapped] = useState(false);
  const [fallbackMobilePane, setFallbackMobilePane] = useState('library');
  const [fallbackTitle, setFallbackTitle] = useState('Untitled prompt');
  const [internalDirty, setInternalDirty] = useState(false);
  const [internalAutosaveStatus, setInternalAutosaveStatus] = useState('idle');
  const [undoSnapshot, setUndoSnapshot] = useState(null);
  const [actionMessage, setActionMessage] = useState('');
  const textareaRef = useRef(null);
  const promptListRef = useRef(null);
  const changeRevisionRef = useRef(0);
  const mobilePane = controlledMobilePane === undefined ? fallbackMobilePane : controlledMobilePane;
  const title = (draftTitle === undefined ? fallbackTitle : draftTitle) || '';
  const resolvedDirty = dirty === undefined ? internalDirty : dirty;
  const resolvedAutosaveStatus = autosaveStatus === undefined
    ? internalAutosaveStatus
    : autosaveStatus;
  const selected = library.find((entry) => entry.id === selectedId) || library[0] || null;
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return library;
    return library.filter((entry) => [
      entry.title,
      entry.collection,
      ...(entry.tags || []),
      promptContent(entry),
    ].join(' ').toLowerCase().includes(needle));
  }, [library, query]);

  useEffect(() => {
    if (selectedId && library.some((entry) => entry.id === selectedId)) return;
    setSelectedId(library[0]?.id || '');
  }, [library, selectedId]);

  useEffect(() => {
    if (filtered.length === 0 || filtered.some((entry) => entry.id === selectedId)) return;
    setSelectedId(filtered[0].id);
  }, [filtered, selectedId]);

  useEffect(() => {
    if (!onAutosave || !resolvedDirty) return undefined;
    const revision = changeRevisionRef.current;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setInternalAutosaveStatus('saving');
      try {
        const result = await onAutosave({ raw, title });
        if (result === false || result?.ok === false) throw new Error('Autosave was not acknowledged.');
        if (cancelled || revision !== changeRevisionRef.current) return;
        setInternalDirty(false);
        setInternalAutosaveStatus('saved');
      } catch {
        if (cancelled || revision !== changeRevisionRef.current) return;
        setInternalAutosaveStatus('error');
        setInternalDirty(true);
      }
    }, 650);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [onAutosave, raw, resolvedDirty, title]);

  const selectMobilePane = (nextPane) => {
    if (controlledMobilePane === undefined) setFallbackMobilePane(nextPane);
    onMobilePaneChange?.(nextPane);
  };

  const markDraftDirty = () => {
    changeRevisionRef.current += 1;
    setInternalDirty(true);
    setInternalAutosaveStatus(onAutosave ? 'pending' : 'dirty');
  };

  const announce = (message, notifyUser = true) => {
    setActionMessage(message);
    if (notifyUser) notify(message);
  };

  const focusEditor = (start, end = start) => {
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(start, end);
    });
  };

  const updateDraft = (next, caret, { preserveUndo = false } = {}) => {
    if (!preserveUndo) setUndoSnapshot(null);
    setRaw(next);
    markDraftDirty();
    selectMobilePane('editor');
    focusEditor(caret);
  };

  const applyPrompt = (mode) => {
    const content = promptContent(selected);
    if (!content) return;
    const input = textareaRef.current;
    const start = input?.selectionStart ?? raw.length;
    let next = raw;
    let caret = start + content.length;
    let message = '';

    if (mode === 'replace') {
      setUndoSnapshot({ raw, start, end: input?.selectionEnd ?? start });
      next = content;
      caret = content.length;
      message = `Replaced the entire draft with ${selected.title}. Undo is available.`;
    } else if (mode === 'insert') {
      next = raw.slice(0, start) + content + raw.slice(start);
      message = `Inserted ${selected.title} at the cursor.`;
    } else if (mode === 'append') {
      const separator = raw.trim() ? '\n\n' : '';
      next = raw + separator + content;
      caret = next.length;
      message = `Appended ${selected.title} to the draft.`;
    }

    updateDraft(next, caret, { preserveUndo: mode === 'replace' });
    announce(message);
  };

  const undoReplace = () => {
    if (!undoSnapshot) return;
    const snapshot = undoSnapshot;
    setUndoSnapshot(null);
    setRaw(snapshot.raw);
    markDraftDirty();
    selectMobilePane('editor');
    focusEditor(snapshot.start, snapshot.end);
    announce('Restored the draft from before replacement.');
  };

  const handleCopy = async () => {
    const content = promptContent(selected);
    if (!content) return;
    try {
      if (copy) await copy(content, `Copied ${selected.title}.`);
      else await navigator.clipboard.writeText(content);
      announce(`Copied ${selected.title}.`, !copy);
    } catch {
      announce(`Could not copy ${selected.title}.`);
    }
  };

  const runDraftAction = async (action, label) => {
    if (!action) return;
    setActionMessage(`${label} requested.`);
    try {
      await action({ raw, title, selectedEntry: selected });
    } catch {
      announce(`${label} failed.`);
    }
  };

  const beginResize = (event) => {
    const root = event.currentTarget.parentElement;
    if (!root) return;
    const onMove = (moveEvent) => {
      const bounds = root.getBoundingClientRect();
      if (!bounds.width) return;
      const relative = ((moveEvent.clientX - bounds.left) / bounds.width) * 100;
      setSplitPosition(clampPaneWidth(relative));
    };
    const stop = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      document.body.style.cursor = '';
    };
    document.body.style.cursor = 'col-resize';
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
  };

  const resizeWithKeyboard = (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    setSplitPosition((current) => {
      if (event.key === 'Home') return MIN_PANE_WIDTH;
      if (event.key === 'End') return MAX_PANE_WIDTH;
      return clampPaneWidth(current + (event.key === 'ArrowRight' ? PANE_STEP : -PANE_STEP));
    });
  };

  const swapPanes = () => {
    setSwapped((current) => !current);
    setSplitPosition((current) => 100 - current);
    announce('Swapped the library and editor panes.');
  };

  const resetPanes = () => {
    setSplitPosition(50);
    announce('Reset both panes to equal width.');
  };

  const handleOptionKeyDown = (event) => {
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key) || filtered.length === 0) return;
    event.preventDefault();
    const currentIndex = Math.max(0, filtered.findIndex((entry) => entry.id === selected?.id));
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? filtered.length - 1
        : (currentIndex + (event.key === 'ArrowDown' ? 1 : -1) + filtered.length) % filtered.length;
    const nextId = filtered[nextIndex].id;
    setSelectedId(nextId);
    requestAnimationFrame(() => {
      [...(promptListRef.current?.querySelectorAll('[role="option"]') || [])]
        .find((option) => option.dataset.promptId === nextId)
        ?.focus();
    });
  };

  const libraryPane = (
    <section
      id="dual-library-panel"
      className={`pl-dual-library ${mobilePane === 'library' ? 'is-mobile-active' : ''}`}
      role="tabpanel"
      aria-labelledby="dual-library-tab"
    >
      <header>
        <div><p className="pl-eyebrow">Source pane</p><h2>Library</h2></div>
        <span aria-label={`${filtered.length} matching prompts`}>{filtered.length}</span>
      </header>
      <label htmlFor="dual-library-search">
        <Ic n="Search" size={14} />
        <span className="sr-only">Search library prompts</span>
        <input
          id="dual-library-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Find a prompt…"
          aria-controls="dual-prompt-list"
        />
      </label>
      <div
        ref={promptListRef}
        id="dual-prompt-list"
        className="pl-dual-prompt-list"
        role="listbox"
        aria-label="Library prompts"
        aria-activedescendant={filtered.some((entry) => entry.id === selected?.id)
          ? `dual-prompt-${selected.id}`
          : undefined}
      >
        {filtered.map((entry) => (
          <button
            type="button"
            role="option"
            id={`dual-prompt-${entry.id}`}
            data-prompt-id={entry.id}
            key={entry.id}
            aria-selected={selected?.id === entry.id}
            aria-current={selected?.id === entry.id ? 'true' : undefined}
            tabIndex={selected?.id === entry.id ? 0 : -1}
            onKeyDown={handleOptionKeyDown}
            onClick={() => setSelectedId(entry.id)}
          >
            <strong>{entry.title}</strong>
            <span>{promptContent(entry).slice(0, 120)}</span>
            <small>{entry.collection || 'Unfiled'} · {entry.useCount || 0} uses</small>
          </button>
        ))}
        {filtered.length === 0 && <p role="status">No prompts match this search.</p>}
      </div>
      {selected && (
        <section className="pl-dual-preview" aria-labelledby="dual-preview-title" data-testid="dual-selected-preview">
          <header>
            <div>
              <p className="pl-eyebrow">Full preview</p>
              <h3 id="dual-preview-title">{selected.title}</h3>
            </div>
            <small>{selected.collection || 'Unfiled'}</small>
          </header>
          {selected.tags?.length > 0 && (
            <ul aria-label="Selected prompt tags">
              {selected.tags.map((tag) => <li key={tag}>{tag}</li>)}
            </ul>
          )}
          <pre>{promptContent(selected)}</pre>
        </section>
      )}
    </section>
  );

  const editorPane = (
    <section
      id="dual-editor-panel"
      className={`pl-dual-editor ${mobilePane === 'editor' ? 'is-mobile-active' : ''}`}
      role="tabpanel"
      aria-labelledby="dual-editor-tab"
    >
      <header>
        <div className="pl-dual-title-field">
          <label htmlFor="dual-draft-title" className="pl-eyebrow">Target pane</label>
          <input
            id="dual-draft-title"
            value={title}
            onChange={(event) => {
              if (draftTitle === undefined) setFallbackTitle(event.target.value);
              onDraftTitleChange?.(event.target.value);
              markDraftDirty();
            }}
            aria-label="Draft title"
            placeholder="Untitled prompt"
          />
        </div>
        <div className="pl-dual-editor-status">
          <span>{raw.length.toLocaleString()} chars</span>
          <span
            className="pl-dual-autosave-status"
            data-status={resolvedAutosaveStatus}
            role="status"
            aria-live="polite"
          >
            {autosaveLabel(resolvedAutosaveStatus, resolvedDirty)}
          </span>
          <div role="toolbar" aria-label="Pane layout controls">
            <button type="button" className="pl-icon-button" onClick={swapPanes} aria-label="Swap panes">
              <Ic n="ArrowRightLeft" size={14} />
            </button>
            <button type="button" onClick={resetPanes}>Reset 50/50</button>
          </div>
        </div>
      </header>
      {selected && (
        <div className="pl-dual-insert-bar">
          <div><p className="pl-eyebrow">Selected</p><strong>{selected.title}</strong></div>
          <div role="toolbar" aria-label="Selected prompt actions">
            <button type="button" onClick={() => applyPrompt('insert')}>Insert at cursor</button>
            <button type="button" onClick={() => applyPrompt('replace')}>Replace draft</button>
            <button type="button" onClick={() => applyPrompt('append')}>Append</button>
            <button type="button" onClick={handleCopy}>Copy</button>
            <button type="button" onClick={() => openEntry?.(selected)} disabled={!openEntry}>Open full</button>
          </div>
        </div>
      )}
      <div className="pl-dual-draft-toolbar" role="toolbar" aria-label="Draft actions">
        <button
          type="button"
          onClick={() => runDraftAction(onEnhance, 'Enhance draft')}
          disabled={!onEnhance || enhancing || !raw.trim()}
        >
          {enhancing ? 'Enhancing…' : 'Enhance draft'}
        </button>
        <button
          type="button"
          onClick={() => runDraftAction(onSave, 'Save as new prompt')}
          disabled={!onSave || saving || !raw.trim()}
        >
          {saving ? 'Saving…' : 'Save as new prompt'}
        </button>
        <button
          type="button"
          onClick={() => runDraftAction(onSaveVersion, 'Save new version')}
          disabled={!onSaveVersion || saving || !raw.trim()}
        >
          Save new version
        </button>
        {undoSnapshot && <button type="button" onClick={undoReplace}>Undo replace</button>}
      </div>
      <textarea
        ref={textareaRef}
        value={raw}
        onChange={(event) => {
          setRaw(event.target.value);
          setUndoSnapshot(null);
          markDraftDirty();
        }}
        aria-label="Dual pane prompt editor"
        placeholder="Write here, then insert or replace from the selected library prompt…"
      />
      <p className="pl-dual-live-status" role="status" aria-live="polite">{actionMessage}</p>
    </section>
  );

  return (
    <div className="pl-dual-workspace">
      <div
        className="pl-dual-mobile-tabs"
        role="tablist"
        aria-label="Dual pane mobile view"
        onKeyDown={(event) => handleTabArrowKeys(event, mobilePane, selectMobilePane)}
      >
        <button
          type="button"
          id="dual-library-tab"
          role="tab"
          data-tab-id="library"
          aria-controls="dual-library-panel"
          aria-selected={mobilePane === 'library'}
          tabIndex={mobilePane === 'library' ? 0 : -1}
          onClick={() => selectMobilePane('library')}
        >
          Library
        </button>
        <button
          type="button"
          id="dual-editor-tab"
          role="tab"
          data-tab-id="editor"
          aria-controls="dual-editor-panel"
          aria-selected={mobilePane === 'editor'}
          tabIndex={mobilePane === 'editor' ? 0 : -1}
          onClick={() => selectMobilePane('editor')}
        >
          Write
        </button>
      </div>
      <div
        className={`pl-dual-grid ${swapped ? 'is-swapped' : ''}`}
        style={{ '--pl-dual-left': `${splitPosition}%` }}
      >
        {swapped ? editorPane : libraryPane}
        <div
          className="pl-dual-resizer"
          role="separator"
          tabIndex={0}
          aria-label="Resize dual panes"
          aria-orientation="vertical"
          aria-valuemin={MIN_PANE_WIDTH}
          aria-valuemax={MAX_PANE_WIDTH}
          aria-valuenow={Math.round(splitPosition)}
          aria-valuetext={`Left pane ${Math.round(splitPosition)} percent`}
          onKeyDown={resizeWithKeyboard}
          onPointerDown={beginResize}
        >
          <span aria-hidden="true" />
        </div>
        {swapped ? libraryPane : editorPane}
      </div>
    </div>
  );
}
