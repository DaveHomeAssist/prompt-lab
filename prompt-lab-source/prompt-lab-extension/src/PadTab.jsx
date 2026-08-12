import { useEffect, useRef, useState } from 'react';
import Ic from './icons';
import { logWarn } from './lib/logger.js';
import { matchPadShortcut } from './lib/padShortcuts.js';
import { storageKeys } from './lib/storage.js';

/* ── Multi-pad storage constants ── */
const LEGACY_PAD_KEY = storageKeys.pad;                 // "pl2-pad"
const LEGACY_PAD_META_KEY = `${storageKeys.pad}_meta`;  // "pl2-pad_meta"
const PADS_KEY = 'pl2-pads';
const PADS_SCHEMA_VERSION_KEY = 'pl2-pads-schema-version';
const PADS_SCHEMA_VERSION = '2';

const DEFAULT_PAD_ID = 'default';
const DEFAULT_PAD_NAME = 'Scratchpad';
const NEW_PAD_NAME_PREFIX = 'Pad';

/* ── Migration helpers ── */

function parseSavedTimestamp(raw) {
  if (!raw) return Date.now();
  const iso = new Date(raw).getTime();
  if (!Number.isNaN(iso)) return iso;
  return Date.now();
}

function buildDefaultPadsPayload(content = '', timestamp = Date.now()) {
  return {
    pads: [
      {
        id: DEFAULT_PAD_ID,
        name: DEFAULT_PAD_NAME,
        content,
        timestamp,
      },
    ],
    activePadId: DEFAULT_PAD_ID,
    revision: 0,
  };
}

function isValidPadsPayload(value) {
  return Boolean(
    value &&
    Array.isArray(value.pads) &&
    value.pads.length > 0 &&
    typeof value.activePadId === 'string' &&
    value.pads.every(
      (pad) =>
        pad &&
        typeof pad.id === 'string' &&
        typeof pad.name === 'string' &&
        typeof pad.content === 'string' &&
        typeof pad.timestamp === 'number'
    )
  );
}

function readPadsPayload() {
  try {
    const raw = localStorage.getItem(PADS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!isValidPadsPayload(parsed)) return null;
    // Pre-revision payloads (schema v2 before conflict detection) read as revision 0.
    return {
      ...parsed,
      revision: Number.isFinite(parsed.revision) ? parsed.revision : 0,
    };
  } catch (error) {
    logWarn('read pads payload', error);
    return null;
  }
}

function migratePadStorage() {
  try {
    const version = localStorage.getItem(PADS_SCHEMA_VERSION_KEY);

    // Already migrated and readable.
    if (version === PADS_SCHEMA_VERSION) {
      const existing = readPadsPayload();
      if (existing) {
        return { migrated: false, payload: existing, error: null };
      }
    }

    // Recover if pads payload exists but version flag was never written.
    const existingPayload = readPadsPayload();
    if (existingPayload) {
      localStorage.setItem(PADS_SCHEMA_VERSION_KEY, PADS_SCHEMA_VERSION);
      return { migrated: true, payload: existingPayload, error: null };
    }

    // Migrate from legacy single-pad keys (pl2-pad / pl2-pad_meta).
    // Also handles the pl-pad → pl2-pad hop if it was never completed.
    let legacyContent = localStorage.getItem(LEGACY_PAD_KEY) || '';
    let legacyMeta = localStorage.getItem(LEGACY_PAD_META_KEY) || '';

    // Check for pre-pl2 key ("pl-pad") in case that migration never ran.
    if (!legacyContent) {
      const prePl2 = localStorage.getItem('pl-pad');
      if (prePl2) {
        legacyContent = prePl2;
        legacyMeta = localStorage.getItem('pl-pad_meta') || '';
      }
    }

    const payload = buildDefaultPadsPayload(
      legacyContent,
      parseSavedTimestamp(legacyMeta)
    );

    // Write new schema first.
    localStorage.setItem(PADS_KEY, JSON.stringify(payload));
    localStorage.setItem(PADS_SCHEMA_VERSION_KEY, PADS_SCHEMA_VERSION);

    // Only remove legacy keys after successful write.
    localStorage.removeItem(LEGACY_PAD_KEY);
    localStorage.removeItem(LEGACY_PAD_META_KEY);
    localStorage.removeItem('pl-pad');
    localStorage.removeItem('pl-pad_meta');

    return { migrated: true, payload, error: null };
  } catch (error) {
    logWarn('pad schema migration', error);

    // Quota exceeded or write failure: do not destroy legacy data.
    const fallbackPayload = buildDefaultPadsPayload(
      localStorage.getItem(LEGACY_PAD_KEY) || '',
      parseSavedTimestamp(localStorage.getItem(LEGACY_PAD_META_KEY) || '')
    );

    return {
      migrated: false,
      payload: fallbackPayload,
      error,
    };
  }
}

