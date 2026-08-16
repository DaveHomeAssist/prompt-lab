const ENABLED_VALUES = new Set(['1', 'true', 'yes', 'on']);

export class ExternalFetchTimeoutError extends Error {
  constructor(service, timeoutMs) {
    super(`${service} request timed out after ${timeoutMs}ms.`);
    this.name = 'ExternalFetchTimeoutError';
    this.code = 'EXTERNAL_FETCH_TIMEOUT';
    this.status = 504;
  }
}

function readStringEnv(name, env = process.env) {
  const value = env[name];
  return typeof value === 'string' ? value.trim() : '';
}

export function isFeatureEnabled(name, {
  env = process.env,
  nonProductionDefault = true,
} = {}) {
  const configured = readStringEnv(name, env).toLowerCase();
  if (configured) return ENABLED_VALUES.has(configured);
  return readStringEnv('NODE_ENV', env) !== 'production' && nonProductionDefault;
}

export function readBoundedIntEnv(name, fallback, {
  env = process.env,
  min = 1,
  max = Number.MAX_SAFE_INTEGER,
} = {}) {
  const parsed = Number.parseInt(readStringEnv(name, env), 10);
  const value = Number.isFinite(parsed) ? parsed : fallback;
  return Math.min(max, Math.max(min, value));
}

export function readListEnv(name, fallback, { env = process.env } = {}) {
  const raw = env[name];
  if (!raw) return fallback;
  const parsed = String(raw)
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return parsed.length > 0 ? parsed : fallback;
}

export function isExternalFetchTimeout(error) {
  return error instanceof ExternalFetchTimeoutError || error?.code === 'EXTERNAL_FETCH_TIMEOUT';
}

function responseWithTimedBody(response, {
  abortPromise,
  controller,
  cleanup,
  getAbortError,
}) {
  if (!response.body) {
    cleanup();
    return response;
  }

  const reader = response.body.getReader();
  let finished = false;

  const finish = () => {
    if (finished) return;
    finished = true;
    cleanup();
  };

  const body = new ReadableStream({
    async pull(streamController) {
      try {
        const result = await Promise.race([reader.read(), abortPromise]);
        if (result.done) {
          finish();
          streamController.close();
          return;
        }
        streamController.enqueue(result.value);
      } catch (error) {
        finish();
        reader.cancel(error).catch(() => {});
        streamController.error(getAbortError() || error);
      }
    },
    async cancel(reason) {
      finish();
      if (!controller.signal.aborted) controller.abort(reason);
      await reader.cancel(reason).catch(() => {});
    },
  });

  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

export async function fetchWithTimeout(input, init = {}, {
  service = 'External service',
  timeoutMs = 5000,
} = {}) {
  const controller = new AbortController();
  const upstreamSignal = init?.signal;
  let abortError = null;
  let rejectAbort;
  let cleanedUp = false;

  const abortPromise = new Promise((_, reject) => {
    rejectAbort = reject;
  });
  // The initial fetch race handles this rejection even if the response body is
  // never consumed. This extra handler prevents a late abort from becoming an
  // unhandled rejection in runtimes that eagerly detach settled race handlers.
  abortPromise.catch(() => {});

  const abort = (error) => {
    if (abortError) return;
    abortError = error;
    controller.abort(error);
    rejectAbort(error);
  };
  const forwardAbort = () => abort(
    upstreamSignal?.reason || new DOMException('The operation was aborted.', 'AbortError'),
  );

  if (upstreamSignal?.aborted) {
    forwardAbort();
  } else {
    upstreamSignal?.addEventListener?.('abort', forwardAbort, { once: true });
  }

  const timeoutId = setTimeout(() => {
    abort(new ExternalFetchTimeoutError(service, timeoutMs));
  }, timeoutMs);
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    clearTimeout(timeoutId);
    upstreamSignal?.removeEventListener?.('abort', forwardAbort);
  };

  try {
    const response = await Promise.race([
      fetch(input, {
        ...init,
        signal: controller.signal,
      }),
      abortPromise,
    ]);
    return responseWithTimedBody(response, {
      abortPromise,
      controller,
      cleanup,
      getAbortError: () => abortError,
    });
  } catch (error) {
    cleanup();
    throw abortError || error;
  }
}
