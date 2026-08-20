import { useEffect, useMemo, useRef, useState } from 'react';
import Ic from './icons';
import MarkdownPreview from './MarkdownPreview.jsx';
import useDialogA11y, { handleTabArrowKeys } from './hooks/useDialogA11y.js';
import { logWarn } from './lib/logger.js';
import { matchPadShortcut } from './lib/padShortcuts.js';
import {
  SCRATCH_KEY,
  buildDefaultScratchPayload,
  mergeScratchPayloads,
  migrateScratchStorage,
  normalizeScratchPad,
  normalizeScratchPayload,
  persistScratchState,
  readScratchPayload,
} from './lib/scratchSchema.js';

const COMPACT_BREAKPOINT = 560;
const COLOR_SWATCHES = {
  orange: '#c2410c',
  violet: '#8b5cf6',
  blue: '#3b82f6',
  green: '#22c55e',
  amber: '#f59e0b',
  rose: '#f43f5e',
  slate: '#64748b',
};

function buildPadId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `pad-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatRelativeTime(value) {
  if (!value) return '';
  const timestamp = typeof value === 'number' ? value : new Date(value).getTime();
  const diffMs = Date.now() - timestamp;
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
}

function formatDateTime(timestamp) {
  if (!timestamp) return 'Not saved yet';
  return new Date(timestamp).toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

function parseTags(value) {
  const values = Array.isArray(value) ? value : String(value || '').split(',');
  return [...new Set(values.map((tag) => String(tag).trim().replace(/^#/, '')).filter(Boolean))];
}

function buildFilename(name) {
  const date = new Date();
  const stamp = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
  const safeName = String(name || 'scratch-note').trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'scratch-note';
  return `${safeName}-${stamp}.md`;
}

function getSelection(textarea, text) {
  const start = textarea?.selectionStart || 0;
  const end = textarea?.selectionEnd || 0;
  return { start, end, text: text.slice(start, end) };
}

function DialogFrame({ m, titleId, title, description, onClose, initialFocusRef, children }) {
  const dialogRef = useDialogA11y({ onClose, initialFocusRef });
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-4" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? `${titleId}-description` : undefined}
        tabIndex={-1}
        className={`w-full max-w-md rounded-2xl border p-5 shadow-2xl ${m.modal || m.surface || ''} ${m.border || ''} ${m.text || ''}`}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id={titleId} className="text-base font-semibold">{title}</h2>
            {description && <p id={`${titleId}-description`} className={`mt-1 text-xs leading-relaxed ${m.textMuted || ''}`}>{description}</p>}
          </div>
          <button type="button" className={`ui-control rounded-lg p-2 ${m.btn || ''}`} onClick={onClose} aria-label={`Close ${title}`}><Ic n="X" size={14} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function NameDialog({ m, dialog, setDialog, onSubmit }) {
  const inputRef = useRef(null);
  return (
    <DialogFrame m={m} titleId="scratch-name-dialog-title" title={dialog.mode === 'create' ? 'Create a scratch note' : 'Rename scratch note'} description="Names are searchable and stay with the note across Prompt Lab surfaces." onClose={() => setDialog(null)} initialFocusRef={inputRef}>
      <form className="mt-4" onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
        <label className="block text-xs font-semibold" htmlFor="scratch-note-name">Note name</label>
        <input ref={inputRef} id="scratch-note-name" value={dialog.value} onChange={(event) => setDialog((current) => current ? { ...current, value: event.target.value } : current)} className={`mt-2 min-h-11 w-full rounded-lg border px-3 py-2 text-sm ${m.input || ''}`} />
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={() => setDialog(null)} className={`ui-control rounded-lg px-3 py-2 text-sm ${m.btn || ''}`}>Cancel</button>
          <button type="submit" className="ui-control pl-primary-button rounded-lg px-3 py-2 text-sm font-semibold">{dialog.mode === 'create' ? 'Create' : 'Rename'}</button>
        </div>
      </form>
    </DialogFrame>
  );
}

function ConfirmDialog({ m, dialog, onClose, onConfirm }) {
  const confirmRef = useRef(null);
  return (
    <DialogFrame m={m} titleId="scratch-confirm-dialog-title" title={dialog.title} description={dialog.description} onClose={onClose} initialFocusRef={confirmRef}>
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={onClose} className={`ui-control rounded-lg px-3 py-2 text-sm ${m.btn || ''}`}>Cancel</button>
        <button ref={confirmRef} type="button" onClick={onConfirm} className="ui-control rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-500">{dialog.confirmLabel}</button>
      </div>
    </DialogFrame>
  );
}

function PromotionDialog({ m, draft, setDraft, selectionAvailable, collections, busy, error, onClose, onSubmit }) {
  const titleRef = useRef(null);
  const collectionOptions = collections.map((collection) => typeof collection === 'string'
    ? { id: collection, name: collection }
    : { id: collection.id || collection.name, name: collection.name || collection.title || collection.id });
  return (
    <DialogFrame m={m} titleId="scratch-promotion-dialog-title" title="Promote to Prompt Library" description="The source note stays intact. Saving creates a two-way source link when the Library returns the new prompt ID." onClose={onClose} initialFocusRef={titleRef}>
      <form className="mt-4 space-y-4" onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
        <label className="block text-xs font-semibold" htmlFor="scratch-promotion-title">Prompt title
          <input ref={titleRef} id="scratch-promotion-title" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} className={`mt-1 min-h-11 w-full rounded-lg border px-3 py-2 text-sm ${m.input || ''}`} />
        </label>
        <fieldset>
          <legend className="text-xs font-semibold">Content</legend>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <label className={`rounded-lg border p-2 text-xs ${m.border || ''}`}><input type="radio" name="promotion-scope" value="whole" checked={draft.scope === 'whole'} onChange={() => setDraft({ ...draft, scope: 'whole', preview: draft.wholeText })} /> <span className="ml-1">Whole note</span></label>
            <label className={`rounded-lg border p-2 text-xs ${m.border || ''} ${selectionAvailable ? '' : 'opacity-50'}`}><input type="radio" name="promotion-scope" value="selection" disabled={!selectionAvailable} checked={draft.scope === 'selection'} onChange={() => setDraft({ ...draft, scope: 'selection', preview: draft.selectionText })} /> <span className="ml-1">Selection</span></label>
          </div>
        </fieldset>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="text-xs font-semibold" htmlFor="scratch-promotion-kind">Save as
            <select id="scratch-promotion-kind" value={draft.kind} onChange={(event) => setDraft({ ...draft, kind: event.target.value })} className={`mt-1 min-h-11 w-full rounded-lg border px-2 ${m.input || ''}`}><option value="working-prompt">Working prompt</option><option value="template">Template</option></select>
          </label>
          <label className="text-xs font-semibold" htmlFor="scratch-promotion-collection">Collection
            {collectionOptions.length > 0 ? <select id="scratch-promotion-collection" value={draft.collection} onChange={(event) => setDraft({ ...draft, collection: event.target.value })} className={`mt-1 min-h-11 w-full rounded-lg border px-2 ${m.input || ''}`}><option value="">No collection</option>{collectionOptions.map((collection) => <option key={collection.id} value={collection.id}>{collection.name}</option>)}</select>
              : <input id="scratch-promotion-collection" value={draft.collection} onChange={(event) => setDraft({ ...draft, collection: event.target.value })} placeholder="Optional collection" className={`mt-1 min-h-11 w-full rounded-lg border px-3 ${m.input || ''}`} />}
          </label>
        </div>
        <label className="block text-xs font-semibold" htmlFor="scratch-promotion-tags">Tags
          <input id="scratch-promotion-tags" value={draft.tagsText} onChange={(event) => setDraft({ ...draft, tagsText: event.target.value })} placeholder="research, reusable" className={`mt-1 min-h-11 w-full rounded-lg border px-3 ${m.input || ''}`} />
        </label>
        <div className={`max-h-28 overflow-auto whitespace-pre-wrap rounded-lg border p-3 text-xs leading-relaxed ${m.border || ''}`} aria-label="Promotion content preview">{draft.preview}</div>
        {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" disabled={busy} onClick={onClose} className={`ui-control rounded-lg px-3 py-2 text-sm ${m.btn || ''}`}>Cancel</button>
          <button type="submit" disabled={busy || !draft.preview.trim() || !draft.title.trim()} className="ui-control pl-primary-button rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-50">{busy ? 'Preparing…' : 'Continue to save'}</button>
        </div>
      </form>
    </DialogFrame>
  );
}

export default function ScratchWorkspace({
  m,
  colorMode = 'dark',
  notify,
  pageScroll = false,
  onPromoteToLibrary,
  library = [],
  collections = [],
  onOpenLibraryEntry,
  openNoteId = '',
  onSendToEditor,
  onSendToComposer,
  onSendToABTest,
}) {
  const initialPayload = readScratchPayload() || buildDefaultScratchPayload('', Date.now());
  const [padsState, setPadsState] = useState(initialPayload);
  const initialPad = initialPayload.pads.find((pad) => pad.id === initialPayload.activePadId) || initialPayload.pads[0];
  const [text, setText] = useState(initialPad?.content || '');
  const [search, setSearch] = useState('');
  const [editorView, setEditorView] = useState('write');
  const [selection, setSelection] = useState({ start: 0, end: 0, text: '' });
  const [sendScope, setSendScope] = useState('whole');
  const [tagDraft, setTagDraft] = useState('');
  const [saveState, setSaveState] = useState('idle');
  const [saveError, setSaveError] = useState('');
  const [lastSavedAt, setLastSavedAt] = useState(initialPad?.updatedAt || 0);
  const [relativeSavedAt, setRelativeSavedAt] = useState('');
  const [nameDialog, setNameDialog] = useState(null);
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [promotionDraft, setPromotionDraft] = useState(null);
  const [promotionBusy, setPromotionBusy] = useState(false);
  const [promotionError, setPromotionError] = useState('');
  const [isCompact, setIsCompact] = useState(() => typeof window !== 'undefined' && window.innerWidth <= COMPACT_BREAKPOINT);
  const [compactPane, setCompactPane] = useState('index');

  const textareaRef = useRef(null);
  const timerRef = useRef(null);
  const savedStateTimerRef = useRef(null);
  const migrationCheckedRef = useRef(false);
  const revisionRef = useRef(initialPayload.revision || 0);
  const padsStateRef = useRef(initialPayload);
  const textRef = useRef(text);
  const lastOpenNoteIdRef = useRef('');

  const activePad = padsState.pads.find((pad) => pad.id === padsState.activePadId) || padsState.pads[0];
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const readingMinutes = words === 0 ? 0 : Math.max(1, Math.ceil(words / 225));
  const hasSelection = selection.end > selection.start && Boolean(selection.text.trim());
  const isDark = colorMode === 'dark';
  const shellMinHeightClass = pageScroll ? 'min-h-[calc(100vh-9rem)]' : 'min-h-[calc(100vh-7rem)]';
  const editorMinHeightClass = pageScroll ? 'min-h-[calc(100vh-18rem)]' : 'min-h-[calc(100vh-16rem)]';

  const outline = useMemo(() => {
    let offset = 0;
    return text.split('\n').flatMap((line, index) => {
      const match = line.match(/^(#{1,6})\s+(.+)/);
      const items = match ? [{ level: match[1].length, label: match[2], line: index, offset }] : [];
      offset += line.length + 1;
      return items;
    });
  }, [text]);

  const visiblePads = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const filtered = needle ? padsState.pads.filter((pad) => [pad.name, pad.content, ...(pad.tags || [])].join(' ').toLowerCase().includes(needle)) : padsState.pads;
    const sorter = (left, right) => right.updatedAt - left.updatedAt || left.name.localeCompare(right.name);
    return { pinned: filtered.filter((pad) => pad.pinned).sort(sorter), recent: filtered.filter((pad) => !pad.pinned).sort(sorter) };
  }, [padsState.pads, search]);

  const applyState = (state) => {
    revisionRef.current = state.revision || revisionRef.current;
    padsStateRef.current = state;
    setPadsState(state);
  };

  const persistPads = (nextState, options = {}) => {
    const result = persistScratchState(nextState, { lastKnownRevision: revisionRef.current, ...options });
    if (result.ok) applyState(result.state);
    return result;
  };

  const scheduleIdleStatus = () => {
    clearTimeout(savedStateTimerRef.current);
    savedStateTimerRef.current = setTimeout(() => setSaveState('idle'), 2200);
  };

  const reportSaveFailure = () => {
    setSaveState('error');
    setSaveError('Save failed — storage may be full. Your draft remains in this editor for retry.');
  };

  const commitActiveContent = (value) => {
    const current = padsStateRef.current;
    const activeId = current.activePadId;
    const updatedAt = Date.now();
    const nextState = {
      ...current,
      pads: current.pads.map((pad) => pad.id === activeId
        ? normalizeScratchPad({ ...pad, content: value, updatedAt, timestamp: updatedAt })
        : pad),
    };
    setSaveState('saving');
    const result = persistPads(nextState, { preferLocalIds: [activeId] });
    if (!result.ok) {
      reportSaveFailure();
      return false;
    }
    setLastSavedAt(updatedAt);
    setRelativeSavedAt(formatRelativeTime(updatedAt));
    setSaveError('');
    setSaveState('saved');
    scheduleIdleStatus();
    return true;
  };

  const flushActivePad = ({ silent = false } = {}) => {
    clearTimeout(timerRef.current);
    const current = padsStateRef.current;
    const storedPad = current.pads.find((pad) => pad.id === current.activePadId);
    if (!storedPad || textRef.current === storedPad.content) return { ok: true, state: current };
    const ok = commitActiveContent(textRef.current);
    if (ok && silent) setSaveState('idle');
    return { ok, state: padsStateRef.current };
  };

  const flushRef = useRef(flushActivePad);
  useEffect(() => { flushRef.current = flushActivePad; });
  useEffect(() => { padsStateRef.current = padsState; }, [padsState]);
  useEffect(() => { textRef.current = text; }, [text]);

  const loadPadView = (pad, { focus = true } = {}) => {
    const value = pad?.content || '';
    textRef.current = value;
    setText(value);
    setSelection({ start: 0, end: 0, text: '' });
    setSaveState('idle');
    setSaveError('');
    setLastSavedAt(pad?.updatedAt || 0);
    setRelativeSavedAt(pad?.updatedAt ? formatRelativeTime(pad.updatedAt) : '');
    if (focus) setTimeout(() => textareaRef.current?.focus(), 0);
  };

  useEffect(() => {
    if (migrationCheckedRef.current) return;
    migrationCheckedRef.current = true;
    const { payload, error, migrated } = migrateScratchStorage();
    applyState(payload);
    const active = payload.pads.find((pad) => pad.id === payload.activePadId) || payload.pads[0];
    loadPadView(active, { focus: false });
    if (error) notify?.('Scratch migration failed; legacy data was kept and loaded as a fallback.');
    else if (migrated) notify?.('Scratch notes upgraded to schema v4.');
  // Intentionally a mount-only migration.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onResize = () => {
      const compact = window.innerWidth <= COMPACT_BREAKPOINT;
      setIsCompact(compact);
      if (!compact) setCompactPane('editor');
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    const onStorage = (event) => {
      if (event.key !== SCRATCH_KEY || !event.newValue) return;
      let incoming;
      try {
        incoming = normalizeScratchPayload(JSON.parse(event.newValue));
      } catch {
        return;
      }
      if (!incoming) return;

      const current = padsStateRef.current;
      const currentPad = current.pads.find((pad) => pad.id === current.activePadId);
      const pendingEdits = currentPad ? textRef.current !== currentPad.content : Boolean(textRef.current);
      const currentStillExists = incoming.pads.some((pad) => pad.id === current.activePadId);
      const merged = mergeScratchPayloads(current, incoming, {
        preferLocalIds: pendingEdits && currentStillExists ? [current.activePadId] : [],
      });
      merged.revision = incoming.revision;
      applyState(merged);

      if (!currentStillExists) {
        const replacement = merged.pads.find((pad) => pad.id === merged.activePadId) || merged.pads[0];
        loadPadView(replacement);
        notify?.('This scratch note was removed in another tab.');
      } else if (!pendingEdits) {
        const refreshed = merged.pads.find((pad) => pad.id === current.activePadId);
        if (refreshed && refreshed.content !== textRef.current) loadPadView(refreshed, { focus: false });
      } else {
        const external = incoming.pads.find((pad) => pad.id === current.activePadId);
        if (external && external.content !== currentPad?.content) {
          notify?.('This note changed in another tab. Your unsaved editor text is preserved for an explicit retry.');
        }
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [notify]);

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

  useEffect(() => () => {
    flushRef.current({ silent: true });
    clearTimeout(timerRef.current);
    clearTimeout(savedStateTimerRef.current);
  }, []);

  useEffect(() => {
    const flush = () => flushRef.current({ silent: true });
    const onVisibilityChange = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('beforeunload', flush);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  const scheduleSave = (value) => {
    textRef.current = value;
    setText(value);
    setSaveError('');
    setSaveState('dirty');
    clearTimeout(timerRef.current);
    clearTimeout(savedStateTimerRef.current);
    timerRef.current = setTimeout(() => commitActiveContent(value), 600);
  };

  const restoreSelection = (start, end = start) => {
    setTimeout(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(start, end);
      const value = textRef.current;
      setSelection({ start, end, text: value.slice(start, end) });
    }, 0);
  };

  const replaceSelection = (prefix, suffix = '', placeholder = '') => {
    const { start, end, text: selected } = getSelection(textareaRef.current, textRef.current);
    const content = selected || placeholder;
    const replacement = `${prefix}${content}${suffix}`;
    const next = `${textRef.current.slice(0, start)}${replacement}${textRef.current.slice(end)}`;
    scheduleSave(next);
    const selectionStart = start + prefix.length;
    restoreSelection(selectionStart, selectionStart + content.length);
  };

  const prefixSelectedLines = (prefixFactory) => {
    const { start, end } = getSelection(textareaRef.current, textRef.current);
    const lineStart = textRef.current.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
    const nextBreak = textRef.current.indexOf('\n', end);
    const lineEnd = nextBreak === -1 ? textRef.current.length : nextBreak;
    const block = textRef.current.slice(lineStart, lineEnd);
    const replacement = block.split('\n').map((line, index) => `${prefixFactory(index)}${line}`).join('\n');
    const next = `${textRef.current.slice(0, lineStart)}${replacement}${textRef.current.slice(lineEnd)}`;
    scheduleSave(next);
    restoreSelection(lineStart, lineStart + replacement.length);
  };

  const insertDate = () => {
    const value = new Date().toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
    replaceSelection(`\n---\n${value}\n\n`);
    notify?.('Date separator inserted.');
  };

  const handleEditorKeyDown = (event) => {
    const modifier = event.metaKey || event.ctrlKey;
    if (modifier && event.key.toLowerCase() === 'b') {
      event.preventDefault(); replaceSelection('**', '**', 'bold text'); return;
    }
    if (modifier && event.key.toLowerCase() === 'i') {
      event.preventDefault(); replaceSelection('_', '_', 'italic text'); return;
    }
    if (modifier && event.key.toLowerCase() === 'k') {
      event.preventDefault(); replaceSelection('[', '](https://)', 'link text'); return;
    }
    if (event.key === 'Tab' && !modifier) {
      event.preventDefault(); replaceSelection('  '); return;
    }
    if (event.key !== 'Enter' || modifier || event.shiftKey) return;
    const textarea = event.currentTarget;
    if (textarea.selectionStart !== textarea.selectionEnd) return;
    const cursor = textarea.selectionStart;
    const lineStart = textRef.current.lastIndexOf('\n', Math.max(0, cursor - 1)) + 1;
    const line = textRef.current.slice(lineStart, cursor);
    const match = line.match(/^(\s*)([-*+]\s|\d+\.\s|-\s\[[ xX]\]\s|>\s)(.*)$/);
    if (!match) return;
    event.preventDefault();
    const [, indent, marker, content] = match;
    if (!content.trim()) {
      const next = `${textRef.current.slice(0, lineStart)}${textRef.current.slice(cursor)}`;
      scheduleSave(next);
      restoreSelection(lineStart);
      return;
    }
    const numbered = marker.match(/^(\d+)\.\s$/);
    const nextMarker = numbered ? `${Number(numbered[1]) + 1}. ` : marker.replace(/\[[xX]\]/, '[ ]');
    const insertion = `\n${indent}${nextMarker}`;
    const next = `${textRef.current.slice(0, cursor)}${insertion}${textRef.current.slice(cursor)}`;
    scheduleSave(next);
    restoreSelection(cursor + insertion.length);
  };

  const updatePadMetadataById = (padId, patch) => {
    if (!padId) return false;
    if (padId === padsStateRef.current.activePadId && !flushActivePad({ silent: true }).ok) return false;
    const current = padsStateRef.current;
    const updatedAt = Date.now();
    const nextState = {
      ...current,
      pads: current.pads.map((pad) => pad.id === padId
        ? normalizeScratchPad({ ...pad, ...patch, updatedAt, timestamp: updatedAt })
        : pad),
    };
    const result = persistPads(nextState, { preferLocalIds: [padId] });
    if (!result.ok) {
      notify?.('Could not update scratch metadata — storage may be full.');
      return false;
    }
    if (padId === padsStateRef.current.activePadId) {
      setLastSavedAt(updatedAt);
      setRelativeSavedAt(formatRelativeTime(updatedAt));
    }
    return true;
  };

  const updatePadMetadata = (patch) => updatePadMetadataById(activePad?.id, patch);

  const selectPad = (padId) => {
    if (padId === padsStateRef.current.activePadId) {
      if (isCompact) setCompactPane('editor');
      return;
    }
    const flushed = flushActivePad({ silent: true });
    if (!flushed.ok) {
      notify?.('This note could not be saved. Free storage or copy it before switching.');
      return;
    }
    const nextState = { ...padsStateRef.current, activePadId: padId };
    const result = persistPads(nextState);
    if (!result.ok) {
      reportSaveFailure();
      return;
    }
    const nextPad = result.state.pads.find((pad) => pad.id === padId) || result.state.pads[0];
    loadPadView(nextPad);
    if (isCompact) setCompactPane('editor');
  };

  useEffect(() => {
    if (!openNoteId || openNoteId === lastOpenNoteIdRef.current) return;
    const target = padsStateRef.current.pads.find((pad) => pad.id === openNoteId);
    if (!target) return;
    lastOpenNoteIdRef.current = openNoteId;
    selectPad(openNoteId);
    setCompactPane('editor');
  // `openNoteId` is an imperative navigation signal; state changes should not
  // re-trigger it or overwrite the selected note's content.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openNoteId]);

  const submitNameDialog = () => {
    if (!nameDialog) return;
    const name = nameDialog.value.trim();
    if (!name) return;
    if (nameDialog.mode === 'create') {
      if (!flushActivePad({ silent: true }).ok) return;
      const now = Date.now();
      const pad = normalizeScratchPad({ id: buildPadId(), name, content: '', createdAt: now, updatedAt: now });
      const result = persistPads({
        ...padsStateRef.current,
        pads: [...padsStateRef.current.pads, pad],
        activePadId: pad.id,
      }, { preferLocalIds: [pad.id] });
      if (!result.ok) {
        reportSaveFailure();
        return;
      }
      loadPadView(pad);
      setCompactPane('editor');
      notify?.(`Created note: ${name}`);
    } else if (activePad && name !== activePad.name) {
      updatePadMetadata({ name });
      notify?.(`Renamed note: ${name}`);
    }
    setNameDialog(null);
  };

  const duplicatePad = () => {
    if (!activePad || !flushActivePad({ silent: true }).ok) return;
    const source = padsStateRef.current.pads.find((pad) => pad.id === activePad.id) || activePad;
    const now = Date.now();
    const duplicate = normalizeScratchPad({
      ...source,
      id: buildPadId(),
      name: `${source.name} copy`,
      createdAt: now,
      updatedAt: now,
      timestamp: now,
      pinned: false,
    });
    const result = persistPads({
      ...padsStateRef.current,
      pads: [...padsStateRef.current.pads, duplicate],
      activePadId: duplicate.id,
    }, { preferLocalIds: [duplicate.id] });
    if (!result.ok) {
      reportSaveFailure();
      return;
    }
    loadPadView(duplicate);
    setCompactPane('editor');
    notify?.(`Duplicated note: ${source.name}`);
  };

  const confirmDestructiveAction = () => {
    if (!confirmDialog || !activePad) return;
    if (confirmDialog.action === 'clear') {
      const now = Date.now();
      const nextState = {
        ...padsStateRef.current,
        pads: padsStateRef.current.pads.map((pad) => pad.id === activePad.id
          ? normalizeScratchPad({ ...pad, content: '', updatedAt: now, timestamp: now })
          : pad),
      };
      const result = persistPads(nextState, { preferLocalIds: [activePad.id] });
      if (result.ok) {
        loadPadView(result.state.pads.find((pad) => pad.id === activePad.id));
        notify?.('Note cleared.');
      } else reportSaveFailure();
    } else if (confirmDialog.action === 'delete' && padsStateRef.current.pads.length > 1) {
      clearTimeout(timerRef.current);
      const currentIndex = padsStateRef.current.pads.findIndex((pad) => pad.id === activePad.id);
      const remaining = padsStateRef.current.pads.filter((pad) => pad.id !== activePad.id);
      const replacement = remaining[Math.max(0, currentIndex - 1)] || remaining[0];
      const now = Date.now();
      const result = persistPads({
        ...padsStateRef.current,
        pads: remaining,
        activePadId: replacement.id,
        tombstones: { ...(padsStateRef.current.tombstones || {}), [activePad.id]: now },
      }, { removedIds: [activePad.id] });
      if (result.ok) {
        loadPadView(replacement);
        if (isCompact) setCompactPane('index');
        notify?.(`Deleted note: ${activePad.name}`);
      } else reportSaveFailure();
    }
    setConfirmDialog(null);
  };

  const copyText = async (value, label = 'Note') => {
    if (!value.trim()) return;
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const element = document.createElement('textarea');
      element.value = value;
      element.style.cssText = 'position:fixed;top:-9999px;opacity:0';
      document.body.appendChild(element);
      element.focus();
      element.select();
      document.execCommand('copy');
      element.remove();
    }
    notify?.(`${label} copied.`);
  };

  const exportPad = () => {
    if (!text.trim()) return;
    try {
      const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = buildFilename(activePad?.name);
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      notify?.('Note downloaded.');
    } catch (error) {
      logWarn('scratch download', error);
      notify?.('Download unavailable.');
    }
  };

  const linkPromptToPad = (padId, link) => {
    if (!link?.id) return false;
    const source = padsStateRef.current.pads.find((pad) => pad.id === padId);
    if (!source) return false;
    const normalizedLink = {
      id: String(link.id),
      title: link.title || '',
      linkedAt: Date.now(),
      selectionOnly: Boolean(link.selectionOnly),
      kind: link.kind === 'template' ? 'template' : 'working-prompt',
    };
    const linkedPrompts = [...(source.linkedPrompts || []).filter((item) => item.id !== normalizedLink.id), normalizedLink];
    return updatePadMetadataById(padId, {
      linkedPromptId: normalizedLink.id,
      linkedPromptTitle: normalizedLink.title,
      linkedPrompts,
    });
  };

  const openPromotionDialog = (scope = hasSelection ? 'selection' : 'whole') => {
    const wholeText = text.trim();
    const selectionText = hasSelection ? selection.text.trim() : '';
    const preview = scope === 'selection' && selectionText ? selectionText : wholeText;
    if (!preview) return;
    setPromotionError('');
    setPromotionDraft({
      title: activePad?.name || 'Untitled prompt',
      scope,
      kind: 'working-prompt',
      collection: '',
      tagsText: (activePad?.tags || []).join(', '),
      wholeText,
      selectionText,
      preview,
    });
  };

  const submitPromotion = async () => {
    if (!promotionDraft || !activePad || !onPromoteToLibrary) return;
    const sourcePadId = activePad.id;
    const content = promotionDraft.scope === 'selection' ? promotionDraft.selectionText : promotionDraft.wholeText;
    if (!content.trim()) return;
    const options = {
      sourceNoteId: sourcePadId,
      sourceNoteName: activePad.name,
      selectionOnly: promotionDraft.scope === 'selection',
      kind: promotionDraft.kind,
      collection: promotionDraft.collection,
      tags: parseTags(promotionDraft.tagsText),
      preserveSource: true,
      onLinked: (entry) => linkPromptToPad(sourcePadId, {
        ...entry,
        title: entry?.title || promotionDraft.title,
        selectionOnly: promotionDraft.scope === 'selection',
        kind: promotionDraft.kind,
      }),
    };
    setPromotionBusy(true);
    setPromotionError('');
    try {
      const response = await Promise.resolve(onPromoteToLibrary(promotionDraft.title.trim(), content, options));
      const link = typeof response === 'string' ? { id: response } : response;
      if (link?.id) options.onLinked({ ...link, title: link.title || promotionDraft.title });
      setPromotionDraft(null);
      notify?.(link?.id ? 'Prompt saved and linked to this note.' : 'Prompt prepared for saving. The source note was preserved.');
    } catch (error) {
      logWarn('promote scratch note', error);
      setPromotionError(error?.message || 'Could not prepare this prompt. The note and selection are still here.');
    } finally {
      setPromotionBusy(false);
    }
  };

  const sendToSurface = async (destination) => {
    const selectionOnly = sendScope === 'selection' && hasSelection;
    const content = selectionOnly ? selection.text.trim() : text.trim();
    if (!content) return;
    const handler = destination === 'editor' ? onSendToEditor : destination === 'composer' ? onSendToComposer : onSendToABTest;
    if (!handler) return;
    const payload = {
      title: activePad?.name || 'Scratch note',
      content,
      sourceNoteId: activePad?.id || '',
      sourceNoteName: activePad?.name || '',
      selectionOnly,
      tags: activePad?.tags || [],
      linkedPromptId: activePad?.linkedPromptId || '',
    };
    try {
      await Promise.resolve(handler(payload));
      notify?.(`${selectionOnly ? 'Selection' : 'Note'} sent to ${destination === 'ab' ? 'A/B' : destination}.`);
    } catch (error) {
      logWarn(`send scratch to ${destination}`, error);
      notify?.(`Could not send this ${selectionOnly ? 'selection' : 'note'} to ${destination}.`);
    }
  };

  const selectLinkedPrompt = (promptId) => {
    if (!promptId) {
      updatePadMetadata({ linkedPromptId: '', linkedPromptTitle: '' });
      return;
    }
    const entry = library.find((item) => item.id === promptId);
    linkPromptToPad(activePad.id, { id: promptId, title: entry?.title || '' });
  };

  const jumpToHeading = (item) => {
    setEditorView('write');
    restoreSelection(item.offset, item.offset + item.label.length + item.level + 1);
  };

  useEffect(() => {
    const onKeyDown = (event) => {
      if (nameDialog || confirmDialog || promotionDraft) return;
      const shortcut = matchPadShortcut(event);
      if (!shortcut) return;
      event.preventDefault();
      if (shortcut.id === 'export') exportPad();
      else if (shortcut.id === 'insertDate') insertDate();
      else if (shortcut.id === 'copyAll') copyText(textRef.current);
      else if (shortcut.id === 'clear') setConfirmDialog({
        action: 'clear', title: 'Clear this note?', description: 'This removes all content but keeps the note and metadata.', confirmLabel: 'Clear note',
      });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  const renderPadGroup = (label, pads) => (
    <section aria-labelledby={`scratch-group-${label.toLowerCase()}`}>
      <h2 id={`scratch-group-${label.toLowerCase()}`} className={`px-3 pb-1 pt-3 text-[10px] font-bold uppercase tracking-[0.16em] ${m.textMuted || ''}`}>{label} <span className="font-mono">{pads.length}</span></h2>
      {pads.map((pad) => {
        const active = pad.id === padsState.activePadId;
        return (
          <button key={pad.id} type="button" onClick={() => selectPad(pad.id)} aria-current={active ? 'page' : undefined} className={`ui-control w-full border-r-2 px-3 py-2.5 text-left transition-colors ${active ? 'border-orange-600 bg-orange-600/15' : `border-transparent ${m.btn || ''}`}`}>
            <span className="flex min-w-0 items-center gap-2">
              <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: COLOR_SWATCHES[pad.color] || COLOR_SWATCHES.orange }} />
              <span className={`truncate text-xs font-semibold ${active ? (isDark ? 'text-orange-200' : 'text-orange-800') : m.text || ''}`}>{pad.name}</span>
              {pad.pinned && <Ic n="Pin" size={10} className="ml-auto shrink-0" />}
            </span>
            <span className={`mt-1 block truncate text-[10px] ${m.textMuted || ''}`}>{pad.content.trim().replace(/\s+/g, ' ').slice(0, 72) || 'Empty note'}</span>
            <span className={`mt-1 block text-[10px] ${m.textMuted || ''}`}>{formatRelativeTime(pad.updatedAt)} · {pad.status}</span>
          </button>
        );
      })}
    </section>
  );

  const showSidebar = !isCompact || compactPane === 'index';
  const showEditor = !isCompact || compactPane === 'editor';
  const copyButtonClass = isDark
    ? 'border border-orange-400/30 bg-orange-500/15 text-orange-100 hover:bg-orange-500/25'
    : 'border border-orange-300 bg-orange-50 text-orange-800 hover:bg-orange-100';

  const editor = (
    <textarea
      id="plPadArea"
      ref={textareaRef}
      className={`w-full flex-1 resize-none rounded-xl border p-4 text-sm leading-relaxed focus:border-orange-600 focus:outline-none ${editorMinHeightClass} ${m.input || ''} ${m.text || ''}`}
      aria-label="Scratchpad"
      placeholder={'Capture notes, prompt fragments, and reusable ideas…\n\nMarkdown is supported.'}
      value={text}
      onChange={(event) => scheduleSave(event.target.value)}
      onKeyDown={handleEditorKeyDown}
      onSelect={(event) => setSelection(getSelection(event.currentTarget, textRef.current))}
      spellCheck
    />
  );

  return (
    <div className={`${shellMinHeightClass} pl-scratch-workspace ${isCompact ? 'pl-scratch-is-compact' : ''} flex ${pageScroll ? '' : 'flex-1 overflow-hidden'}`} data-compact-pane={compactPane}>
      <aside className={`${showSidebar ? 'flex' : 'hidden'} w-[240px] shrink-0 flex-col border-r ${m.border || ''} ${pageScroll ? '' : 'overflow-hidden'}`} aria-label="Scratch note index">
        <div className={`shrink-0 border-b p-3 ${m.border || ''}`}>
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-sm font-semibold">Scratch</p>
              <p className={`text-[10px] ${m.textMuted || ''}`}>{padsState.pads.length} note{padsState.pads.length === 1 ? '' : 's'} · local and offline</p>
            </div>
            <button type="button" title="New note" onClick={() => setNameDialog({ mode: 'create', value: `Note ${padsState.pads.length + 1}` })} className="ui-control pl-primary-button flex min-h-11 items-center gap-1 rounded-lg px-3 py-2 text-xs font-semibold"><Ic n="Plus" size={12} /> New</button>
          </div>
          <label className="relative mt-3 block">
            <span className="sr-only">Search scratch notes</span>
            <Ic n="Search" size={13} className={`pointer-events-none absolute left-3 top-3 ${m.textMuted || ''}`} />
            <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search notes, text, tags" className={`min-h-10 w-full rounded-lg border py-2 pl-9 pr-3 text-xs ${m.input || ''}`} />
          </label>
        </div>
        <div className={`flex-1 overflow-y-auto pb-3 ${pageScroll ? 'max-h-[65vh]' : ''}`}>
          {renderPadGroup('Pinned', visiblePads.pinned)}
          {renderPadGroup('Recent', visiblePads.recent)}
          {visiblePads.pinned.length + visiblePads.recent.length === 0 && <div className="px-3 py-8 text-center"><p className={`text-xs ${m.textMuted || ''}`}>No notes match “{search}”.</p><button type="button" className="pl-text-button mt-2" onClick={() => setSearch('')}>Clear search</button></div>}
        </div>
      </aside>

      <section className={`${showEditor ? 'flex' : 'hidden'} min-w-0 flex-1 flex-col ${pageScroll ? '' : 'overflow-hidden'}`} aria-label="Scratch note workspace">
        <header className={`shrink-0 border-b px-3 py-2.5 sm:px-4 ${m.border || ''}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              {isCompact && <button type="button" onClick={() => setCompactPane('index')} className={`ui-control rounded-lg px-2 py-2 text-xs ${m.btn || ''}`} aria-label="Back to scratch notes">← Notes</button>}
              <span aria-hidden="true" className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: COLOR_SWATCHES[activePad?.color] || COLOR_SWATCHES.orange }} />
              <div className="min-w-0">
                <h2 className="truncate text-sm font-semibold">{activePad?.name || 'Scratchpad'}</h2>
                <p className={`text-[10px] font-mono ${m.textMuted || ''}`}>{words} words · {text.length} chars · {readingMinutes || '<1'} min read</p>
              </div>
              <span className="pl-scratch-status">{activePad?.status || 'idea'}</span>
            </div>
            <div className="flex flex-wrap items-center gap-1">
              <button type="button" title="Rename note" onClick={() => setNameDialog({ mode: 'rename', value: activePad?.name || '' })} className={`ui-control rounded-lg px-2.5 py-2 text-xs ${m.btn || ''}`}>Rename</button>
              <button type="button" onClick={duplicatePad} className={`ui-control rounded-lg px-2.5 py-2 text-xs ${m.btn || ''}`}>Duplicate</button>
              <button type="button" aria-pressed={Boolean(activePad?.pinned)} onClick={() => updatePadMetadata({ pinned: !activePad?.pinned })} className={`ui-control rounded-lg p-2.5 ${m.btn || ''}`} aria-label={activePad?.pinned ? 'Unpin note' : 'Pin note'}><Ic n="Pin" size={12} /></button>
              <button type="button" onClick={() => openPromotionDialog(hasSelection ? 'selection' : 'whole')} disabled={!text.trim() || !onPromoteToLibrary} className="ui-control pl-primary-button flex items-center gap-1 rounded-lg px-3 py-2 text-xs font-semibold disabled:opacity-40"><Ic n="BookmarkPlus" size={12} /> Promote</button>
            </div>
          </div>
        </header>

        <div className={`pl-scratch-toolbar shrink-0 border-b px-3 py-2 ${m.border || ''}`}>
          <div className="flex flex-wrap items-center gap-1" role="toolbar" aria-label="Markdown formatting toolbar">
            <button type="button" onClick={() => replaceSelection('**', '**', 'bold text')} className={`ui-control rounded px-2 py-1.5 text-xs font-bold ${m.btn || ''}`} title="Bold (Command or Control B)" aria-label="Bold">B</button>
            <button type="button" onClick={() => replaceSelection('_', '_', 'italic text')} className={`ui-control rounded px-2 py-1.5 text-xs italic ${m.btn || ''}`} title="Italic (Command or Control I)" aria-label="Italic">I</button>
            <button type="button" onClick={() => replaceSelection('~~', '~~', 'struck text')} className={`ui-control rounded px-2 py-1.5 text-xs line-through ${m.btn || ''}`} aria-label="Strikethrough">S</button>
            <button type="button" onClick={() => replaceSelection('`', '`', 'code')} className={`ui-control rounded px-2 py-1.5 text-xs font-mono ${m.btn || ''}`} aria-label="Inline code">&lt;/&gt;</button>
            <button type="button" onClick={() => replaceSelection('[', '](https://)', 'link text')} className={`ui-control rounded px-2 py-1.5 text-xs ${m.btn || ''}`} title="Link (Command or Control K)" aria-label="Link">Link</button>
            <span className="pl-scratch-toolbar-separator" role="separator" aria-orientation="vertical" />
            <button type="button" onClick={() => prefixSelectedLines(() => '## ')} className={`ui-control rounded px-2 py-1.5 text-xs font-bold ${m.btn || ''}`} aria-label="Heading">H2</button>
            <button type="button" onClick={() => prefixSelectedLines(() => '- ')} className={`ui-control rounded p-2 ${m.btn || ''}`} aria-label="Bullet list"><Ic n="List" size={12} /></button>
            <button type="button" onClick={() => prefixSelectedLines((index) => `${index + 1}. `)} className={`ui-control rounded px-2 py-1.5 text-xs font-mono ${m.btn || ''}`} aria-label="Numbered list">1.</button>
            <button type="button" onClick={() => prefixSelectedLines(() => '- [ ] ')} className={`ui-control rounded px-2 py-1.5 text-xs ${m.btn || ''}`} aria-label="Task list">☑</button>
            <button type="button" onClick={() => prefixSelectedLines(() => '> ')} className={`ui-control rounded p-2 ${m.btn || ''}`} aria-label="Blockquote"><Ic n="Quote" size={12} /></button>
            <button type="button" onClick={() => replaceSelection('\n```\n', '\n```\n', 'code block')} className={`ui-control rounded px-2 py-1.5 text-xs font-mono ${m.btn || ''}`} aria-label="Code block">{'{}'}</button>
            <button type="button" onClick={insertDate} className={`ui-control rounded px-2 py-1.5 text-xs ${m.btn || ''}`} aria-label="Insert date">Date</button>
            <span className="pl-scratch-toolbar-separator" role="separator" aria-orientation="vertical" />
            <div className="pl-segmented" role="tablist" aria-label="Scratch editor view" onKeyDown={(event) => handleTabArrowKeys(event, editorView, setEditorView)}>
              {['write', 'split', 'preview'].map((view) => <button key={view} type="button" role="tab" data-tab-id={view} tabIndex={editorView === view ? 0 : -1} aria-selected={editorView === view} onClick={() => setEditorView(view)}>{view[0].toUpperCase() + view.slice(1)}</button>)}
            </div>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <label className="text-[10px] font-semibold uppercase tracking-wide">Status <select aria-label="Scratch status" value={activePad?.status || 'idea'} onChange={(event) => updatePadMetadata({ status: event.target.value })} className={`ml-1 min-h-9 rounded-lg border px-2 text-xs normal-case ${m.input || ''}`}><option value="idea">Idea</option><option value="working">Working</option><option value="ready">Ready</option><option value="archived">Archived</option></select></label>
            <label className="text-[10px] font-semibold uppercase tracking-wide">Color <select aria-label="Scratch color" value={activePad?.color || 'orange'} onChange={(event) => updatePadMetadata({ color: event.target.value })} className={`ml-1 min-h-9 rounded-lg border px-2 text-xs normal-case ${m.input || ''}`}>{Object.keys(COLOR_SWATCHES).map((color) => <option key={color} value={color}>{color[0].toUpperCase() + color.slice(1)}</option>)}</select></label>
            <label className="pl-scratch-tag-input"><span className="sr-only">Add scratch tag</span><input value={tagDraft} onChange={(event) => setTagDraft(event.target.value)} onKeyDown={(event) => {
              if (event.key === 'Enter' && tagDraft.trim()) {
                event.preventDefault();
                updatePadMetadata({ tags: parseTags([...(activePad?.tags || []), tagDraft]) });
                setTagDraft('');
              }
            }} placeholder="Add tag + Enter" /></label>
            {library.length > 0 && <label className="text-[10px] font-semibold uppercase tracking-wide">Link <select aria-label="Linked library prompt" value={activePad?.linkedPromptId || ''} onChange={(event) => selectLinkedPrompt(event.target.value)} className={`ml-1 min-h-9 max-w-48 rounded-lg border px-2 text-xs normal-case ${m.input || ''}`}><option value="">No linked prompt</option>{library.map((entry) => <option key={entry.id} value={entry.id}>{entry.title}</option>)}</select></label>}
          </div>
        </div>

        <div className={`flex min-h-0 flex-1 flex-col gap-2 p-3 sm:p-4 ${pageScroll ? '' : 'overflow-hidden'}`}>
          <div className="pl-scratch-editor-grid">
            <div className="pl-scratch-editor-surface">
              {editorView === 'write' && editor}
              {editorView === 'split' && <div className="pl-scratch-split w-full"><div className="min-w-0">{editor}</div><div className={`pl-scratch-preview min-w-0 overflow-auto rounded-xl border p-4 ${editorMinHeightClass} ${m.input || ''}`} aria-label="Live Markdown preview"><MarkdownPreview text={text} /></div></div>}
              {editorView === 'preview' && <div className={`pl-scratch-preview w-full overflow-auto rounded-xl border p-4 ${editorMinHeightClass} ${m.input || ''}`} aria-label="Markdown preview"><MarkdownPreview text={text} /></div>}
            </div>
            <aside className="pl-scratch-outline" aria-label="Document outline and metadata">
              <p className="pl-eyebrow">Outline</p>
              {outline.length > 0 ? outline.map((item) => <button key={`${item.line}-${item.offset}`} type="button" style={{ paddingLeft: `${0.45 + (item.level - 1) * 0.55}rem` }} onClick={() => jumpToHeading(item)}>{item.label}</button>) : <p>No headings yet. Add headings to navigate longer notes.</p>}
              {(activePad?.tags || []).length > 0 && <div className="pl-scratch-tags" aria-label="Note tags">{activePad.tags.map((tag) => <button key={tag} type="button" onClick={() => updatePadMetadata({ tags: activePad.tags.filter((item) => item !== tag) })} aria-label={`Remove tag ${tag}`}>#{tag} ×</button>)}</div>}
              <dl className={`mt-4 space-y-2 border-t pt-3 text-[10px] ${m.border || ''}`}><div><dt className="font-semibold uppercase tracking-wide">Created</dt><dd className={m.textMuted || ''}>{formatDateTime(activePad?.createdAt)}</dd></div><div><dt className="font-semibold uppercase tracking-wide">Updated</dt><dd className={m.textMuted || ''}>{formatDateTime(activePad?.updatedAt)}</dd></div></dl>
              {(activePad?.linkedPrompts || []).length > 0 && <div className={`mt-4 border-t pt-3 ${m.border || ''}`}><p className="pl-eyebrow">Linked prompts</p>{activePad.linkedPrompts.map((link) => <button key={link.id} type="button" onClick={() => onOpenLibraryEntry?.(library.find((entry) => entry.id === link.id) || link)} className="pl-text-button block w-full truncate text-left">{link.title || link.id}</button>)}</div>}
            </aside>
          </div>

          <footer className="flex flex-wrap items-center justify-between gap-2">
            <div aria-live="polite" aria-atomic="true" className="min-h-5 text-xs font-mono">
              {saveError ? <span className="flex items-center gap-1 text-red-400"><Ic n="X" size={11} />{saveError}</span>
                : saveState === 'dirty' ? <span className={m.textMuted || ''}>Unsaved changes</span>
                  : saveState === 'saving' ? <span className={m.textMuted || ''}>Saving…</span>
                    : saveState === 'saved' ? <span className="flex items-center gap-1 text-green-500"><Ic n="Check" size={11} />Saved</span>
                      : lastSavedAt ? <span className={m.textMuted || ''}>Last saved {relativeSavedAt}</span> : <span className={m.textMuted || ''}>Local draft</span>}
            </div>
            <div className="flex flex-wrap items-center gap-1">
              <label className="sr-only" htmlFor="scratch-send-scope">Send scope</label>
              <select id="scratch-send-scope" value={sendScope} onChange={(event) => setSendScope(event.target.value)} className={`ui-control min-h-9 rounded-lg border px-2 text-xs ${m.input || ''}`}><option value="whole">Send note</option><option value="selection" disabled={!hasSelection}>Send selection</option></select>
              <button type="button" onClick={() => sendToSurface('editor')} disabled={!onSendToEditor || !text.trim() || (sendScope === 'selection' && !hasSelection)} className={`ui-control rounded-lg px-2.5 py-2 text-xs ${m.btn || ''} disabled:opacity-40`}>Editor</button>
              <button type="button" onClick={() => sendToSurface('composer')} disabled={!onSendToComposer || !text.trim() || (sendScope === 'selection' && !hasSelection)} className={`ui-control rounded-lg px-2.5 py-2 text-xs ${m.btn || ''} disabled:opacity-40`}>Composer</button>
              <button type="button" onClick={() => sendToSurface('ab')} disabled={!onSendToABTest || !text.trim() || (sendScope === 'selection' && !hasSelection)} className={`ui-control rounded-lg px-2.5 py-2 text-xs ${m.btn || ''} disabled:opacity-40`}>A/B</button>
              <button type="button" onClick={() => copyText(hasSelection ? selection.text : text, hasSelection ? 'Selection' : 'Note')} disabled={!text.trim()} className={`ui-control flex items-center gap-1 rounded-lg px-2.5 py-2 text-xs font-semibold ${copyButtonClass} disabled:opacity-40`}><Ic n="Copy" size={11} />Copy {hasSelection ? 'selection' : 'note'}</button>
              <button type="button" onClick={exportPad} disabled={!text.trim()} className={`ui-control rounded-lg p-2.5 ${m.btn || ''} disabled:opacity-40`} aria-label="Download note"><Ic n="Download" size={12} /></button>
              <button type="button" onClick={() => setConfirmDialog({ action: 'clear', title: 'Clear this note?', description: 'This removes all content but keeps the note, tags, links, and metadata.', confirmLabel: 'Clear note' })} disabled={!text} className="ui-control rounded-lg px-2.5 py-2 text-xs text-red-400 hover:bg-red-950/30 disabled:opacity-40">Clear</button>
              <button type="button" onClick={() => setConfirmDialog({ action: 'delete', title: `Delete “${activePad?.name}”?`, description: 'This removes the note from every Prompt Lab surface. Linked prompts remain in the Library.', confirmLabel: 'Delete note' })} disabled={padsState.pads.length <= 1} className="ui-control rounded-lg p-2.5 text-red-400 hover:bg-red-950/30 disabled:opacity-40" aria-label="Delete note"><Ic n="Trash2" size={12} /></button>
            </div>
          </footer>
        </div>
      </section>

      {nameDialog && <NameDialog m={m} dialog={nameDialog} setDialog={setNameDialog} onSubmit={submitNameDialog} />}
      {confirmDialog && <ConfirmDialog m={m} dialog={confirmDialog} onClose={() => setConfirmDialog(null)} onConfirm={confirmDestructiveAction} />}
      {promotionDraft && <PromotionDialog m={m} draft={promotionDraft} setDraft={setPromotionDraft} selectionAvailable={hasSelection} collections={collections} busy={promotionBusy} error={promotionError} onClose={() => { if (!promotionBusy) setPromotionDraft(null); }} onSubmit={submitPromotion} />}
    </div>
  );
}
