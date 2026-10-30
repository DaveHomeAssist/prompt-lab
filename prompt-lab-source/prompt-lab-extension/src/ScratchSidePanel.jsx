import { setLibraryBufferTimeout, clearLibraryBufferTimeout } from './lib/libraryEditBuffers.js';
import { useLibraryEditBuffer } from './hooks/useLibraryEditBuffer.js';
import { useEffect, useMemo, useRef, useState } from 'react';
import Ic from './icons';
import ScratchNoteRow from './ScratchNoteRow.jsx';
import useScratchDurability from './hooks/useScratchDurability.js';
import { getScratchDurability, startScratchJournal } from './lib/scratchJournal.js';
import {
  SCRATCH_KEY,
  buildDefaultScratchPayload,
  migrateScratchStorage,
  normalizeScratchPad,
  normalizeScratchPayload,
  persistScratchState,
} from './lib/scratchSchema.js';
import { clearUnsavedScratchDraft, keepUnsavedScratchDraft, readUnsavedScratchDraft } from './lib/scratchUnsavedDraft.js';

const AUTOSAVE_MS = 600;
const KEPT_UNSAVED_MESSAGE = 'Could not save this Scratch note. Its text comes back when you reopen the panel.';

function buildPadId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `pad-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function orderPads(pads) {
  const byRecent = (left, right) => right.updatedAt - left.updatedAt || left.name.localeCompare(right.name);
  return [...pads.filter((pad) => pad.pinned).sort(byRecent), ...pads.filter((pad) => !pad.pinned).sort(byRecent)];
}

// The Scratch tab of the panel beside the Write editor (WriteSidePanel). It
// reads and writes the same Scratch storage as the full Scratch destination,
// through the same revision-checked persistence, and is never mounted at the
// same time as that destination. Closing the panel or switching tabs unmounts
// it, which saves pending text first.
export default function ScratchSidePanel({
  m = {},
  colorMode = 'dark',
  notify,
  onInsert,
  onOpenInScratch,
  width = 360,
}) {
  const [padsState, setPadsState] = useState(() => buildDefaultScratchPayload('', Date.now()));
  const [text, setText] = useState('');
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const durability = useScratchDurability();
  const [localSaveState, setSaveState] = useState('idle');
  const [readError, setReadFailed] = useState(false);
  const readFailed = readError || durability.bootFailed;
  const saveState = durability.status === 'error' ? 'error'
    : durability.status === 'saving' && localSaveState !== 'dirty' ? 'saving' : localSaveState;
  const padsRef = useRef(padsState);
  const readFailedRef = useRef(false);
  const revisionRef = useRef(0);
  const textRef = useRef('');
  const timerRef = useRef(null);
  const textareaRef = useRef(null);

  const activePad = padsState.pads.find((pad) => pad.id === padsState.activePadId) || padsState.pads[0];
  useLibraryEditBuffer('scratch-side', { padsState, text, selection });
  const orderedPads = useMemo(() => orderPads(padsState.pads), [padsState.pads]);
  const isDark = colorMode === 'dark';

  const applyState = (state) => {
    revisionRef.current = state.revision || revisionRef.current;
    padsRef.current = state;
    setPadsState(state);
  };

  const showPad = (pad, value = pad?.content || '') => {
    textRef.current = value;
    setText(value);
    setSelection({ start: 0, end: 0 });
  };

  const persist = (nextState, preferLocalIds = []) => {
    if (readFailedRef.current) return { ok: false };
    const result = persistScratchState(nextState, { lastKnownRevision: revisionRef.current, preferLocalIds });
    if (result.ok) applyState(result.state);
    return result;
  };

  const commit = (value) => {
    const current = padsRef.current;
    const activeId = current.activePadId;
    const stored = current.pads.find((pad) => pad.id === activeId);
    if (!stored) return true;
    if (stored.content === value && !['saving', 'error'].includes(getScratchDurability().status)) {
      clearUnsavedScratchDraft(activeId);
      return true;
    }
    const updatedAt = Date.now();
    setSaveState('saving');
    const result = persist({
      ...current,
      pads: current.pads.map((pad) => pad.id === activeId
        ? normalizeScratchPad({ ...pad, content: value, updatedAt, timestamp: updatedAt })
        : pad),
    }, [activeId]);
    if (result.ok && result.durable) {
      result.durable.then(() => {
        const kept = readUnsavedScratchDraft();
        if (kept && result.state.pads.some(pad => pad.id === kept.pad.id && pad.content === kept.text)) clearUnsavedScratchDraft(kept.pad.id);
      }, () => {
        if (getScratchDurability().status === 'error') keepUnsavedScratchDraft(stored, value);
      });
    } else if (result.ok) clearUnsavedScratchDraft(activeId);
    setSaveState(result.ok ? 'saved' : 'error');
    return result.ok;
  };

  const flush = () => {
    clearLibraryBufferTimeout(timerRef.current);
    return commit(textRef.current);
  };

  // Save before the panel or this tab goes away. If that fails, keep the text
  // outside the panel so reopening it brings the text back instead of the
  // older note.
  const saveOrKeep = () => {
    if (flush()) return true;
    const current = padsRef.current;
    const pad = current.pads.find((item) => item.id === current.activePadId);
    if (pad && keepUnsavedScratchDraft(pad, textRef.current)) notify?.(KEPT_UNSAVED_MESSAGE);
    return false;
  };

  const load = () => {
    if (getScratchDurability().bootFailed) return;
    const { payload, error, errorStage } = migrateScratchStorage();
    readFailedRef.current = Boolean(error && errorStage === 'read');
    setReadFailed(readFailedRef.current);
    if (readFailedRef.current) {
      setSaveState('error');
      return;
    }
    const unsaved = readUnsavedScratchDraft();
    if (unsaved) {
      // Bring back text that could not be saved when the panel last closed,
      // on its own note (restored if another tab removed it), and retry.
      const pads = payload.pads.some((pad) => pad.id === unsaved.pad.id) ? payload.pads : [...payload.pads, unsaved.pad];
      applyState({ ...payload, pads, activePadId: unsaved.pad.id });
      showPad(pads.find((pad) => pad.id === unsaved.pad.id), unsaved.text);
      commit(unsaved.text);
      return;
    }
    applyState(payload);
    showPad(payload.pads.find((pad) => pad.id === payload.activePadId) || payload.pads[0]);
    setSaveState(error ? 'error' : 'idle');
  };

  useEffect(() => {
    load();
    // Mount-only read, matching the full Scratch destination.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the latest save for unmount without re-subscribing every render.
  // Unmounting covers every close and tab switch.
  const saveOrKeepRef = useRef(saveOrKeep);
  useEffect(() => { saveOrKeepRef.current = saveOrKeep; });
  useEffect(() => () => { saveOrKeepRef.current(); }, []);

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
      // Keep this panel's note selected while it still exists, as the full
      // Scratch page does, so the text shown always belongs to the active note.
      const keepId = incoming.pads.some((pad) => pad.id === current.activePadId) ? current.activePadId : incoming.activePadId;
      const nextActive = incoming.pads.find((pad) => pad.id === keepId) || incoming.pads[0];
      if (!nextActive) return;
      applyState({ ...incoming, activePadId: nextActive.id });
      if (nextActive.content !== textRef.current) showPad(nextActive);
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
    setSaveState('dirty');
    clearLibraryBufferTimeout(timerRef.current);
    timerRef.current = setLibraryBufferTimeout(() => commit(value), AUTOSAVE_MS);
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

  const trackSelection = (event) => {
    const { selectionStart = 0, selectionEnd = 0 } = event.currentTarget;
    setSelection({ start: selectionStart, end: selectionEnd });
  };

  const status = readFailed
    ? 'Notes could not be read. Stored data has not been overwritten.'
    : saveState === 'saving' ? 'Saving…'
      : saveState === 'saved' ? 'Saved'
        : saveState === 'error' ? 'Save failed. Your text is still here; keep typing or retry.'
          : saveState === 'dirty' ? 'Unsaved changes'
          : 'Saved locally';

  return (
    <div className="pl-write-scratch">
      <div className="pl-write-side-subheader">
        <p className={`text-[10px] ${m.textMuted || ''}`}>{padsState.pads.length} note{padsState.pads.length === 1 ? '' : 's'}</p>
        <div className="flex shrink-0 items-center gap-1">
          <button type="button" className="ui-control pl-secondary-button" onClick={createPad} disabled={readFailed} aria-label="New Scratch note"><Ic n="Plus" size={12} /></button>
          <button type="button" className="ui-control pl-secondary-button" onClick={openInScratch} disabled={readFailed} aria-label="Open this note in Scratch"><Ic n="ArrowRight" size={12} /></button>
        </div>
      </div>
      <nav className="pl-write-scratch-list" aria-label="Scratch notes">
        {orderedPads.map((pad) => (
          <ScratchNoteRow key={pad.id} m={m} pad={pad} active={pad.id === activePad?.id} isDark={isDark}
            density="compact" showDate={width >= 300} onSelect={selectPad} />
        ))}
      </nav>
      <div className="pl-write-scratch-note">
        <div className="flex min-w-0 items-center justify-between gap-2">
          <p className="min-w-0 truncate text-xs font-semibold" title={activePad?.name}>{activePad?.name || 'Scratch note'}</p>
          <p role="status" data-testid="scratch-side-save-status" data-save-state={saveState} className={`shrink-0 text-[10px] ${saveState === 'error' || readFailed ? 'text-red-500' : m.textMuted || ''}`}>{status}</p>
        </div>
        {readFailed && <button type="button" className="pl-text-button self-start text-xs" onClick={async () => {
          if (durability.bootFailed) await startScratchJournal();
          load();
        }}>Retry loading notes</button>}
        {!readFailed && saveState === 'error' && <button type="button" className="pl-text-button self-start text-xs" onClick={() => commit(textRef.current)}>Retry saving</button>}
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
          data-side-autofocus
          spellCheck
          placeholder="Write a note. It saves automatically."
          className={`pl-write-scratch-editor ${m.input || ''}`}
        />
        <button type="button" className="ui-control pl-primary-button self-start" onClick={insert} disabled={readFailed || !(selectedText || text).trim()}>
          <Ic n="CopyPlus" size={12} /> {selectedText ? 'Insert selection into prompt' : 'Insert note into prompt'}
        </button>
      </div>
    </div>
  );
}
