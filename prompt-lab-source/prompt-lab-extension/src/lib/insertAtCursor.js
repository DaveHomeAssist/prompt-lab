// Insert `text` into `value` at the editor selection, replacing any selected
// text. Returns the new value and the caret position after the insertion.
// Out-of-range or reversed selections are clamped so a stale cursor from a
// previous draft can never drop text outside the prompt.
export function insertAtCursor(value, cursor, text) {
  const source = typeof value === 'string' ? value : '';
  const insert = typeof text === 'string' ? text : '';
  const clamp = (n) => Math.max(0, Math.min(source.length, Number.isFinite(n) ? n : source.length));
  const a = clamp(cursor?.start);
  const b = clamp(cursor?.end ?? cursor?.start);
  const start = Math.min(a, b);
  const end = Math.max(a, b);
  const next = source.slice(0, start) + insert + source.slice(end);
  return { value: next, caret: start + insert.length };
}
