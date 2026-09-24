/**
 * Standardized error envelope for Prompt Lab.
 *
 * Every error that crosses a boundary (provider call, storage operation,
 * platform bridge) should be wrapped in an AppError so consumers get a
 * consistent shape: { category, userMessage, debugMessage, retryable, source }.
 *
 * Gateway callers should prefer the Result envelope exported here:
 *   { ok: true, data, error: null, meta? }
 *   { ok: false, data: null, error: AppError, meta? }
 */

/**
 * @template T
 * @typedef {Object} GatewaySuccess
 * @property {true} ok
 * @property {T} data
 * @property {null} error
 * @property {{ source?: string, operation?: string }} [meta]
 */

/**
 * @typedef {Object} GatewayFailure
 * @property {false} ok
 * @property {null} data
 * @property {AppError} error
 * @property {{ source?: string, operation?: string }} [meta]
 */

/**
 * @template T
 * @typedef {GatewaySuccess<T> | GatewayFailure} GatewayResult
 */

// ── Categories ──────────────────────────────────────────────────────
export const ErrorCategory = Object.freeze({
  AUTH:       'auth',        // missing or invalid API key
  RATE_LIMIT: 'rate_limit',  // 429 / quota exceeded
  NETWORK:    'network',     // fetch failed, timeout, DNS
  PROVIDER:   'provider',    // non-auth API error (400, 500, safety block)
  VALIDATION: 'validation',  // bad input before the call is made
  STORAGE:    'storage',     // localStorage / IndexedDB / chrome.storage
  PLATFORM:   'platform',    // shell/runtime mismatch
  UNKNOWN:    'unknown',
});

// Codes the hosted proxy (api/proxy.js LIMIT_CODES) attaches to its own 429s.
// These are Prompt Lab service limits, not provider rate limits.
export const HostedLimitCode = Object.freeze({
  BURST:  'hosted_burst_limit',   // per-IP requests per minute
  DEMO:   'hosted_demo_limit',    // per-IP shared-key requests per day
  GLOBAL: 'hosted_global_limit',  // service-wide shared-key requests per day
});

const HOSTED_LIMIT_CODES = new Set(Object.values(HostedLimitCode));
const HOSTED_SOURCE = 'prompt-lab';

// ── AppError ────────────────────────────────────────────────────────
export class AppError extends Error {
  /**
   * @param {object} opts
   * @param {string} opts.category     — one of ErrorCategory values
   * @param {string} opts.userMessage  — safe to show in a toast
   * @param {string} opts.debugMessage — detailed info for console/logs
   * @param {boolean} opts.retryable   — whether the caller should retry
   * @param {string} opts.source       — originating provider or subsystem
   * @param {number} [opts.status]     — HTTP status code if applicable
   * @param {string} [opts.code]       — machine-readable cause, e.g. a HostedLimitCode
   * @param {{ suggestions?: string[], actions?: string[] }} [opts.recovery]
   *   — cause-specific recovery that overrides the category defaults
   */
  constructor({ category, userMessage, debugMessage, retryable = false, source = '', status, code, recovery }) {
    super(userMessage);
    this.name = 'AppError';
    this.category = category;
    this.userMessage = userMessage;
    this.debugMessage = debugMessage || userMessage;
    this.retryable = retryable;
    this.source = source;
    if (status != null) this.status = status;
    if (code) this.code = code;
    if (recovery) this.recovery = recovery;
  }

  /** UI-facing recovery suggestions derived from category. */
  get suggestions() {
    if (this.recovery?.suggestions) return this.recovery.suggestions;
    switch (this.category) {
      case ErrorCategory.AUTH:
        return ['Check that the provider API key is present and valid.', 'Open provider settings and paste a fresh key.'];
      case ErrorCategory.RATE_LIMIT:
        return ['Wait briefly and retry.', 'Reduce request frequency or prompt size.'];
      case ErrorCategory.NETWORK:
        return ['Check internet connectivity and VPN/firewall settings.', 'Retry after connection stabilizes.'];
      case ErrorCategory.PROVIDER:
        return this.status >= 500
          ? ['The provider may be experiencing issues. Retry shortly.']
          : ['Retry the request.', 'Check provider status and settings.'];
      case ErrorCategory.VALIDATION:
        return ['Check your input and try again.'];
      default:
        return ['Retry the request.', 'Check provider status and settings.'];
    }
  }

  /** UI-facing action tokens consumed by error panel buttons. */
  get actions() {
    if (this.recovery?.actions) return this.recovery.actions;
    switch (this.category) {
      case ErrorCategory.AUTH:
        return ['open_provider_settings'];
      case ErrorCategory.RATE_LIMIT:
      case ErrorCategory.NETWORK:
        return ['retry'];
      case ErrorCategory.PROVIDER:
        return this.retryable ? ['retry', 'open_provider_settings'] : ['open_provider_settings'];
      default:
        return this.retryable ? ['retry'] : [];
    }
  }
}

