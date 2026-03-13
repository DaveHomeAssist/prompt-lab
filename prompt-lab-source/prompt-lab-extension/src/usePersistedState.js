import { useState, useEffect, useRef } from 'react';
import { logWarn } from './lib/logger.js';

/**
 * useState backed by localStorage. Reads on mount, writes on change.
 * @param {string} key - localStorage key
 * @param {*} fallback - default value if nothing stored
 * @param {object} [opts]
 * @param {function} [opts.serialize]   - custom serializer  (default JSON.stringify)
 * @param {function} [opts.deserialize] - custom deserializer (default JSON.parse)
 * @param {function} [opts.validate]    - post-deserialize guard; return cleaned value
 */
export default function usePersistedState(key, fallback, opts = {}) {
  const {
    serialize = JSON.stringify,
    deserialize = JSON.parse,
    validate,
  } = opts;

  const ready = useRef(false);

  const [value, setValue] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return fallback;
      const parsed = deserialize(raw);
      return validate ? validate(parsed) : parsed;
    } catch {
      return fallback;
    }
  });

  useEffect(() => {
    if (!ready.current) {
      ready.current = true;
      return;
    }
    try {
      localStorage.setItem(key, serialize(value));
    } catch (e) { logWarn(`localStorage write "${key}"`, e); }
  }, [value, key, serialize]);

  return [value, setValue];
}
