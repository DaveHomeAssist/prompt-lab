import { useLayoutEffect, useRef } from 'react';
import { libraryEditBuffers } from '../lib/libraryEditBuffers.js';

let sequence = 0;

// Capture committed React state, not an abandoned concurrent render. Each mounted
// editor keeps its own identity; another window never overwrites this buffer.
export function useLibraryEditBuffer(family, value) {
  const id = useRef(null), current = useRef(value);
  if (!id.current) id.current = `${family}:${++sequence}`;
  useLayoutEffect(() => { current.current = value; });
  useLayoutEffect(() => libraryEditBuffers.register(id.current, () => current.current), []);
}
