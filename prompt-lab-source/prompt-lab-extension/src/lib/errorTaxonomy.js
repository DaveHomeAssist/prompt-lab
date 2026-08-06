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
   */
  constructor({ category, userMessage, debugMessage, retryable = false, source = '', status }) {
    super(userMessage);
    this.name = 'AppError';
    this.category = category;
    this.userMessage = userMessage;
    this.debugMessage = debugMessage || userMessage;
    this.retryable = retryable;
    this.source = source;
    if (status != null) this.status = status;
  }

  /** UI-facing recovery suggestions derived from category. */
  get suggestions() {
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

export function rateLimitError(source, detail) {
  return new AppError({
    category: ErrorCategory.RATE_LIMIT,
    userMessage: `${source} rate limit hit — wait a moment and retry.`,
    debugMessage: detail || `429 from ${source}`,
    retryable: true,
    source,
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

  // Auth
  if (msg.includes('api key') || msg.includes('unauthorized') || status === 401 || status === 403) {
    return authError(source, err?.message);
  }

  // Rate limit
  if (msg.includes('429') || msg.includes('rate') || msg.includes('quota')) {
    return rateLimitError(source, err?.message);
  }

  // Network
  if (msg.includes('failed to fetch') || msg.includes('network') || msg.includes('timeout') || msg.includes('dns') || msg.includes('econnrefused')) {
    return networkError(source, rawMessage);
  }

  if (msg.includes('storage') || msg.includes('indexeddb') || (msg.includes('quota') && msg.includes('local'))) {
    return storageError(source, rawMessage);
  }

  if (msg.includes('extension mode') || msg.includes('options page') || msg.includes('desktop api')) {
    return platformError(source, rawMessage);
  }

  if (source === 'ollama' && msg.includes('empty content')) {
    return providerError(
      source,
      502,
      rawMessage,
      'Ollama returned no text. Increase the generation limit or choose another model.',
    );
  }

  // Provider HTTP error — extract status from message like "failed (429)"
  const statusMatch = msg.match(/\((\d{3})\)/);
  const httpStatus = status || (statusMatch ? Number(statusMatch[1]) : undefined);
  if (httpStatus) {
    if (httpStatus === 429) return rateLimitError(source, rawMessage);
    if (httpStatus === 401 || httpStatus === 403) return authError(source, rawMessage);
    if (source === 'ollama' && (msg.includes('out-of-memory') || msg.includes('out of memory') || msg.includes('failed to allocate'))) {
      return providerError(
        source,
        httpStatus,
        rawMessage,
        'Ollama ran out of memory. Choose a smaller model or lower the context length.',
      );
    }
    if (source === 'ollama' && httpStatus === 404) {
      return providerError(
        source,
        httpStatus,
        rawMessage,
        'Ollama model unavailable. Refresh models or choose an installed model.',
      );
    }
    return providerError(source, httpStatus, rawMessage);
  }

  // Fallback
  return unknownError(source, err?.stack || rawMessage);
}

// ── Helpers ─────────────────────────────────────────────────────────

/** Drop-in replacement for isTransientError that works with AppError or raw Error. */
export function isRetryable(err) {
  if (err instanceof AppError) return err.retryable;
  // Fallback heuristic for raw errors (backward compat)
  const msg = (err?.message || String(err)).toLowerCase();
  return msg.includes('429')
    || msg.includes('rate')
    || msg.includes('timeout')
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
