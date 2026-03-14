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
      if ('tab' in s) setters.setTab(s.tab);
      if ('enhMode' in s) setters.setEnhMode(s.enhMode);
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
  }, [state.raw, state.enhanced, state.variants, state.notes, state.tab, state.enhMode]);
}
