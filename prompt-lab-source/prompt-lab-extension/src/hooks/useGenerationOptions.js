import { useEffect, useRef, useState } from 'react';
import {
  GENERATION_EVENT, GENERATION_STORAGE_KEY, normalizeGenerationOptions,
  readGenerationOptions, writeGenerationOptions,
} from '../lib/generationOptions.js';

/** Mount never overwrites stored choices; updates reach every open control. */
export default function useGenerationOptions() {
  const [options, setOptions] = useState(readGenerationOptions);
  const [error, setError] = useState('');
  const current = useRef(options);
  current.current = options;

  useEffect(() => {
    const adopt = (event) => {
      if (event.type === 'storage' && event.key !== GENERATION_STORAGE_KEY && event.key !== null) return;
      const next = event.type === GENERATION_EVENT
        ? normalizeGenerationOptions(event.detail?.value) : readGenerationOptions();
      current.current = next;
      setOptions(next);
      setError(event.type === GENERATION_EVENT ? event.detail?.error || '' : '');
    };
    window.addEventListener('storage', adopt);
    window.addEventListener(GENERATION_EVENT, adopt);
    return () => {
      window.removeEventListener('storage', adopt);
      window.removeEventListener(GENERATION_EVENT, adopt);
    };
  }, []);

  const update = (patch) => {
    const result = writeGenerationOptions({ ...current.current, ...patch });
    current.current = result.value;
    setOptions(result.value);
    setError(result.error || '');
    window.dispatchEvent(new CustomEvent(GENERATION_EVENT, { detail: result }));
    return result.ok;
  };
  return { options, update, error };
}