/* ── Persistence helpers (write to pl2-pads) ── */

function updateActivePadContent(prev, nextContent) {
  return {
    ...prev,
    pads: prev.pads.map((pad) =>
      pad.id === prev.activePadId
        ? { ...pad, content: nextContent, timestamp: Date.now() }
        : pad
    ),
  };
}

// Another tab may have written pl2-pads since this tab last read it. Merging
// per pad (newest timestamp wins, except pads this tab just mutated) keeps a
// competing tab's edits to *other* pads from being silently overwritten.
function mergePadsPayloads(local, stored, { preferLocalIds = [], removedIds = [] } = {}) {
  const preferred = new Set(preferLocalIds);
  const removed = new Set(removedIds);
  const storedById = new Map(stored.pads.map((pad) => [pad.id, pad]));
  const pads = local.pads.map((pad) => {
    const external = storedById.get(pad.id);
    if (!external || preferred.has(pad.id)) return pad;
    return external.timestamp > pad.timestamp ? external : pad;
  });
  const localIds = new Set(local.pads.map((pad) => pad.id));
  stored.pads.forEach((pad) => {
    if (!localIds.has(pad.id) && !removed.has(pad.id)) pads.push(pad);
  });
  return { ...local, pads };
}

function persistPadsState(nextState, { lastKnownRevision = 0, preferLocalIds = [], removedIds = [] } = {}) {
  try {
    const stored = readPadsPayload();
    const candidate = stored && stored.revision !== lastKnownRevision
      ? mergePadsPayloads(nextState, stored, { preferLocalIds, removedIds })
      : nextState;
    const payload = {
      ...candidate,
      revision: Math.max(stored?.revision || 0, lastKnownRevision) + 1,
    };
    localStorage.setItem(PADS_KEY, JSON.stringify(payload));
    localStorage.setItem(PADS_SCHEMA_VERSION_KEY, PADS_SCHEMA_VERSION);
    return { ok: true, state: payload };
  } catch (e) {
    logWarn('persist pads state (quota exceeded?)', e);
    return { ok: false, state: nextState, error: e };
  }
}

