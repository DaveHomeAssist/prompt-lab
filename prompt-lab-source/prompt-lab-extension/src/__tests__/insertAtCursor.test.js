import { describe, expect, it } from 'vitest';
import { insertAtCursor } from '../lib/insertAtCursor.js';

describe('insertAtCursor', () => {
  it('inserts at a collapsed cursor and moves the caret after the text', () => {
    expect(insertAtCursor('Hello world', { start: 6, end: 6 }, 'brave ')).toEqual({ value: 'Hello brave world', caret: 12 });
  });

  it('replaces the selected range', () => {
    expect(insertAtCursor('Hello world', { start: 6, end: 11 }, 'there')).toEqual({ value: 'Hello there', caret: 11 });
  });

  it('normalizes a reversed selection', () => {
    expect(insertAtCursor('abcdef', { start: 4, end: 2 }, 'X')).toEqual({ value: 'abXef', caret: 3 });
  });

  it('clamps a stale cursor beyond the text to the end', () => {
    expect(insertAtCursor('short', { start: 40, end: 50 }, '!')).toEqual({ value: 'short!', caret: 6 });
  });

  it('appends when no cursor is known', () => {
    expect(insertAtCursor('Prompt', undefined, ' note')).toEqual({ value: 'Prompt note', caret: 11 });
  });

  it('keeps special replacement characters literal', () => {
    expect(insertAtCursor('', { start: 0, end: 0 }, "$& $' $$").value).toBe("$& $' $$");
  });
});
