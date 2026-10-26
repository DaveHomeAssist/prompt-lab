import { useEffect, useMemo, useRef, useState } from 'react';
import Ic from './icons';
import ScratchNoteRow from './ScratchNoteRow.jsx';
import {
  SCRATCH_KEY,
  buildDefaultScratchPayload,
  migrateScratchStorage,
  normalizeScratchPad,
  normalizeScratchPayload,
  persistScratchState,
} from './lib/scratchSchema.js';

const AUTOSAVE_MS = 600;

function buildPadId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `pad-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function orderPads(pads) {
  const byRecent = (left, right) => right.updatedAt - left.updatedAt || left.name.localeCompare(right.name);
  return [...pads.filter((pad) => pad.pinned).sort(byRecent), ...pads.filter((pad) => !pad.pinned).sort(byRecent)];
}

// Scratch notes beside the Write editor. It reads and writes the same Scratch
// storage as the full Scratch destination, through the same revision-checked
// persistence, and is never mounted at the same time as that destination.
export default function ScratchSidePanel({
  m = {},
  colorMode = 'dark',
  notify,
  onInsert,
  onOpenInScratch,
  onClose,
  overlay = false,
  // Leave room for the phone navigation bar at the bottom of the screen.
  aboveMobileNav = false,
  autoFocus = false,
  width = 360,
}) {
  const [padsState, setPadsState] = useState(() => buildDefaultScratchPayload('', Date.now()));
  const [text, setText] = useState('');
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const [saveState, setSaveState] = useState('idle');
  const [readFailed, setReadFailed] = useState(false);
  const padsRef = useRef(padsState);
  const revisionRef = useRef(0);
  const textRef = useRef('');
  const timerRef = useRef(null);
  const textareaRef = useRef(null);
  const panelRef = useRef(null);

  const activePad = padsState.pads.find((pad) => pad.id === padsState.activePadId) || padsState.pads[0];
  const orderedPads = useMemo(() => orderPads(padsState.pads), [padsState.pads]);
  const isDark = colorMode === 'dark';

  const applyState = (state) => {
    revisionRef.current = state.revision || revisionRef.current;
    padsRef.current = state;
    setPadsState(state);
  };

  const showPad = (pad) => {
    const value = pad?.content || '';
    textRef.current = value;
    setText(value);
    setSelection({ start: 0, end: 0 });
  };

  const persist = (nextState, preferLocalIds = []) => {
    if (readFailed) return { ok: false };
    const result = persistScratchState(nextState, { lastKnownRevision: revisionRef.current, preferLocalIds });
    if (result.ok) applyState(result.state);
    return result;
  };

  const commit = (value) => {
    const current = padsRef.current;
    const activeId = current.activePadId;
    const stored = current.pads.find((pad) => pad.id === activeId);
    if (!stored || stored.content === value) return true;
    const updatedAt = Date.now();
    setSaveState('saving');
    const result = persist({
      ...current,
      pads: current.pads.map((pad) => pad.id === activeId
        ? normalizeScratchPad({ ...pad, content: value, updatedAt, timestamp: updatedAt })
        : pad),
    }, [activeId]);
    setSaveState(result.ok ? 'saved' : 'error');
    return result.ok;
  };

  const flush = () => {
    clearTimeout(timerRef.current);
    return commit(textRef.current);
  };

  const load = () => {
    const { payload, error, errorStage } = migrateScratchStorage();
    if (error && errorStage === 'read') {
      setReadFailed(true);
      setSaveState('error');
      return;
    }
    setReadFailed(false);
    applyState(payload);
    showPad(payload.pads.find((pad) => pad.id === payload.activePadId) || payload.pads[0]);
    setSaveState(error ? 'error' : 'idle');
  };

  useEffect(() => {
    load();
    if (autoFocus) setTimeout(() => textareaRef.current?.focus(), 0);
    // Mount-only read, matching the full Scratch destination.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the latest flush for unmount without re-subscribing every render.
  const flushRef = useRef(flush);
  useEffect(() => { flushRef.current = flush; });
  useEffect(() => () => { flushRef.current(); }, []);

  useEffect(() => {
    const onStorage = (event) => {
      if (event.key !== SCRATCH_KEY || !event.newValue) return;
      let incoming = null;
      try { incoming = normalizeScratchPayload(JSON.parse(event.newValue)); } catch { return; }
      if (!incoming) return;
      const current = padsRef.current;
      const stored = current.pads.find((pad) => pad.id === current.activePadId);
      const pendingEdits = stored ? textRef.current !== stored.content : Boolean(textRef.current);
      if (pendingEdits) return; // the next save merges through the revision check
      applyState(incoming);
      const nextActive = incoming.pads.find((pad) => pad.id === current.activePadId)
        || incoming.pads.find((pad) => pad.id === incoming.activePadId) || incoming.pads[0];
      if (nextActive && nextActive.content !== textRef.current) showPad(nextActive);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  useEffect(() => {
    if (saveState !== 'saved') return undefined;
    const id = setTimeout(() => setSaveState('idle'), 2000);
    return () => clearTimeout(id);
  }, [saveState]);

  const onChange = (event) => {
    if (readFailed) return;
    const value = event.target.value;
    textRef.current = value;
    setText(value);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => commit(value), AUTOSAVE_MS);
  };

  const selectPad = (padId) => {
    if (padId === padsRef.current.activePadId) return;
    if (!flush()) return;
    const result = persist({ ...padsRef.current, activePadId: padId });
    if (!result.ok) { setSaveState('error'); return; }
    showPad(result.state.pads.find((pad) => pad.id === padId));
  };

  const createPad = () => {
    if (!flush()) return;
    const now = Date.now();
    const current = padsRef.current;
    const pad = normalizeScratchPad({ id: buildPadId(), name: `Note ${current.pads.length + 1}`, content: '', createdAt: now, updatedAt: now });
    const result = persist({ ...current, pads: [...current.pads, pad], activePadId: pad.id }, [pad.id]);
    if (!result.ok) { setSaveState('error'); return; }
    showPad(pad);
    setTimeout(() => textareaRef.current?.focus(), 0);
  };

  const selectedText = selection.end > selection.start ? text.slice(selection.start, selection.end) : '';
  const insert = () => {
    const value = selectedText || text;
    if (!value.trim()) return;
    onInsert?.(value);
    notify?.(selectedText ? 'Inserted the selected note text into the prompt.' : `Inserted ${activePad?.name || 'the note'} into the prompt.`);
  };

  const openInScratch = () => {
    if (!flush()) return;
    onOpenInScratch?.(padsRef.current.activePadId);
  };

  const close = () => {
    flush();
    onClose?.();
  };

  const trackSelection = (event) => {
    const { selectionStart = 0, selectionEnd = 0 } = event.currentTarget;
    setSelection({ start: selectionStart, end: selectionEnd });
  };

  const status = readFailed
    ? 'Notes could not be read. Stored data has not been overwritten.'
    : saveState === 'saving' ? 'Saving…'
      : saveState === 'saved' ? 'Saved'
        : saveState === 'error' ? 'Save failed. Your text is still here; keep typing or retry.'
          : 'Saved locally';

  return (
    <aside
      ref={panelRef}
      className={`pl-write-scratch ${overlay ? 'is-overlay' : ''} ${overlay && aboveMobileNav ? 'is-above-mobile-nav' : ''} ${m.surface || ''} ${m.border || ''}`}
      style={overlay ? { width: `min(${width}px, 92vw)` } : undefined}
      aria-label="Scratch notes beside Write"
      onKeyDown={(event) => { if (overlay && event.key === 'Escape') { event.stopPropagation(); close(); } }}
    >
      <header className="pl-write-scratch-header">
        <div className="min-w-0">
          <h2 className="text-xs font-semibold">Scratch</h2>
          <p className={`text-[10px] ${m.textMuted || ''}`}>{padsState.pads.length} note{padsState.pads.length === 1 ? '' : 's'}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button type="button" className="ui-control pl-secondary-button" onClick={createPad} disabled={readFailed} aria-label="New Scratch note"><Ic n="Plus" size={12} /></button>
          <button type="button" className="ui-control pl-secondary-button" onClick={openInScratch} disabled={readFailed} aria-label="Open this note in Scratch"><Ic n="ArrowRight" size={12} /></button>
          <button type="button" className="ui-control pl-secondary-button" onClick={close} aria-label="Close Scratch panel"><Ic n="X" size={12} /></button>
        </div>
      </header>
      <nav className="pl-write-scratch-list" aria-label="Scratch notes">
        {orderedPads.map((pad) => (
          <ScratchNoteRow key={pad.id} m={m} pad={pad} active={pad.id === activePad?.id} isDark={isDark}
            density="compact" showDate={width >= 300} onSelect={selectPad} />
        ))}
      </nav>
      <div className="pl-write-scratch-note">
        <div className="flex min-w-0 items-center justify-between gap-2">
          <p className="min-w-0 truncate text-xs font-semibold" title={activePad?.name}>{activePad?.name || 'Scratch note'}</p>
          <p role="status" className={`shrink-0 text-[10px] ${saveState === 'error' || readFailed ? 'text-red-500' : m.textMuted || ''}`}>{status}</p>
        </div>
        {readFailed && <button type="button" className="pl-text-button self-start text-xs" onClick={load}>Retry loading notes</button>}
        <textarea
          ref={textareaRef}
          value={text}
          onChange={onChange}
          onSelect={trackSelection}
          onKeyUp={trackSelection}
          onMouseUp={trackSelection}
          onBlur={() => flush()}
          readOnly={readFailed}
          aria-label="Scratch note text"
          spellCheck
          placeholder="Write a note. It saves automatically."
          className={`pl-write-scratch-editor ${m.input || ''}`}
        />
        <button type="button" className="ui-control pl-primary-button self-start" onClick={insert} disabled={readFailed || !(selectedText || text).trim()}>
          <Ic n="CopyPlus" size={12} /> {selectedText ? 'Insert selection into prompt' : 'Insert note into prompt'}
        </button>
      </div>
    </aside>
  );
}
