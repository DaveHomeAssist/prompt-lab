import { APP_VERSION } from '../constants.js';

export const DIAGNOSTIC_KEY = 'pl2-diagnostics-v1';
export const MAX_AGE_MS = 7 * 86400_000;
export const EVENT_CODES = new Set([
  'session_start', 'session_end', 'renderer_ready', 'react_error', 'uncaught_error',
  'unhandled_rejection', 'storage_warning', 'storage_error', 'operation_start',
  'operation_end', 'operation_error', 'operation_cancel', 'report_preview', 'report_export',
]);
const providers = new Set(['anthropic', 'openai', 'gemini', 'openrouter', 'ollama', 'unknown']);
const operations = new Set(['model', 'enhance', 'test', 'storage', 'report', 'unknown']);
const errorTypes = new Set(['Error', 'TypeError', 'RangeError', 'SyntaxError', 'AbortError', 'QuotaExceededError', 'SecurityError', 'UnknownError']);
const revision = typeof __PL_BUILD_REVISION__ === 'string' ? __PL_BUILD_REVISION__ : 'unknown';
const uuid = () => globalThis.crypto?.randomUUID?.() || `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
const bytes = value => new TextEncoder().encode(JSON.stringify(value)).length;
const appFrames = new Set(['App.jsx', 'main.jsx', 'main-web.jsx', 'main-desktop.jsx', 'ErrorBoundary.jsx', 'ReportProblemHost.jsx', 'diagnostics.js', 'desktopApi.js', 'logger.js', 'useExecutionFlow.js', 'useExecutionFlow.jsx']);
export function registerDiagnosticSource(url) {
  // Called with import.meta.url by application modules, never with error text.
  try { appFrames.add(new URL(url).pathname.split('/').pop()); } catch { /* Ignore unavailable module location. */ }
}
registerDiagnosticSource(import.meta.url);
const applicationFrame = name => appFrames.has(name);

export function safeFrames(stack) {
  // Messages, function names, domains, directories and query strings are omitted.
  return typeof stack === 'string'
    ? [...stack.matchAll(/(?:^|[\\/\s(])([A-Za-z0-9_.-]+\.(?:[cm]?js|jsx|tsx|ts)):(\d{1,7}):(\d{1,7})/gm)]
      .filter(match => applicationFrame(match[1])).slice(0, 12).map(match => `${match[1]}:${match[2]}:${match[3]}`)
    : [];
}

export function safeMetadata(input = {}) {
  const output = {};
  for (const key of ['durationMs', 'status', 'heapBytes', 'gapMs']) {
    if (typeof input?.[key] === 'number' && Number.isFinite(input[key]) && input[key] >= 0) output[key] = Math.min(input[key], Number.MAX_SAFE_INTEGER);
  }
  if (typeof input?.visible === 'boolean') output.visible = input.visible;
  if (providers.has(input?.provider)) output.provider = input.provider;
  if (operations.has(input?.operation)) output.operation = input.operation;
  if (errorTypes.has(input?.errorType)) output.errorType = input.errorType;
  return output;
}

export function createDiagnostics({ storage, native, now = Date.now, maxEvents = 1000, maxBytes = 1024 * 1024, surface = 'browser' } = {}) {
  const sessionId = uuid();
  const warnings = new Set();
  if (!storage) warnings.add('Browser diagnostic storage is unavailable; this session is held in memory.');
  let events = [];
  let rateSecond = -1, rateCount = 0, droppedEvents = 0;
  const prune = () => {
    events = events.filter(event => now() - Date.parse(event.timestamp) <= MAX_AGE_MS && Date.parse(event.timestamp) <= now());
    while (events.length > maxEvents || (events.length && bytes(events) > maxBytes)) events.shift();
  };
  try {
    const stored = JSON.parse(storage?.getItem(DIAGNOSTIC_KEY) || '[]');
    if (Array.isArray(stored)) events = stored.slice(-maxEvents).filter(event => EVENT_CODES.has(event?.code)).map(event => ({
      schemaVersion: 1, severity: /error|rejection/.test(event.code) ? 'error' : /warning/.test(event.code) ? 'warning' : 'info',
      eventId: /^[a-f0-9-]{8,64}$/i.test(event.eventId) ? event.eventId : uuid(), sessionId: /^[a-f0-9-]{8,64}$/i.test(event.sessionId) ? event.sessionId : 'previous',
      ...(/^[a-f0-9-]{8,64}$/i.test(event.operationId) ? { operationId: event.operationId } : {}),
      timestamp: new Date(Number.isFinite(Date.parse(event.timestamp)) ? Date.parse(event.timestamp) : 0).toISOString(),
      timestampMs: Number.isFinite(Date.parse(event.timestamp)) ? Date.parse(event.timestamp) : 0,
      code: event.code, version: /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(event.version) ? event.version : 'unknown', revision: /^[a-f0-9]{7,40}$/i.test(event.revision) ? event.revision : 'unknown',
      surface, metadata: safeMetadata(event.metadata), frames: safeFrames((event.frames || []).join('\n')),
    }));
  } catch { warnings.add('Previous browser diagnostic storage could not be read.'); }
  prune();
  const record = (code, metadata = {}, operationId, frames = []) => {
    if (!EVENT_CODES.has(code)) return null;
    const second = Math.floor(now() / 1000);
    if (rateSecond !== second) { rateSecond = second; rateCount = 0; }
    if (++rateCount > 20) { droppedEvents++; return null; }
    const severity = /error|rejection/.test(code) ? 'error' : /warning/.test(code) ? 'warning' : 'info';
    const event = { schemaVersion: 1, severity, eventId: uuid(), timestamp: new Date(now()).toISOString(), timestampMs: now(), sessionId,
      version: APP_VERSION, revision, surface, code, metadata: safeMetadata(metadata), frames: safeFrames(frames.join('\n')) };
    if (/^[a-f0-9-]{8,64}$/i.test(operationId)) event.operationId = operationId;
    events.push(event); prune();
    try { storage?.setItem(DIAGNOSTIC_KEY, JSON.stringify(events)); }
    catch { warnings.add('Browser diagnostic storage is unavailable; this session is held in memory.'); }
    try { Promise.resolve(native?.record?.(event)).catch(() => warnings.add('Native diagnostic write failed.')); }
    catch { warnings.add('Native diagnostic write failed.'); }
    return event;
  };
  const exception = (code, error) => record(code, { errorType: errorTypes.has(error?.name) ? error.name : 'UnknownError' }, undefined, safeFrames(error?.stack));
  const begin = (operation, metadata = {}) => {
    const id = uuid(); const started = now(); let finished = false;
    record('operation_start', { ...metadata, operation }, id);
    return (code = 'operation_end', result = {}) => {
      if (finished) return;
      finished = true;
      record(['operation_end', 'operation_error', 'operation_cancel'].includes(code) ? code : 'operation_error',
        { ...metadata, ...result, operation, durationMs: Math.max(0, now() - started) }, id);
    };
  };
  const snapshot = () => {
    prune();
    return { schemaVersion: 1, version: APP_VERSION, revision, surface, sessionId, events: structuredClone(events), droppedEvents, warnings: [...warnings] };
  };
  return { record, exception, begin, snapshot };
}

let singleton;
export function diagnostics() {
  if (!singleton) {
    let storage;
    try { storage = globalThis.localStorage; } catch { /* Report retains in-memory events. */ }
    singleton = createDiagnostics({ storage, native: globalThis.PromptLabDiagnosticsNative,
      surface: globalThis.PromptLabDiagnosticsNative ? 'desktop' : globalThis.chrome?.runtime?.id ? 'extension' : 'web' });
  }
  return singleton;
}

let started = false;
export function startDiagnostics() {
  if (started || typeof window === 'undefined') return;
  started = true;
  const d = diagnostics();
  d.record('session_start');
  window.addEventListener('error', event => d.exception('uncaught_error', event.error));
  window.addEventListener('unhandledrejection', event => d.exception('unhandled_rejection', event.reason));
  window.addEventListener('pagehide', () => d.record('session_end'));
  let heartbeatPending = false;
  const heartbeat = () => {
    if (heartbeatPending || !globalThis.PromptLabDiagnosticsNative) return;
    heartbeatPending = true;
    const heap = performance.memory?.usedJSHeapSize;
    Promise.resolve(globalThis.PromptLabDiagnosticsNative.heartbeat({ visible: document.visibilityState === 'visible',
      heapBytes: Number.isFinite(heap) ? heap : null })).catch(() => {}).finally(() => { heartbeatPending = false; });
  };
  heartbeat();
  window.setInterval(heartbeat, 2000);
  document.addEventListener('visibilitychange', heartbeat);
  d.record('renderer_ready');
}

export function openProblemReport() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('promptlab:report-problem'));
}

export async function collectReport(description = '') {
  const reportId = uuid();
  diagnostics().record('report_preview');
  const report = { reportId, createdAt: new Date().toISOString(), description: String(description).slice(0, 4000),
    ...diagnostics().snapshot(), resourceCoverage: 'Renderer JavaScript heap where available; native host and renderer process CPU/RSS are not sampled automatically.' };
  if (globalThis.PromptLabDiagnosticsNative) {
    let timeout;
    try { report.native = await Promise.race([globalThis.PromptLabDiagnosticsNative.read(), new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('timeout')), 3000); })]); }
    catch { report.warnings.push('Native evidence could not be read; report is incomplete.'); }
    finally { clearTimeout(timeout); }
  }
  return globalThis.PromptLabDiagnosticsNative?.prepare ? globalThis.PromptLabDiagnosticsNative.prepare(report) : report;
}
