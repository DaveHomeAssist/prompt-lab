import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  on,
  emit,
  removeAllListeners,
  startRun,
  recordBlockedRun,
  setIdGenerator,
} from '../lib/runEmitter.js';

describe('runEmitter', () => {
  let idCounter;

  beforeEach(() => {
    removeAllListeners();
    idCounter = 0;
    setIdGenerator(() => `id-${++idCounter}`);
  });

  afterEach(() => {
    removeAllListeners();
  });

  // ── Basic event bus ─────────────────────────────────────────────

  it('on/emit dispatches events to subscribers', () => {
    const handler = vi.fn();
    on('run:start', handler);
    emit('run:start', { run_id: 'r1' });
    expect(handler).toHaveBeenCalledWith({ run_id: 'r1' });
  });

  it('unsubscribe removes the listener', () => {
    const handler = vi.fn();
    const unsub = on('run:start', handler);
    unsub();
    emit('run:start', { run_id: 'r1' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('removeAllListeners clears everything', () => {
    const h1 = vi.fn();
    const h2 = vi.fn();
    on('run:start', h1);
    on('run:end', h2);
    removeAllListeners();
    emit('run:start', {});
    emit('run:end', {});
    expect(h1).not.toHaveBeenCalled();
    expect(h2).not.toHaveBeenCalled();
  });

  it('listener errors do not break other listeners', () => {
    const bad = vi.fn(() => { throw new Error('boom'); });
    const good = vi.fn();
    on('run:start', bad);
    on('run:start', good);
    emit('run:start', { run_id: 'r1' });
    expect(bad).toHaveBeenCalled();
    expect(good).toHaveBeenCalled();
  });

  // ── startRun lifecycle ────────────────────────────────────────────

  it('startRun emits run:start with required fields', () => {
    const starts = [];
    on('run:start', (p) => starts.push(p));

    const ctx = startRun({
      run_type: 'enhance',
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
    });

    expect(starts).toHaveLength(1);
    const payload = starts[0];
    expect(payload.run_id).toBe('id-1');
    expect(payload.trace_id).toBe('id-2');
    expect(payload.parent_run_id).toBe(null);
    expect(payload.run_type).toBe('enhance');
    expect(payload.status).toBe('running');
    expect(payload.started_at).toBeGreaterThan(0);
    expect(payload.ended_at).toBe(null);
    expect(payload.provider).toBe('anthropic');
    expect(payload.model).toBe('claude-sonnet-4-20250514');

    // Context object has the IDs
    expect(ctx.run_id).toBe('id-1');
    expect(ctx.trace_id).toBe('id-2');
  });

  it('startRun.end() emits run:end with success status', () => {
    const ends = [];
    on('run:end', (p) => ends.push(p));

    const ctx = startRun({
      run_type: 'ab',
      provider: 'openai',
      model: 'gpt-4o',
    });

    const result = ctx.end({ output: 'some text' });

    expect(ends).toHaveLength(1);
    expect(result.status).toBe('success');
    expect(result.ended_at).toBeGreaterThan(0);
    expect(result.output).toBe('some text');
    expect(result.run_id).toBe(ctx.run_id);
    expect(result.trace_id).toBe(ctx.trace_id);
  });

  it('startRun.error() emits run:error with error details', () => {
    const errors = [];
    on('run:error', (p) => errors.push(p));

    const ctx = startRun({
      run_type: 'test-case',
      provider: 'ollama',
      model: 'llama3.2:3b',
    });

    const result = ctx.error(new Error('Connection refused'));

    expect(errors).toHaveLength(1);
    expect(result.status).toBe('error');
    expect(result.error).toBe('Connection refused');
    expect(result.ended_at).toBeGreaterThan(0);
  });

  // ── Trace boundaries ──────────────────────────────────────────────

  it('each startRun gets a unique trace unless one is provided', () => {
    const run1 = startRun({ run_type: 'ab', provider: 'anthropic', model: 'm' });
    const run2 = startRun({ run_type: 'ab', provider: 'anthropic', model: 'm' });

    expect(run1.trace_id).not.toBe(run2.trace_id);
  });

  it('shared trace_id links sibling runs (Run Both)', () => {
    const sharedTrace = 'shared-trace-id';
    const runA = startRun({ run_type: 'ab', provider: 'anthropic', model: 'm', trace_id: sharedTrace });
    const runB = startRun({ run_type: 'ab', provider: 'anthropic', model: 'm', trace_id: sharedTrace });

    expect(runA.trace_id).toBe(sharedTrace);
    expect(runB.trace_id).toBe(sharedTrace);
    expect(runA.run_id).not.toBe(runB.run_id);
  });

  it('retry_of links to the original run', () => {
    const starts = [];
    on('run:start', (p) => starts.push(p));

    const original = startRun({ run_type: 'enhance', provider: 'anthropic', model: 'm' });
    const retry = startRun({
      run_type: 'enhance',
      provider: 'anthropic',
      model: 'm',
      retry_of: original.run_id,
    });

    expect(starts[1].retry_of).toBe(original.run_id);
    expect(retry.trace_id).not.toBe(original.trace_id); // new trace for retry
  });

  // ── Blocked runs ──────────────────────────────────────────────────

  it('recordBlockedRun emits start+end with blocked status', () => {
    const starts = [];
    const ends = [];
    on('run:start', (p) => starts.push(p));
    on('run:end', (p) => ends.push(p));

    const result = recordBlockedRun({
      run_type: 'enhance',
      model: 'claude-sonnet-4-20250514',
      reason: 'PII detected',
    });

    expect(starts).toHaveLength(1);
    expect(ends).toHaveLength(1);
    expect(result.status).toBe('blocked');
    expect(result.provider).toBe('blocked');
    expect(result.reason).toBe('PII detected');
    expect(result.started_at).toBe(result.ended_at);
  });
});
