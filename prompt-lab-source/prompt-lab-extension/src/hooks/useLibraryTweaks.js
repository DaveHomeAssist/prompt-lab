import { useCallback, useMemo, useState } from 'react';
import { loadJson, saveJson, storageKeys } from '../lib/storage.js';
import {
  DEFAULT_LIBRARY_TWEAKS,
  resolveLibraryTweaks,
  validateAccent,
  validateDensity,
  validateSignature,
} from '../lib/libraryTweaks.js';

// Persist three orthogonal axes for the Library v2 visual presets:
// density, accent, signature. Each axis is stored under its own pl2-* key
// so tab-concurrent writes don't merge-conflict and a single-axis reset is
// trivial. Unknown stored values fall back to the spec defaults silently
// (forward-compat with future preset additions).
//
// Optional `onChange(axis, from, to)` fires only when the validated value
// actually changes — a no-op write (same value, or invalid value coerced
// back to the current one) does not emit. Used for telemetry; the hook
// stays unaware of telemetry semantics.
export default function useLibraryTweaks({ onChange } = {}) {
  const [density, _setDensity] = useState(() =>
    validateDensity(loadJson(storageKeys.libraryDensity, DEFAULT_LIBRARY_TWEAKS.density)));
  const [accent, _setAccent] = useState(() =>
    validateAccent(loadJson(storageKeys.libraryAccent, DEFAULT_LIBRARY_TWEAKS.accent)));
  const [signature, _setSignature] = useState(() =>
    validateSignature(loadJson(storageKeys.librarySignature, DEFAULT_LIBRARY_TWEAKS.signature)));

  const setDensity = useCallback((value) => {
    const next = validateDensity(value);
    _setDensity((prev) => {
      if (prev !== next) onChange?.('density', prev, next);
      return next;
    });
    saveJson(storageKeys.libraryDensity, next);
  }, [onChange]);

  const setAccent = useCallback((value) => {
    const next = validateAccent(value);
    _setAccent((prev) => {
      if (prev !== next) onChange?.('accent', prev, next);
      return next;
    });
    saveJson(storageKeys.libraryAccent, next);
  }, [onChange]);

  const setSignature = useCallback((value) => {
    const next = validateSignature(value);
    _setSignature((prev) => {
      if (prev !== next) onChange?.('signature', prev, next);
      return next;
    });
    saveJson(storageKeys.librarySignature, next);
  }, [onChange]);

  const values = useMemo(() => ({ density, accent, signature }), [density, accent, signature]);
  const tw = useMemo(() => resolveLibraryTweaks(values), [values]);

  return { values, tw, setDensity, setAccent, setSignature };
}
