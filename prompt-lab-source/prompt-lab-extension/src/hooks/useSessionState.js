import { useEffect, useRef } from 'react';
import { sessionGet, sessionSet } from '../lib/platform.js';

const SESSION_KEY = 'pl2-session';
const DEBOUNCE_MS = 500;

export function useSessionRestore(setters) {
  useEffect(() => {
    sessionGet(SESSION_KEY, (s) => {
      if (!s) return;
      if ('raw' in s) setters.setRaw(s.raw);
      if ('enhanced' in s) setters.setEnhanced(s.enhanced);
      if ('variants' in s) setters.setVariants(s.variants);
      if ('notes' in s) setters.setNotes(s.notes);
      if ('resultMeta' in s && typeof setters.setResultMeta === 'function') setters.setResultMeta(s.resultMeta);
      if ('tab' in s) setters.setTab(s.tab);
      if ('enhMode' in s) setters.setEnhMode(s.enhMode);
      if ('editingId' in s && typeof setters.setEditingId === 'function') setters.setEditingId(s.editingId || null);
      if ('saveTitle' in s && typeof setters.setSaveTitle === 'function') setters.setSaveTitle(s.saveTitle || '');
      if ('saveTags' in s && typeof setters.setSaveTags === 'function') setters.setSaveTags(Array.isArray(s.saveTags) ? s.saveTags : []);
      if ('saveCollection' in s && typeof setters.setSaveCollection === 'function') setters.setSaveCollection(s.saveCollection || '');
      if ('followUpOrigin' in s && typeof setters.setFollowUpOrigin === 'function') setters.setFollowUpOrigin(s.followUpOrigin);
      if ('sourceNoteId' in s && typeof setters.setSourceNoteId === 'function') setters.setSourceNoteId(s.sourceNoteId || '');
    });
  }, []);
}

export function useSessionSave(state) {
  const timerRef = useRef(null);
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      sessionSet({ [SESSION_KEY]: state });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timerRef.current);
  }, [
    state.raw,
    state.enhanced,
    state.variants,
    state.notes,
    state.resultMeta,
    state.tab,
    state.enhMode,
    state.editingId,
    state.saveTitle,
    state.saveTags,
    state.saveCollection,
    state.sourceNoteId,
    state.followUpOrigin,
  ]);
}
