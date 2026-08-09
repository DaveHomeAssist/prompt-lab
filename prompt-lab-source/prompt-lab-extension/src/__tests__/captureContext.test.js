import { describe, expect, it } from 'vitest';
import { buildCaptureInsertion } from '../lib/captureContext.js';
import { captureContext } from '../lib/platform.js';

describe('buildCaptureInsertion', () => {
  const capture = { selection: 'highlighted text', title: 'Some Page', url: 'https://example.com/a' };

  it('fills a detected {{context}} variable (case-insensitive) with the selection', () => {
    const insertion = buildCaptureInsertion(capture, 'Summarize {{Context}}', ['Context']);
    expect(insertion).toEqual({ type: 'var', name: 'Context', value: 'highlighted text' });
  });

  it('appends a provenance block when no context variable exists', () => {
    const insertion = buildCaptureInsertion(capture, 'plain prompt', ['topic']);
    expect(insertion.type).toBe('append');
    expect(insertion.block).toContain('CAPTURED CONTEXT (Some Page — https://example.com/a)');
    expect(insertion.block).toContain('highlighted text');
  });

  it('falls back to title and url when the selection is empty', () => {
    const insertion = buildCaptureInsertion({ ...capture, selection: '' }, 'x', ['context']);
    expect(insertion).toEqual({ type: 'var', name: 'context', value: 'Some Page — https://example.com/a' });
  });

  it('returns null when there is nothing to insert', () => {
    expect(buildCaptureInsertion({ selection: '', title: '', url: '' }, 'x', [])).toBeNull();
    expect(buildCaptureInsertion(null, 'x', [])).toBeNull();
  });
});

describe('captureContext platform branch', () => {
  // setup.js stubs chrome.runtime, so the extension branch is active in tests.
  it('passes the background response through', async () => {
    const original = globalThis.chrome.runtime.sendMessage;
    globalThis.chrome.runtime.sendMessage = (msg, cb) => {
      expect(msg).toEqual({ type: 'CAPTURE_CONTEXT' });
      cb({ ok: true, capture: { selection: 'sel', title: 't', url: 'u' } });
    };
    try {
      const response = await captureContext();
      expect(response.ok).toBe(true);
      expect(response.capture.selection).toBe('sel');
    } finally {
      globalThis.chrome.runtime.sendMessage = original;
    }
  });

  it('surfaces a missing response as a failed capture', async () => {
    const original = globalThis.chrome.runtime.sendMessage;
    globalThis.chrome.runtime.sendMessage = (_msg, cb) => cb(undefined);
    try {
      const response = await captureContext();
      expect(response.ok).toBe(false);
      expect(response.reason).toBeTruthy();
    } finally {
      globalThis.chrome.runtime.sendMessage = original;
    }
  });
});
