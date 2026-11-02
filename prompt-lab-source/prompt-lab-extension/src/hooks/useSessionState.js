import { useEffect, useMemo, useRef, useState } from 'react';
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
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    const routeAtMount = typeof window !== 'undefined' ? window.location.hash : '';
    sessionGet(SESSION_KEY, (s) => {
      if (!s) { setRestored(true); return; }
      if ('raw' in s) setters.setRaw(s.raw);
      if ('enhanced' in s) setters.setEnhanced(s.enhanced);
      if ('variants' in s) setters.setVariants(s.variants);
      if ('notes' in s) setters.setNotes(s.notes);
      if ('resultMeta' in s && typeof setters.setResultMeta === 'function') setters.setResultMeta(s.resultMeta);
      if ('tab' in s && !hasExplicitRoute(routeAtMount)) setters.setTab(s.tab);
      if ('enhMode' in s) setters.setEnhMode(restoreEditorMode(s.enhMode, readGenerationOptions()));
      if ('editingId' in s && typeof setters.setEditingId === 'function') setters.setEditingId(s.editingId || null);
      if (typeof setters.setEditingVersionId === 'function') setters.setEditingVersionId(s.editingVersionId || (s.editingId ? 'unverified' : null));
      if ('saveTitle' in s && typeof setters.setSaveTitle === 'function') setters.setSaveTitle(s.saveTitle || '');
      if ('saveTags' in s && typeof setters.setSaveTags === 'function') setters.setSaveTags(Array.isArray(s.saveTags) ? s.saveTags : []);
      if ('saveCollection' in s && typeof setters.setSaveCollection === 'function') setters.setSaveCollection(s.saveCollection || '');
      if ('followUpOrigin' in s && typeof setters.setFollowUpOrigin === 'function') setters.setFollowUpOrigin(s.followUpOrigin);
      if ('sourceNoteId' in s && typeof setters.setSourceNoteId === 'function') setters.setSourceNoteId(s.sourceNoteId || '');
      setRestored(true);
    });
  }, []);
  return restored;
}

export function useSessionSave(input, enabled = true) {
  const state = useMemo(() => input, [input.raw, input.enhanced, input.variants, input.notes,
    input.resultMeta, input.tab, input.enhMode, input.editingId, input.editingVersionId,
    input.saveTitle, input.saveTags, input.saveCollection, input.sourceNoteId, input.followUpOrigin]);
  const latestRef = useRef(state);
  latestRef.current = state;
  const savedRef = useRef(null);
  const timerRef = useRef(null);
  const [status, setStatus] = useState('pending');
  const flush = () => {
    clearTimeout(timerRef.current);
    const snapshot = latestRef.current;
    const acknowledge = (ok) => {
      if (ok === false) throw new Error('Draft checkpoint failed');
      if (latestRef.current === snapshot) {
        savedRef.current = snapshot;
        setStatus('saved');
      }
      return true;
    };
    try {
      const result = sessionSet({ [SESSION_KEY]: snapshot });
      if (result?.then) return result.then(acknowledge).catch(() => {
        if (latestRef.current === snapshot) setStatus('failed');
        return false;
      });
      return acknowledge(result);
    } catch {
      if (latestRef.current === snapshot) setStatus('failed');
      return false;
    }
  };
  // Keep exit handlers on the latest render without restarting the debounce.
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => {
    if (!enabled) return undefined;
    setStatus('pending');
    timerRef.current = setTimeout(() => { void flushRef.current(); }, DEBOUNCE_MS);
    return () => clearTimeout(timerRef.current);
  }, [enabled, state.raw, state.enhanced, state.variants, state.notes, state.resultMeta,
    state.tab, state.enhMode, state.editingId, state.editingVersionId, state.saveTitle,
    state.saveTags, state.saveCollection, state.sourceNoteId, state.followUpOrigin]);
  useEffect(() => {
    if (!enabled) return undefined;
    const flushOnExit = (event) => {
      if (savedRef.current === latestRef.current) return;
      const result = flushRef.current();
      // Hosted storage acknowledges synchronously. Async extension writes must
      // finish before an unguarded exit can be considered safe.
      if (event.type === 'beforeunload' && result !== true) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    const onHidden = () => { if (document.visibilityState === 'hidden') flushOnExit({ type: 'hidden' }); };
    window.addEventListener('beforeunload', flushOnExit);
    window.addEventListener('pagehide', flushOnExit);
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      window.removeEventListener('beforeunload', flushOnExit);
      window.removeEventListener('pagehide', flushOnExit);
      document.removeEventListener('visibilitychange', onHidden);
    };
  }, [enabled]);
  return { status, retry: flush };
}
