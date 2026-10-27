import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDiagnostics, safeFrames, registerDiagnosticSource } from '../lib/diagnostics.js';

describe('local diagnostic contract', () => {
  beforeEach(() => localStorage.clear());
  it('never serializes arbitrary error messages, prompts, URLs, or nested payloads', () => {
    const d = createDiagnostics({ storage: localStorage });
    d.record('operation_error', { provider: 'anthropic', durationMs: 12, prompt: 'PRIVATE_PROMPT', apiKey: 'sk-PRIVATE', nested: { token: 'PRIVATE' }, url: 'https://example.com/?token=PRIVATE' });
    d.exception('uncaught_error', new Error('PRIVATE_PROMPT sk-PRIVATE'));
    const text = JSON.stringify(d.snapshot());
    expect(text).not.toContain('PRIVATE');
    expect(d.snapshot().events[0].metadata).toEqual({ provider: 'anthropic', durationMs: 12 });
  });
  it('survives denied writes, corrupt storage and native failures without recursion', async () => {
    const storage = { getItem: () => '{broken', setItem: () => { throw new Error('denied'); } };
    const d = createDiagnostics({ storage, native: { record: () => Promise.reject(new Error('denied')) } });
    expect(() => d.record('session_start')).not.toThrow();
    await Promise.resolve();
    expect(d.snapshot().warnings).toContain('Browser diagnostic storage is unavailable; this session is held in memory.');
    expect(d.snapshot().events).toHaveLength(1);
  });
  it('bounds event count and retention and gives one operation a stable correlation ID', () => {
    let now = Date.UTC(2026, 9, 27);
    const d = createDiagnostics({ storage: localStorage, now: () => now, maxEvents: 3 });
    const finish = d.begin('model', { provider: 'openai' });
    now += 50; finish('operation_error', { status: 429 }); finish('operation_end');
    const events = d.snapshot().events;
    expect(events).toHaveLength(2);
    expect(events[0].operationId).toBe(events[1].operationId);
    expect(events[1].metadata.durationMs).toBe(50);
    for (let i = 0; i < 8; i++) d.record('storage_warning');
    expect(d.snapshot().events).toHaveLength(3);
    now += 8 * 86400_000;
    expect(d.snapshot().events).toHaveLength(0);
  });
  it('retains only application frame basenames and line/column positions', () => {
    registerDiagnosticSource('https://host/assets/app-Ab12.js');
    expect(safeFrames('Error: sk-PRIVATE\n at user (C:\\Users\\PRIVATE\\App.jsx:42:7)\n at x (https://host/assets/app-Ab12.js:8:3)'))
      .toEqual(['App.jsx:42:7', 'app-Ab12.js:8:3']);
  });
  it('drops oversized and unrecognized metadata instead of coercing values', () => {
    const d = createDiagnostics({ storage: localStorage });
    d.record('operation_error', { provider: 'sk-PRIVATE', status: 'PRIVATE', heapBytes: Infinity, errorType: 'PRIVATE' });
    expect(d.snapshot().events[0].metadata).toEqual({});
    expect(d.record('PRIVATE', {})).toBeNull();
  });
  it('bounds byte size and throttles an error storm without losing application control', () => {
    const d = createDiagnostics({ storage: localStorage, maxBytes: 1200, now: () => Date.UTC(2026, 9, 27) });
    for (let i = 0; i < 1000; i++) d.exception('uncaught_error', new Error('PRIVATE'));
    const snapshot = d.snapshot();
    expect(snapshot.droppedEvents).toBe(980);
    expect(new TextEncoder().encode(JSON.stringify(snapshot.events)).length).toBeLessThanOrEqual(1200);
    expect(safeFrames('at x (/private/secret-customer.js:1:2)')).toEqual([]);
    expect(safeFrames('at x (/assets/app-PRIVATE_CANARY.js:1:2)')).toEqual([]);
  });
});
