import { setLibraryBufferTimeout, clearLibraryBufferTimeout } from './lib/libraryEditBuffers.js';
import { useLibraryEditBuffer } from './hooks/useLibraryEditBuffer.js';
import { useEffect, useMemo, useRef, useState } from 'react';
import Ic from './icons';
import { useAppLibrary } from './lib/AppLibraryContext.jsx';
import { afterScratchResult } from './lib/scratchRepositoryStore.js';
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
  const { scratch } = useAppLibrary();
  const [padsState, setPadsState] = useState(() => scratch ? scratch.initial() : buildDefaultScratchPayload('', Date.now()));
  const drafts = scratch ? { keep: scratch.keepDraft, read: scratch.readDraft, clear: scratch.clearDraft }
    : { keep: keepUnsavedScratchDraft, read: readUnsavedScratchDraft, clear: clearUnsavedScratchDraft };
  const getDurability = scratch?.getStatus || getScratchDurability;
  const pendingCommitRef = useRef(null);
  const pendingCreateRef = useRef(null);
  const [text, setText] = useState(() => (padsState.pads.find(pad => pad.id === padsState.activePadId) || padsState.pads[0])?.content || '');
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
  const textRef = useRef(text);
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
    const result = scratch
      ? scratch.persist(nextState, { previousState: padsRef.current, preferLocalIds })
      : persistScratchState(nextState, { lastKnownRevision: revisionRef.current, preferLocalIds });
    return afterScratchResult(result, saved => {
      if (saved.ok) applyState(saved.state);
      return saved;
    });
  };

  const commit = (value) => {
    const activeId = padsRef.current.activePadId;
    const write = () => {
      const current = padsRef.current;
      if (current.activePadId !== activeId) return false;
      const stored = current.pads.find((pad) => pad.id === activeId);
      if (!stored) return !value;
      if (stored.content === value && (scratch || !['saving', 'error'].includes(getDurability().status))) {
        drafts.clear(activeId, value);
        return true;
      }
      const updatedAt = Date.now();
      setSaveState('saving');
      return afterScratchResult(persist({
        ...current,
        pads: current.pads.map((pad) => pad.id === activeId
          ? normalizeScratchPad({ ...pad, content: value, updatedAt, timestamp: updatedAt })
          : pad),
      }, [activeId]), result => {
        if (result.ok && result.durable) {
          result.durable.then(() => {
            const kept = drafts.read();
            if (kept && result.state.pads.some(pad => pad.id === kept.pad.id && pad.content === kept.text)) drafts.clear(kept.pad.id, kept.text);
          }, () => { if (getDurability().status === 'error') drafts.keep(stored, value); });
        } else if (result.ok) {
          drafts.clear(activeId, value);
          if (scratch && textRef.current !== value) drafts.keep(result.state.pads.find(pad => pad.id === activeId), textRef.current);
        }
        setSaveState(result.ok ? (textRef.current === value ? 'saved' : 'dirty') : 'error');
        return result.ok;
      });
    };
    const result = pendingCommitRef.current ? pendingCommitRef.current.then(write) : write();
    if (result && typeof result.then === 'function') {
      pendingCommitRef.current = result;
      result.finally(() => { if (pendingCommitRef.current === result) pendingCommitRef.current = null; });
    }
    return result;
  };

  const flush = () => {
    clearLibraryBufferTimeout(timerRef.current);
    return commit(textRef.current);
  };

  // Save before the panel or this tab goes away. If that fails, keep the text
  // outside the panel so reopening it brings the text back instead of the
  // older note.
  const saveOrKeep = () => {
    const current = padsRef.current;
    const pad = current.pads.find((item) => item.id === current.activePadId);
    const value = textRef.current;
    // Retain immediately: a panel can reopen before an asynchronous write ends.
    if (scratch && pad && value !== pad.content) drafts.keep(pad, value);
    return afterScratchResult(flush(), ok => {
      if (ok) return true;
      if (pad && (scratch || drafts.keep(pad, value))) notify?.(KEPT_UNSAVED_MESSAGE);
      return false;
    });
  };

  const load = () => {
    if (!scratch && getDurability().bootFailed) return;
    return afterScratchResult(scratch ? scratch.load() : migrateScratchStorage(), ({ payload, error, errorStage }) => {
      readFailedRef.current = Boolean(error && errorStage === 'read');
      setReadFailed(readFailedRef.current);
      if (readFailedRef.current) { setSaveState('error'); return; }
      const unsaved = drafts.read();
      if (unsaved) {
        // A selected-library draft keeps the version it was actually based on.
        // A removed note is shown for recovery, never silently recreated.
        const pads = scratch
          ? [...payload.pads.filter(pad => pad.id !== unsaved.pad.id), unsaved.pad]
          : payload.pads.some(pad => pad.id === unsaved.pad.id) ? payload.pads : [...payload.pads, unsaved.pad];
        applyState({ ...payload, pads, activePadId: unsaved.pad.id });
        showPad(unsaved.pad, unsaved.text);
        commit(unsaved.text);
        return;
      }
      applyState(payload);
      showPad(payload.pads.find((pad) => pad.id === payload.activePadId) || payload.pads[0]);
      setSaveState(error ? 'error' : 'idle');
    });
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
    if (scratch) return;
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
    if (scratch && activePad) drafts.keep(activePad, value);
    textRef.current = value;
    setText(value);
    setSaveState('dirty');
    clearLibraryBufferTimeout(timerRef.current);
    timerRef.current = setLibraryBufferTimeout(() => commit(value), AUTOSAVE_MS);
  };

  const selectPad = (padId) => {
    if (scratch?.getStatus().status === 'saving') return;
    if (padId === padsRef.current.activePadId) return;
    const value = textRef.current;
    return afterScratchResult(flush(), ok => {
      if (!ok || value !== textRef.current) return;
      return afterScratchResult(persist({ ...padsRef.current, activePadId: padId }), result => {
        if (!result.ok) { setSaveState('error'); return; }
        showPad(result.state.pads.find((pad) => pad.id === padId));
      });
    });
  };

  const createPad = () => {
    if (scratch?.getStatus().status === 'saving') return;
    const value = textRef.current;
    return afterScratchResult(flush(), ok => {
      if (!ok || value !== textRef.current) return;
      const now = Date.now();
      const current = padsRef.current;
      const pad = pendingCreateRef.current || normalizeScratchPad({ id: buildPadId(), name: `Note ${current.pads.length + 1}`, content: '', createdAt: now, updatedAt: now });
      pendingCreateRef.current = pad;
      return afterScratchResult(persist({ ...current, pads: [...current.pads, pad], activePadId: pad.id }, [pad.id]), result => {
        if (!result.ok) { setSaveState('error'); return; }
        pendingCreateRef.current = null;
        if (textRef.current !== value) {
          // Keep the editor on its earlier note if typing continued during creation.
          applyState({ ...result.state, activePadId: current.activePadId });
          scratch?.keepDraft(result.state.pads.find(item => item.id === current.activePadId), textRef.current);
          setSaveState('dirty');
          return;
        }
        showPad(result.state.pads.find(item => item.id === pad.id));
        setTimeout(() => textareaRef.current?.focus(), 0);
      });
    });
  };

  const selectedText = selection.end > selection.start ? text.slice(selection.start, selection.end) : '';
  const insert = () => {
    const value = selectedText || text;
    if (!value.trim()) return;
    onInsert?.(value);
    notify?.(selectedText ? 'Inserted the selected note text into the prompt.' : `Inserted ${activePad?.name || 'the note'} into the prompt.`);
  };

  const openInScratch = () => {
    if (scratch?.getStatus().status === 'saving') return;
    const value = textRef.current;
    return afterScratchResult(flush(), ok => {
      if (ok && value === textRef.current) onOpenInScratch?.(padsRef.current.activePadId);
    });
  };

  const trackSelection = (event) => {
    const { selectionStart = 0, selectionEnd = 0 } = event.currentTarget;
    setSelection({ start: selectionStart, end: selectionEnd });
  };

  const status = durability.status === 'loading' ? 'Loading notes…' : readFailed
    ? 'Notes could not be read. Stored data has not been overwritten.'
    : saveState === 'saving' ? 'Saving…'
      : saveState === 'saved' ? 'Saved'
        : saveState === 'error' ? 'Save failed. Your text is still here; keep typing or retry.'
          : saveState === 'dirty' ? 'Unsaved changes'
          : scratch ? (activePad ? 'Saved to library' : 'Create a note to get started') : 'Saved locally';

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
        {readFailed && durability.status !== 'loading' && <button type="button" className="pl-text-button self-start text-xs" onClick={async () => {
          if (!scratch && durability.bootFailed) await startScratchJournal();
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
          readOnly={readFailed || !activePad}
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
