/**
 * Pure insertion logic for page captures: prefer filling a {{context}}-style
 * variable; otherwise append a quoted block with provenance.
 */
import { ensureString } from './utils.js';

export function buildCaptureInsertion(capture, currentText, detectedVars = []) {
  const selection = ensureString(capture?.selection).trim();
  const title = ensureString(capture?.title).trim();
  const url = ensureString(capture?.url).trim();
  const value = selection || [title, url].filter(Boolean).join(' — ');
  if (!value) return null;

  const contextVar = (Array.isArray(detectedVars) ? detectedVars : [])
    .find((name) => ensureString(name).trim().toLowerCase() === 'context');
  if (contextVar) {
    return { type: 'var', name: contextVar, value };
  }

  const provenance = [title, url].filter(Boolean).join(' — ');
  const block = `\n\nCAPTURED CONTEXT${provenance ? ` (${provenance})` : ''}:\n"""\n${value}\n"""`;
  return { type: 'append', block };
}