function buildPadId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `pad-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/* ── Component ── */

export default function PadTab({ m, colorMode = 'dark', notify, pageScroll = false, onPromoteToLibrary }) {
  const migrationCheckedRef = useRef(false);
  const textareaRef = useRef(null);

  const [padsState, setPadsState] = useState(() => {
    const payload = readPadsPayload();
    return payload || buildDefaultPadsPayload('', Date.now());
  });
  const revisionRef = useRef(padsState.revision || 0);

  const activePad =
    padsState.pads.find((pad) => pad.id === padsState.activePadId) ||
    padsState.pads[0];

  const [text, setText] = useState(activePad?.content || '');
  const [saveState, setSaveState] = useState('idle');
  const [saveError, setSaveError] = useState('');
  const [padNameDialog, setPadNameDialog] = useState(null);
  const [lastSavedAt, setLastSavedAt] = useState(() => {
    if (!activePad?.timestamp) return '';
    return new Date(activePad.timestamp).toISOString();
  });
  const [relativeSavedAt, setRelativeSavedAt] = useState('');
  const timerRef = useRef(null);
  const savedStateTimerRef = useRef(null);
  const wc = text.trim() ? text.trim().split(/\s+/).length : 0;
  const shellMinHeightClass = pageScroll ? 'min-h-[calc(100vh-9rem)]' : 'min-h-[calc(100vh-7rem)]';
  const editorPaneMinHeightClass = pageScroll ? 'min-h-[calc(100vh-13rem)]' : 'min-h-[calc(100vh-11rem)]';
  const textareaMinHeightClass = pageScroll ? 'min-h-[calc(100vh-16rem)]' : 'min-h-[calc(100vh-14rem)]';
  const isDark = colorMode === 'dark';
  const copyBtnClass = isDark
    ? 'border border-violet-400/30 bg-violet-500/15 text-violet-200 hover:border-violet-300 hover:bg-violet-500/25'
    : 'border border-violet-300 bg-violet-50 text-violet-700 hover:border-violet-400 hover:bg-violet-100';
  const activePadTitleClass = isDark ? 'text-violet-200' : 'text-violet-800';

  const formatRelativeTime = (value) => {
    if (!value) return '';
    const diffMs = Date.now() - new Date(value).getTime();
    if (Number.isNaN(diffMs) || diffMs < 0) return 'just now';
    const seconds = Math.floor(diffMs / 1000);
    if (seconds < 10) return 'just now';
    if (seconds < 60) return `${seconds} sec ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hr ago`;
    const days = Math.floor(hours / 24);
    return `${days} day${days === 1 ? '' : 's'} ago`;
  };

  const focusTextarea = () => {
    setTimeout(() => textareaRef.current?.focus(), 0);
  };

  const loadPadView = (pad) => {
    setText(pad?.content || '');
    setSaveState('idle');
    setSaveError('');
    const savedAt = pad?.timestamp ? new Date(pad.timestamp).toISOString() : '';
    setLastSavedAt(savedAt);
    setRelativeSavedAt(savedAt ? formatRelativeTime(savedAt) : '');
    focusTextarea();
  };

  // Run migration once on mount.
  useEffect(() => {
    if (migrationCheckedRef.current) return;
    migrationCheckedRef.current = true;

    const { payload, error, migrated } = migratePadStorage();
    revisionRef.current = payload.revision || 0;
    setPadsState(payload);
    const active = payload.pads.find((pad) => pad.id === payload.activePadId) || payload.pads[0];
    setText(active?.content || '');
    if (active?.timestamp) {
      setLastSavedAt(new Date(active.timestamp).toISOString());
    }

    if (error) {
      notify?.('Pad storage migration failed; using fallback data');
      return;
    }

    if (migrated) {
      notify?.('Scratchpad migrated to multi-pad storage');
    }
  }, [notify]);

  const scheduleIdleStatus = () => {
    clearTimeout(savedStateTimerRef.current);
    savedStateTimerRef.current = setTimeout(() => setSaveState('idle'), 2000);
  };

  const persistPads = (nextState, opts = {}) => {
    const result = persistPadsState(nextState, {
      lastKnownRevision: revisionRef.current,
      ...opts,
    });
    if (result.ok) revisionRef.current = result.state.revision;
    return result;
  };

  const reportSaveFailure = () => {
    setSaveState('idle');
    setSaveError('Save failed — storage may be full. Copy your notes before leaving.');
  };

  const commitSave = (value) => {
    const nextState = updateActivePadContent(padsState, value);
    const result = persistPads(nextState, { preferLocalIds: [padsState.activePadId] });
    if (!result.ok) {
      // The text buffer stays dirty relative to padsState so later saves retry.
      reportSaveFailure();
      return false;
    }
    setPadsState(result.state);
    const savedAt = new Date().toISOString();
    setLastSavedAt(savedAt);
    setRelativeSavedAt(formatRelativeTime(savedAt));
    setSaveError('');
    setSaveState('saved');
    scheduleIdleStatus();
    return true;
  };

  const flushActivePad = ({ silent = false } = {}) => {
    clearTimeout(timerRef.current);
    if (!activePad || text === activePad.content) {
      return { state: padsState, ok: true };
    }

    const nextState = updateActivePadContent(padsState, text);
    const result = persistPads(nextState, { preferLocalIds: [padsState.activePadId] });
    if (!result.ok) {
      reportSaveFailure();
      return { state: padsState, ok: false };
    }
    setPadsState(result.state);

    const savedAt = new Date(
      result.state.pads.find((pad) => pad.id === result.state.activePadId)?.timestamp || Date.now()
    ).toISOString();
    setLastSavedAt(savedAt);
    setRelativeSavedAt(formatRelativeTime(savedAt));
    setSaveError('');

    if (silent) {
      setSaveState('idle');
      return { state: result.state, ok: true };
    }

    setSaveState('saved');
    scheduleIdleStatus();
    return { state: result.state, ok: true };
  };

  // Keep a stable ref to the latest flushActivePad for event listeners.
  const flushRef = useRef(flushActivePad);
  useEffect(() => { flushRef.current = flushActivePad; });
  const textStateRef = useRef(text);
  useEffect(() => { textStateRef.current = text; });
  const padsStateRef = useRef(padsState);
  useEffect(() => { padsStateRef.current = padsState; });

  // Adopt writes from other tabs so competing edits merge instead of silently
  // overwriting each other (storage events only fire in non-writing tabs).
  useEffect(() => {
    const onStorage = (event) => {
      if (event.key !== PADS_KEY || !event.newValue) return;
      let parsed;
      try {
        parsed = JSON.parse(event.newValue);
      } catch {
        return;
      }
      if (!isValidPadsPayload(parsed)) return;

      const incoming = {
        ...parsed,
        revision: Number.isFinite(parsed.revision) ? parsed.revision : 0,
      };
      revisionRef.current = incoming.revision;

      const prev = padsStateRef.current;
      const prevActive = prev.pads.find((pad) => pad.id === prev.activePadId);
      const activeId = incoming.pads.some((pad) => pad.id === prev.activePadId)
        ? prev.activePadId
        : incoming.activePadId;
      const incomingActive = incoming.pads.find((pad) => pad.id === activeId) || incoming.pads[0];
      const localText = textStateRef.current;
      const hasPendingEdits = prevActive ? localText !== prevActive.content : Boolean(localText);

      setPadsState({ ...incoming, activePadId: activeId });

      if (activeId !== prev.activePadId) {
        // The pad open here was deleted in another tab; show its replacement.
        loadPadView(incomingActive);
        notify?.('This pad was removed in another tab.');
        return;
      }
      if (!hasPendingEdits) {
        if (incomingActive && incomingActive.content !== localText) {
          setText(incomingActive.content);
          const savedAt = incomingActive.timestamp ? new Date(incomingActive.timestamp).toISOString() : '';
          setLastSavedAt(savedAt);
          setRelativeSavedAt(savedAt ? formatRelativeTime(savedAt) : '');
        }
      } else if (incomingActive && prevActive && incomingActive.content !== prevActive.content) {
        notify?.('This pad changed in another tab — your unsaved edits here will replace that change when saved.');
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notify]);

  const buildFilename = () => {
    const now = new Date();
    const yyyy = String(now.getFullYear());
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const min = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    return `pad-${yyyy}-${mm}-${dd}-${hh}${min}${ss}.txt`;
  };

  const onChange = e => {
    const v = e.target.value;
    setText(v);
    setSaveError('');
    setSaveState('pending');
    clearTimeout(timerRef.current);
    clearTimeout(savedStateTimerRef.current);
    timerRef.current = setTimeout(() => {
      commitSave(v);
    }, 600);
  };

  const insertDate = () => {
    const d = new Date().toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
    const entry = `\n── ${d} ──\n`;
    const ta = textareaRef.current;
    if (!ta) return;
    const pos = ta.selectionStart;
    const next = text.slice(0, pos) + entry + text.slice(ta.selectionEnd);
    setText(next);
    setTimeout(() => { ta.selectionStart = ta.selectionEnd = pos + entry.length; ta.focus(); }, 0);
    try {
      clearTimeout(timerRef.current);
      commitSave(next);
    } catch (e) { logWarn('pad insert date', e); }
    notify('Date separator inserted');
  };

  const insertAtCursor = (prefix, suffix = '') => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const selected = text.slice(start, end);
    const insert = prefix + selected + suffix;
    const next = text.slice(0, start) + insert + text.slice(end);
    setText(next);
    const cursorPos = selected ? start + insert.length : start + prefix.length;
    setTimeout(() => { ta.selectionStart = ta.selectionEnd = cursorPos; ta.focus(); }, 0);
    try { clearTimeout(timerRef.current); commitSave(next); } catch (e) { logWarn('pad format', e); }
  };

  const insertHeading = () => insertAtCursor('\n## ', '\n');
  const insertBullet = () => insertAtCursor('\n- ');
  const insertNumbered = () => insertAtCursor('\n1. ');
  const insertCodeBlock = () => insertAtCursor('\n```\n', '\n```\n');
  const insertQuote = () => insertAtCursor('\n> ');

  const handleCopy = () => {
    if (!text.trim()) return;
    try { navigator.clipboard.writeText(text); }
    catch {
      const el = document.createElement('textarea'); el.value = text;
      el.style.cssText = 'position:fixed;top:-9999px;opacity:0';
      document.body.appendChild(el); el.focus(); el.select();
      document.execCommand('copy'); document.body.removeChild(el);
    }
    notify('Pad copied!');
  };

  const exportPad = () => {
    if (!text.trim()) return;
    const filename = buildFilename();
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.msSaveOrOpenBlob === 'function') {
        navigator.msSaveOrOpenBlob(blob, filename);
        notify('Pad downloaded!');
        return;
      }
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      setTimeout(() => URL.revokeObjectURL(url), 0);
      notify('Pad downloaded!');
    } catch (e) {
      logWarn('pad download', e);
      notify('Download unavailable');
    }
  };

  const handleSelectPad = (padId) => {
    if (padId === padsState.activePadId) return;
    const flushed = flushActivePad({ silent: true });
    if (!flushed.ok) {
      notify('Could not save this pad — free up storage before switching pads.');
      return;
    }
    const nextState = { ...flushed.state, activePadId: padId };
    const result = persistPads(nextState);
    setPadsState(result.state);
    const nextPad = result.state.pads.find((pad) => pad.id === padId) || result.state.pads[0];
    loadPadView(nextPad);
  };

  // window.prompt() is unavailable in embedded browsers (Tauri, side panel)
  // and crashed the whole app — naming goes through a controlled dialog instead.
  const handleCreatePad = () => {
    setPadNameDialog({
      mode: 'create',
      value: `${NEW_PAD_NAME_PREFIX} ${padsState.pads.length + 1}`,
    });
  };

  const handleRenamePad = () => {
    if (!activePad) return;
    setPadNameDialog({ mode: 'rename', value: activePad.name });
  };

  const submitPadNameDialog = () => {
    if (!padNameDialog) return;
    if (padNameDialog.mode === 'create') {
      const suggestedName = `${NEW_PAD_NAME_PREFIX} ${padsState.pads.length + 1}`;
      const name = padNameDialog.value.trim() || suggestedName;
      const flushed = flushActivePad({ silent: true });
      if (!flushed.ok) {
        notify('Could not save the current pad — free up storage before creating a new one.');
        return;
      }
      const newPad = {
        id: buildPadId(),
        name,
        content: '',
        timestamp: 0,
      };
      const nextState = {
        pads: [...flushed.state.pads, newPad],
        activePadId: newPad.id,
      };
      const result = persistPads(nextState, { preferLocalIds: [newPad.id] });
      if (!result.ok) {
        notify('Could not create pad — storage may be full.');
        return;
      }
      setPadsState(result.state);
      loadPadView(newPad);
      notify(`Created pad: ${name}`);
    } else {
      const name = padNameDialog.value.trim();
      if (!activePad || !name || name === activePad.name) {
        setPadNameDialog(null);
        return;
      }
      const nextState = {
        ...padsState,
        pads: padsState.pads.map((pad) =>
          pad.id === activePad.id ? { ...pad, name } : pad
        ),
      };
      const result = persistPads(nextState, { preferLocalIds: [activePad.id] });
      if (!result.ok) {
        notify('Could not rename pad — storage may be full.');
        return;
      }
      setPadsState(result.state);
      notify(`Renamed pad: ${name}`);
    }
    setPadNameDialog(null);
  };

  const handleDeletePad = () => {
    if (!activePad || padsState.pads.length <= 1) return;
    if (!window.confirm(`Delete pad "${activePad.name}"?`)) return;

    const currentIndex = padsState.pads.findIndex((pad) => pad.id === activePad.id);
    const remainingPads = padsState.pads.filter((pad) => pad.id !== activePad.id);
    const fallbackPad = remainingPads[Math.max(0, currentIndex - 1)] || remainingPads[0];
    const nextState = {
      pads: remainingPads,
      activePadId: fallbackPad.id,
    };
    const result = persistPads(nextState, { removedIds: [activePad.id] });
    if (!result.ok) {
      notify('Could not delete pad — storage may be full.');
      return;
    }
    setPadsState(result.state);
    loadPadView(fallbackPad);
    notify(`Deleted pad: ${activePad.name}`);
  };

  const handleClear = () => {
    if (!window.confirm('Clear all notes?')) return;
    const cleared = updateActivePadContent(padsState, '');
    const result = persistPads(cleared, { preferLocalIds: [padsState.activePadId] });
    if (!result.ok) {
      notify('Could not clear pad — storage may be full.');
      return;
    }
    setText('');
    setSaveState('idle');
    setSaveError('');
    setLastSavedAt('');
    setRelativeSavedAt('');
    clearTimeout(timerRef.current);
    clearTimeout(savedStateTimerRef.current);
    setPadsState(result.state);
    notify('Pad cleared');
  };

  useEffect(() => {
    if (!lastSavedAt) {
      setRelativeSavedAt('');
      return undefined;
    }
    const update = () => setRelativeSavedAt(formatRelativeTime(lastSavedAt));
    update();
    const intervalId = setInterval(update, 30000);
    return () => clearInterval(intervalId);
  }, [lastSavedAt]);

  // Fix 3: Flush pending content on unmount before clearing timers.
  useEffect(() => () => {
    flushRef.current({ silent: true });
    clearTimeout(timerRef.current);
    clearTimeout(savedStateTimerRef.current);
  }, []);

  // Fix 2: Flush pending content on tab/browser close or visibility change.
  useEffect(() => {
    const onBeforeUnload = () => { flushRef.current({ silent: true }); };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        flushRef.current({ silent: true });
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (e) => {
      const shortcut = matchPadShortcut(e);
      if (!shortcut) return;

      e.preventDefault();

      switch (shortcut.id) {
        case 'export':
          exportPad();
          return;
        case 'insertDate':
          insertDate();
          return;
        case 'copyAll':
          handleCopy();
          return;
        case 'clear':
          handleClear();
          return;
        default:
          return;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [exportPad, handleClear, handleCopy, insertDate]);

  return (
    <div className={`${shellMinHeightClass} flex ${pageScroll ? '' : 'flex-1 overflow-hidden'}`}>
      {/* ── Sidebar: pad list ── */}
      <div className={`w-[220px] shrink-0 flex flex-col border-r ${m.border} ${pageScroll ? '' : 'overflow-hidden'}`}>
        <div className={`flex items-center justify-between px-3 py-2 border-b ${m.border} shrink-0`}>
          <span className={`text-xs font-semibold ${m.text}`}>Scratchpads</span>
          <button
            type="button"
            onClick={handleCreatePad}
            className={`flex items-center gap-1 text-xs ${m.btn} ${m.textAlt} px-2 py-1 rounded-lg transition-colors`}
            title="New pad"
          >
            <Ic n="Plus" size={11} />
          </button>
        </div>
        <div className={`flex-1 ${pageScroll ? '' : 'overflow-y-auto'} py-1`}>
          {padsState.pads.map((pad) => {
            const isActive = pad.id === padsState.activePadId;
            const preview = pad.content ? pad.content.slice(0, 60).replace(/\n/g, ' ') : '';
            const timeStr = pad.timestamp ? formatRelativeTime(new Date(pad.timestamp).toISOString()) : '';
            return (
              <button
                key={pad.id}
                type="button"
                onClick={() => handleSelectPad(pad.id)}
                className={`w-full text-left px-3 py-2.5 border-r-2 transition-colors ${
                  isActive
                    ? 'bg-violet-600/15 border-violet-500'
                    : `${m.btn} border-transparent`
                }`}
              >
                <div className={`text-xs font-medium truncate ${isActive ? activePadTitleClass : m.text}`}>{pad.name}</div>
                {preview && <div className={`text-[10px] truncate mt-0.5 ${m.textMuted}`}>{preview}</div>}
                {timeStr && <div className={`text-[10px] mt-0.5 ${m.textMuted}`}>{timeStr}</div>}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Editor pane ── */}
      <div className={`flex-1 flex flex-col min-w-0 ${pageScroll ? '' : 'overflow-hidden'}`}>
        <div className={`flex flex-wrap items-center justify-between gap-2 px-4 py-2 border-b ${m.border} shrink-0`}>
          <div className="flex items-center gap-3">
            <span className={`text-sm font-semibold ${m.text}`}>{activePad?.name || 'Scratchpad'}</span>
            <span className={`text-xs font-mono ${m.textMuted}`}>{wc} word{wc !== 1 ? 's' : ''} · {text.length} chars</span>
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <button type="button" onClick={handleRenamePad} className={`flex items-center gap-1 text-xs ${m.btn} ${m.textAlt} px-2 py-1 rounded-lg transition-colors`} title="Rename pad">Rename</button>
            {onPromoteToLibrary && (
              <button
                type="button"
                onClick={() => { if (text.trim()) onPromoteToLibrary(activePad?.name || 'Untitled', text); }}
                disabled={!text.trim()}
                className={`flex items-center gap-1 text-xs px-2 py-1 rounded-lg transition-colors ${
                  text.trim() ? 'text-violet-400 hover:bg-violet-600/20' : `${m.textMuted} opacity-40 cursor-not-allowed`
                }`}
                title="Save pad content to Prompt Library"
              >
                <Ic n="BookmarkPlus" size={11} />Library
              </button>
            )}
            <button type="button" onClick={insertDate} className={`flex items-center gap-1 text-xs ${m.btn} ${m.textAlt} px-2 py-1 rounded-lg transition-colors min-w-[2rem]`} title="Insert date separator">📅</button>
            <button
              type="button"
              onClick={exportPad}
              disabled={!text.trim()}
              title="Download as text file"
              className={`flex items-center gap-1 text-xs px-2 py-1 rounded-lg transition-colors ${
                text.trim() ? `${m.btn} ${m.textAlt}` : `${m.btn} ${m.textMuted} opacity-40 cursor-not-allowed`
              }`}
            >
              <Ic n="Download" size={11} />
            </button>
            <button type="button" onClick={handleCopy} className={`flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg font-semibold transition-colors ${copyBtnClass}`}><Ic n="Copy" size={11} />Copy</button>
            <button type="button" onClick={handleClear} className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg transition-colors text-red-400 hover:bg-red-950/30"><Ic n="Trash2" size={11} />Clear</button>
            <button
              type="button"
              onClick={handleDeletePad}
              disabled={padsState.pads.length <= 1}
              className={`flex items-center gap-1 text-xs px-2 py-1 rounded-lg transition-colors ${
                padsState.pads.length > 1
                  ? 'text-red-400 hover:bg-red-950/30'
                  : `${m.textMuted} opacity-40 cursor-not-allowed`
              }`}
              title={padsState.pads.length > 1 ? 'Delete pad' : 'At least one pad required'}
            >
              <Ic n="Trash2" size={11} />
            </button>
          </div>
        </div>
        {/* Formatting toolbar */}
        <div className={`flex items-center gap-1 px-4 py-1.5 border-b ${m.border} shrink-0`}>
          <span className={`text-[10px] uppercase tracking-wider font-semibold ${m.textMuted} mr-2`}>Format</span>
          <button type="button" onClick={insertHeading} title="Heading (##)" className={`text-xs px-2 py-1 rounded ${m.btn} ${m.textAlt} transition-colors font-bold`}>H</button>
          <button type="button" onClick={insertBullet} title="Bullet list" className={`text-xs px-2 py-1 rounded ${m.btn} ${m.textAlt} transition-colors`}><Ic n="List" size={12} /></button>
          <button type="button" onClick={insertNumbered} title="Numbered list" className={`text-xs px-2 py-1 rounded ${m.btn} ${m.textAlt} transition-colors font-mono`}>1.</button>
          <button type="button" onClick={insertCodeBlock} title="Code block" className={`text-xs px-2 py-1 rounded ${m.btn} ${m.textAlt} transition-colors font-mono`}>{'{}'}</button>
          <button type="button" onClick={insertQuote} title="Blockquote" className={`text-xs px-2 py-1 rounded ${m.btn} ${m.textAlt} transition-colors`}><Ic n="Quote" size={12} /></button>
        </div>
        <div className={`flex-1 p-4 flex flex-col gap-2 ${editorPaneMinHeightClass} ${pageScroll ? '' : 'overflow-hidden'}`}>
          <textarea
            id="plPadArea"
            ref={textareaRef}
            className={`flex-1 w-full ${textareaMinHeightClass} resize-none rounded-xl border ${m.input} p-4 text-sm leading-relaxed focus:outline-none focus:border-violet-500 transition-colors ${m.text}`}
            aria-label="Scratchpad"
            placeholder={'Notes, ideas, prompt snippets…\n\nUse 📅 Date to timestamp entries.'}
            value={text} onChange={onChange} spellCheck />
          <div className="flex items-center justify-start min-h-5">
            {saveError ? (
              <div className="flex items-center gap-1.5 text-xs font-mono text-red-400 transition-colors">
                <Ic n="X" size={11} />
                <span>{saveError}</span>
              </div>
            ) : saveState === 'pending' ? (
              <div className={`flex items-center gap-1.5 text-xs font-mono text-gray-500 transition-colors ${m.textMuted}`}>
                <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                <span>Saving...</span>
              </div>
            ) : saveState === 'saved' ? (
              <div className="flex items-center gap-1.5 text-xs font-mono text-green-500 transition-opacity duration-200">
                <Ic n="Check" size={11} />
                <span>Saved</span>
              </div>
            ) : lastSavedAt ? (
              <div className={`flex items-center gap-1.5 text-xs font-mono text-gray-500 transition-colors ${m.textMuted}`}>
                <Ic n="Clock" size={11} />
                <span>Last saved {relativeSavedAt}</span>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* ── Pad naming dialog (replaces window.prompt, which embedded browsers lack) ── */}
      {padNameDialog && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
          onClick={() => setPadNameDialog(null)}
        >
          <div
            className={`w-full max-w-sm rounded-2xl border p-4 shadow-2xl ${m.modal || m.surface || ''} ${m.border} ${m.text}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="pad-name-dialog-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="pad-name-dialog-title" className={`text-sm font-semibold ${m.text}`}>
              {padNameDialog.mode === 'create' ? 'Name the new pad' : 'Rename pad'}
            </h2>
            <input
              autoFocus
              value={padNameDialog.value}
              onChange={(event) => {
                const value = event.target.value;
                setPadNameDialog((prev) => (prev ? { ...prev, value } : prev));
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  submitPadNameDialog();
                } else if (event.key === 'Escape') {
                  event.preventDefault();
                  setPadNameDialog(null);
                }
              }}
              className={`mt-3 w-full rounded-lg border px-3 py-2 text-sm ${m.input} ${m.text} focus:outline-none focus:border-violet-500`}
              aria-label="Pad name"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPadNameDialog(null)}
                className={`text-xs px-3 py-2 rounded-lg transition-colors ${m.btn} ${m.textAlt}`}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitPadNameDialog}
                className="text-xs px-3 py-2 rounded-lg font-semibold bg-violet-600 text-white transition-colors hover:bg-violet-500"
              >
                {padNameDialog.mode === 'create' ? 'Create' : 'Rename'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