// ── Factories ───────────────────────────────────────────────────────

export function authError(source, detail) {
  return new AppError({
    category: ErrorCategory.AUTH,
    userMessage: `No ${source} API key set. Open Settings to add one.`,
    debugMessage: detail || `Missing API key for ${source}`,
    retryable: false,
    source,
  });
}

/**
 * A provider 429. Not auto-retried: an immediate retry lands inside the same
 * window, and on hosted Prompt Lab each attempt also spends the caller's
 * hosted quota. The recovery panel still offers a manual Try Again.
 */
export function rateLimitError(source, detail) {
  return new AppError({
    category: ErrorCategory.RATE_LIMIT,
    userMessage: `${source} rate limit hit — wait a moment and retry.`,
    debugMessage: detail || `429 from ${source}`,
    retryable: false,
    source,
  });
}

/**
 * Describe when a limit resets, relative to now: "in 40 seconds",
 * "in about 5 minutes", "in about 23 hours". Empty when the time is unknown.
 */
export function formatResetHint(resetAt, now = Date.now()) {
  const target = Date.parse(resetAt);
  if (!Number.isFinite(target)) return '';
  const diffMs = target - now;
  if (diffMs <= 0) return 'in a moment';
  const seconds = Math.ceil(diffMs / 1000);
  if (seconds < 60) return `in ${seconds} second${seconds === 1 ? '' : 's'}`;
  const minutes = Math.ceil(diffMs / 60_000);
  if (minutes < 60) return `in about ${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.round(minutes / 60);
  return `in about ${hours} hour${hours === 1 ? '' : 's'}`;
}

const NOT_PROVIDER = 'This is a Prompt Lab limit, not an Anthropic one.';
const ADD_OWN_KEY = 'Add your own Anthropic API key in Provider Settings to keep going now.';

/**
 * A hosted-service limit enforced by Prompt Lab's own proxy. Retrying within
 * the window cannot succeed, so these are never auto-retried.
 */
export function hostedLimitError(code, { detail, limit, resetAt, now = Date.now() } = {}) {
  const hint = formatResetHint(resetAt, now);
  const hasLimit = Number.isFinite(limit) && limit > 0;
  let userMessage;
  let recovery;

  if (code === HostedLimitCode.DEMO) {
    const cap = hasLimit ? ` (${limit} request${limit === 1 ? '' : 's'} per day)` : ' for today';
    userMessage = `Prompt Lab's free hosted demo limit is used up${cap}. ${NOT_PROVIDER}${hint ? ` It resets ${hint}.` : ''}`;
    recovery = {
      suggestions: [ADD_OWN_KEY, hint ? `Or wait until it resets ${hint}.` : 'Or wait for the daily reset.'],
      actions: ['open_provider_settings'],
    };
  } else if (code === HostedLimitCode.GLOBAL) {
    userMessage = `Prompt Lab's shared hosted budget for today is used up. ${NOT_PROVIDER}${hint ? ` It resets ${hint}.` : ''}`;
    recovery = {
      suggestions: [ADD_OWN_KEY, hint ? `Or wait until it resets ${hint}.` : 'Or wait for the daily reset.'],
      actions: ['open_provider_settings'],
    };
  } else {
    const cap = hasLimit ? ` (limit ${limit})` : '';
    userMessage = `Too many requests to Prompt Lab's hosted service in the last minute${cap}. ${NOT_PROVIDER}${hint ? ` You can try again ${hint}.` : ''}`;
    recovery = {
      suggestions: [hint ? `Try again ${hint}.` : 'Wait about a minute, then try again.', 'Close other Prompt Lab tabs that are sending requests.'],
      actions: ['retry'],
    };
  }

  return new AppError({
    category: ErrorCategory.RATE_LIMIT,
    userMessage,
    debugMessage: detail || `429 ${code} from Prompt Lab hosted proxy`,
    retryable: false,
    source: HOSTED_SOURCE,
    status: 429,
    code,
    recovery,
  });
}

export function networkError(source, detail) {
  return new AppError({
    category: ErrorCategory.NETWORK,
    userMessage: `Could not reach ${source}. Check your connection.`,
    debugMessage: detail || `Network failure for ${source}`,
    retryable: true,
    source,
  });
}

export function providerError(source, status, detail, userMsg) {
  return new AppError({
    category: ErrorCategory.PROVIDER,
    userMessage: userMsg || `${source} request failed (${status}).`,
    debugMessage: detail || `${source} returned ${status}`,
    retryable: status >= 500,
    source,
    status,
  });
}

export function validationError(source, detail) {
  return new AppError({
    category: ErrorCategory.VALIDATION,
    userMessage: detail,
    debugMessage: detail,
    retryable: false,
    source,
  });
}

