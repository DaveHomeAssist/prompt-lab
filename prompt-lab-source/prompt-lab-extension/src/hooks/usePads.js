import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createEmptyPadDocument,
  createPad,
  loadAndMigratePads,
  padDocumentToPlainText,
  persistPadsPayload,
} from '../lib/padSchema.js';

const SAVE_DELAY_MS = 600;

function buildPadId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `pad-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function updateActivePad(payload, doc, plainText, now) {
  return {
    ...payload,
    pads: payload.pads.map((pad) => pad.id === payload.activePadId
      ? { ...pad, doc, plainText, updatedAt: now }
      : pad),
  };
}

export default function usePads({ notify, storage = globalThis.localStorage } = {}) {
  const migrationRef = useRef(null);
  if (!migrationRef.current) migrationRef.current = loadAndMigratePads(storage);
  const [payload, setPayload] = useState(migrationRef.current.payload);
  const activePad = payload.pads.find((pad) => pad.id === payload.activePadId) || payload.pads[0];
  const [draft, setDraft] = useState({ doc: activePad.doc, plainText: activePad.plainText });
  const [saveState, setSaveState] = useState(migrationRef.current.error ? 'failed' : 'idle');
  const [saveMessage, setSaveMessage] = useState(migrationRef.current.error?.message || '');
  const payloadRef = useRef(payload);
  const draftRef = useRef(draft);
  const dirtyRef = useRef(false);
  const saveTimerRef = useRef(null);
  const idleTimerRef = useRef(null);

  useEffect(() => { payloadRef.current = payload; }, [payload]);
  useEffect(() => { draftRef.current = draft; }, [draft]);

  useEffect(() => {
    if (migrationRef.current.error) notify?.('Scratchpad migration failed. The version-2 data was preserved.');
    else if (migrationRef.current.migrated) notify?.('Scratchpads upgraded to rich-text storage.');
  }, [notify]);

  const markSaved = useCallback((message = 'Saved') => {
    setSaveState('saved');
    setSaveMessage(message);
    clearTimeout(idleTimerRef.current);
    idleTimerRef.current = window.setTimeout(() => setSaveState('idle'), 2000);
  }, []);

  const commitDraft = useCallback(({ silent = false } = {}) => {
    clearTimeout(saveTimerRef.current);
    if (!dirtyRef.current) return payloadRef.current;
    const now = new Date().toISOString();
    const next = updateActivePad(payloadRef.current, draftRef.current.doc, draftRef.current.plainText, now);
    try {
      persistPadsPayload(next, storage);
      payloadRef.current = next;
      dirtyRef.current = false;
      setPayload(next);
      if (silent) {
        setSaveState('idle');
        setSaveMessage('');
      } else {
        markSaved();
      }
      return next;
    } catch (error) {
      setSaveState('failed');
      setSaveMessage(error?.name === 'QuotaExceededError' ? 'Storage is full. Export or remove a pad.' : 'Save failed. Changes are still pending.');
      return null;
    }
  }, [markSaved, storage]);

  const queueDocument = useCallback((doc, plainText = padDocumentToPlainText(doc)) => {
    const nextDraft = { doc, plainText };
    draftRef.current = nextDraft;
    dirtyRef.current = true;
    setDraft(nextDraft);
    setSaveState('pending');
    setSaveMessage('Saving...');
    clearTimeout(saveTimerRef.current);
    clearTimeout(idleTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => commitDraft(), SAVE_DELAY_MS);
  }, [commitDraft]);

  const persistStructuralChange = useCallback((next, message = '') => {
    try {
      persistPadsPayload(next, storage);
      payloadRef.current = next;
      dirtyRef.current = false;
      setPayload(next);
      if (message) markSaved(message);
      return next;
    } catch (error) {
      setSaveState('failed');
      setSaveMessage(error?.name === 'QuotaExceededError' ? 'Storage is full. Export or remove a pad.' : 'Scratchpad change could not be saved.');
      return null;
    }
  }, [markSaved, storage]);

  const selectPad = useCallback((padId) => {
    if (padId === payloadRef.current.activePadId) return true;
    const base = commitDraft({ silent: true });
    if (!base) return false;
    const selected = base.pads.find((pad) => pad.id === padId);
    if (!selected) return false;
    const next = persistStructuralChange({ ...base, activePadId: padId });
    if (!next) return false;
    const nextDraft = { doc: selected.doc, plainText: selected.plainText };
    draftRef.current = nextDraft;
    setDraft(nextDraft);
    setSaveState('idle');
    return true;
  }, [commitDraft, persistStructuralChange]);

  const createNewPad = useCallback(() => {
    const base = commitDraft({ silent: true });
    if (!base) return null;
    const now = new Date().toISOString();
    const pad = createPad({ id: buildPadId(), name: `Pad ${base.pads.length + 1}`, now });
    const next = persistStructuralChange({ ...base, pads: [...base.pads, pad], activePadId: pad.id }, 'Pad created');
    if (!next) return null;
    const nextDraft = { doc: pad.doc, plainText: pad.plainText };
    draftRef.current = nextDraft;
    setDraft(nextDraft);
    return pad.id;
  }, [commitDraft, persistStructuralChange]);

  const renamePad = useCallback((padId, rawName) => {
    const current = payloadRef.current.pads.find((pad) => pad.id === padId);
    if (!current) return false;
    const name = String(rawName || '').trim();
    if (!name || name === current.name) return false;
    const next = {
      ...payloadRef.current,
      pads: payloadRef.current.pads.map((pad) => pad.id === padId ? { ...pad, name, updatedAt: new Date().toISOString() } : pad),
    };
    return Boolean(persistStructuralChange(next, 'Renamed'));
  }, [persistStructuralChange]);

  const deleteActivePad = useCallback(() => {
    const current = payloadRef.current;
    if (current.pads.length <= 1) return false;
    const index = current.pads.findIndex((pad) => pad.id === current.activePadId);
    const remaining = current.pads.filter((pad) => pad.id !== current.activePadId);
    const selected = remaining[Math.max(0, index - 1)] || remaining[0];
    const next = persistStructuralChange({ ...current, pads: remaining, activePadId: selected.id }, 'Pad deleted');
    if (!next) return false;
    const nextDraft = { doc: selected.doc, plainText: selected.plainText };
    draftRef.current = nextDraft;
    setDraft(nextDraft);
    return true;
  }, [persistStructuralChange]);

  const clearActivePad = useCallback(() => {
    const doc = createEmptyPadDocument();
    const nextDraft = { doc, plainText: '' };
    draftRef.current = nextDraft;
    dirtyRef.current = true;
    setDraft(nextDraft);
    return Boolean(commitDraft());
  }, [commitDraft]);

  const flushRef = useRef(commitDraft);
  useEffect(() => { flushRef.current = commitDraft; }, [commitDraft]);
  useEffect(() => {
    const flush = () => flushRef.current({ silent: true });
    const onVisibility = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('blur', flush);
    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      flush();
      clearTimeout(saveTimerRef.current);
      clearTimeout(idleTimerRef.current);
      window.removeEventListener('blur', flush);
      window.removeEventListener('beforeunload', flush);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return {
    payload,
    activePad,
    draft,
    saveState,
    saveMessage,
    queueDocument,
    flush: commitDraft,
    selectPad,
    createNewPad,
    renamePad,
    deleteActivePad,
    clearActivePad,
  };
}
