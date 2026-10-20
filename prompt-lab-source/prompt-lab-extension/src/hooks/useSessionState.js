import { useEffect, useRef } from 'react';
import { sessionGet, sessionSet } from '../lib/platform.js';
import { readGenerationOptions, restoreEditorMode } from '../lib/generationOptions.js';

const SESSION_KEY = 'pl2-session';
const DEBOUNCE_MS = 500;

// A hash route such as #/library is the user's explicit destination (deep link
// or reload). The restored session tab only ever says editor/composer/history/
// pad, so applying it after the router has resolved the URL would bounce a
// reload on #/library back to #/. Only an empty or root route takes the tab.
export function hasExplicitRoute(hash) {
  if (typeof hash !== 'string') return false;
  const path = hash.replace(/^#/, '').split('?')[0];
  return path.startsWith('/') && path.length > 1;
}

export function useSessionRestore(setters) {
  useEffect(() => {
    const routeAtMount = typeof window !== 'undefined' ? window.location.hash : '';
    sessionGet(SESSION_KEY, (s) => {
      if (!s) return;
      if ('raw' in s) setters.setRaw(s.raw);
      if ('enhanced' in s) setters.setEnhanced(s.enhanced);
      if ('variants' in s) setters.setVariants(s.variants);
      if ('notes' in s) setters.setNotes(s.notes);
      if ('resultMeta' in s && typeof setters.setResultMeta === 'function') setters.setResultMeta(s.resultMeta);
      if ('tab' in s && !hasExplicitRoute(routeAtMount)) setters.setTab(s.tab);
      if ('enhMode' in s) setters.setEnhMode(restoreEditorMode(s.enhMode, readGenerationOptions()));
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
