/**
 * Run Emitter — lightweight event bus for run lifecycle events.
 *
 * Trace boundary (v1): one user-triggered send/run action = one trace.
 *   - editor Enhance = one trace
 *   - A/B Run A / Run B = one trace each
 *   - Run Both = two sibling traces
 *   - test case run = one trace
 *   - retry = new trace with retry_of
 *   - child spans come later for tool calls / substeps
 *
 * Events:
 *   run:start  — emitted when a run begins
 *   run:end    — emitted when a run completes successfully
 *   run:error  — emitted when a run fails
 *
 * Required fields on every event payload:
 *   run_id, trace_id, parent_run_id, run_type, status,
 *   started_at, ended_at, provider, model
 */

// ── Event bus ───────────────────────────────────────────────────────

const listeners = new Map();

/**
 * Subscribe to a run lifecycle event.
 * @param {'run:start' | 'run:end' | 'run:error'} event
 * @param {(payload: RunEvent) => void} handler
 * @returns {() => void} unsubscribe function
 */
export function on(event, handler) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(handler);
  return () => listeners.get(event)?.delete(handler);
}

/**
 * Emit a run lifecycle event.
 * @param {'run:start' | 'run:end' | 'run:error'} event
 * @param {RunEvent} payload
 */
export function emit(event, payload) {
  const handlers = listeners.get(event);
  if (!handlers) return;
  for (const handler of handlers) {
    try {
      handler(payload);
    } catch {
      // Listeners must not break the emitter
    }
  }
}

/**
 * Remove all listeners (useful for tests).
 */
export function removeAllListeners() {
  listeners.clear();
}

// ── Run lifecycle helpers ───────────────────────────────────────────

let _generateId = () => crypto.randomUUID();

/**
 * Override the ID generator (for testing).
 */
export function setIdGenerator(fn) {
  _generateId = fn;
}

/**
 * Create a new trace ID.
 */
export function newTraceId() {
  return _generateId();
}

/**
 * Create a new run ID.
 */
export function newRunId() {
  return _generateId();
}

/**
 * Start a run. Emits `run:start` and returns a context object
 * with `end()` and `error()` methods.
 *
 * @param {object} opts
 * @param {string} opts.run_type - 'enhance' | 'ab' | 'test-case'
 * @param {string} opts.provider
 * @param {string} opts.model
 * @param {string} [opts.trace_id] - reuse an existing trace, or auto-generate
 * @param {string} [opts.parent_run_id] - parent run for nested spans
 * @param {string} [opts.retry_of] - run_id of the run this retries
 * @returns {{ run_id: string, trace_id: string, end: (extra?) => RunEvent, error: (err, extra?) => RunEvent }}
 */
export function startRun({
  run_type,
  provider,
  model,
  trace_id,
  parent_run_id = null,
  retry_of = null,
}) {
  const run_id = newRunId();
  const traceId = trace_id || newTraceId();
  const started_at = Date.now();

  const startPayload = {
    run_id,
    trace_id: traceId,
    parent_run_id,
    retry_of,
    run_type,
    status: 'running',
    started_at,
    ended_at: null,
    provider,
    model,
  };

  emit('run:start', startPayload);

  return {
    run_id,
    trace_id: traceId,

    /**
     * Mark the run as successfully completed.
     */
    end(extra = {}) {
      const payload = {
        ...startPayload,
        ...extra,
        status: 'success',
        ended_at: Date.now(),
      };
      emit('run:end', payload);
      return payload;
    },

    /**
     * Mark the run as failed.
     */
    error(err, extra = {}) {
      const payload = {
        ...startPayload,
        ...extra,
        status: 'error',
        ended_at: Date.now(),
        error: err?.message || String(err),
      };
      emit('run:error', payload);
      return payload;
    },
  };
}

// ── Convenience: blocked run (PII gate, etc.) ───────────────────────

/**
 * Record a run that was blocked before it started (e.g. PII gate).
 * Emits both `run:start` and `run:end` with status 'blocked'.
 */
export function recordBlockedRun({ run_type, provider = 'blocked', model, reason, trace_id, parent_run_id = null }) {
  const run_id = newRunId();
  const traceId = trace_id || newTraceId();
  const now = Date.now();

  const payload = {
    run_id,
    trace_id: traceId,
    parent_run_id,
    retry_of: null,
    run_type,
    status: 'blocked',
    started_at: now,
    ended_at: now,
    provider,
    model: model || 'unknown',
    reason,
  };

  emit('run:start', payload);
  emit('run:end', payload);
  return payload;
}