export function storageError(source, detail) {
  return new AppError({
    category: ErrorCategory.STORAGE,
    userMessage: 'Storage operation failed.',
    debugMessage: detail || `Storage failure in ${source}`,
    retryable: false,
    source,
  });
}

export function platformError(source, detail) {
  return new AppError({
    category: ErrorCategory.PLATFORM,
    userMessage: 'Platform integration failed.',
    debugMessage: detail || `Platform failure in ${source}`,
    retryable: false,
    source,
  });
}

export function unknownError(source, detail) {
  return new AppError({
    category: ErrorCategory.UNKNOWN,
    userMessage: 'An unexpected error occurred.',
    debugMessage: detail || `Unknown failure in ${source}`,
    retryable: false,
    source,
  });
}

// ── Classifier ──────────────────────────────────────────────────────

/**
 * Wrap a raw error into an AppError if it isn't one already.
 * Classifies by message heuristics to stay backward-compatible.
 */
export function normalizeError(err, source = 'unknown') {
  if (err instanceof AppError) return err;

  const rawMessage = err?.message || String(err);
  const msg = rawMessage.toLowerCase();
  const status = err?.status;

  // Hosted proxy limits carry an explicit code. Classify them before the
  // message heuristics so they are never reported as a provider rate limit.
  if (HOSTED_LIMIT_CODES.has(err?.code)) {
    return hostedLimitError(err.code, { detail: rawMessage, limit: err.limit, resetAt: err.resetAt });
  }

  // Auth
  if (msg.includes('api key') || msg.includes('unauthorized') || status === 401 || status === 403) {
    return authError(source, err?.message);
  }

  // Rate limit
  if (msg.includes('429') || msg.includes('rate') || msg.includes('quota')) {
    return rateLimitError(source, err?.message);
  }

  // Network
  if (
    msg.includes('failed to fetch')
    || msg.includes('network')
    || msg.includes('timeout')
    || msg.includes('dns')
    || msg.includes('econnrefused')
    || (msg.includes('stream') && (msg.includes('aborted') || msg.includes('terminated')))
  ) {
    return networkError(source, rawMessage);
  }

  if (msg.includes('storage') || msg.includes('indexeddb') || (msg.includes('quota') && msg.includes('local'))) {
    return storageError(source, rawMessage);
  }

  if (msg.includes('extension mode') || msg.includes('options page') || msg.includes('desktop api')) {
    return platformError(source, rawMessage);
  }

  // Provider HTTP error — extract status from message like "failed (429)"
  const statusMatch = msg.match(/\((\d{3})\)/);
  const httpStatus = status || (statusMatch ? Number(statusMatch[1]) : undefined);
  if (httpStatus) {
    if (httpStatus === 429) return rateLimitError(source, rawMessage);
    if (httpStatus === 401 || httpStatus === 403) return authError(source, rawMessage);
    return providerError(source, httpStatus, rawMessage);
  }

  // Fallback
  return unknownError(source, err?.stack || rawMessage);
}

// ── Helpers ─────────────────────────────────────────────────────────

/** Drop-in replacement for isTransientError that works with AppError or raw Error. */
export function isRetryable(err) {
  if (err instanceof AppError) return err.retryable;
  // Fallback heuristic for raw errors (backward compat). Rate limits are
  // deliberately absent: see rateLimitError.
  const msg = (err?.message || String(err)).toLowerCase();
  return msg.includes('timeout')
    || msg.includes('network')
    || msg.includes('failed to fetch')
    || msg.includes('temporar');
}

/** Extract the user-safe message from any error. */
export function getUserMessage(err) {
  if (err instanceof AppError) return err.userMessage;
  return err?.message || 'An unexpected error occurred.';
}

/**
 * Build a success Result envelope for a gateway boundary.
 *
 * @template T
 * @param {T} data
 * @param {{ source?: string, operation?: string }} [meta]
 * @returns {GatewaySuccess<T>}
 */
export function ok(data, meta) {
  return { ok: true, data, error: null, meta };
}

/**
 * Build a failure Result envelope for a gateway boundary.
 *
 * @param {*} error
 * @param {{ source?: string, operation?: string }} [meta]
 * @returns {GatewayFailure}
 */
export function fail(error, meta) {
  return { ok: false, data: null, error: normalizeError(error, meta?.source), meta };
}

/**
 * Convert a possibly-throwing async gateway call into a Result envelope.
 *
 * @template T
 * @param {Promise<T> | (() => Promise<T>)} task
 * @param {{ source?: string, operation?: string }} [meta]
 * @returns {Promise<GatewayResult<T>>}
 */
export async function toResult(task, meta) {
  try {
    const data = typeof task === 'function' ? await task() : await task;
    return ok(data, meta);
  } catch (error) {
    return fail(error, meta);
  }
}
