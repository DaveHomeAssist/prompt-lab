const DEFAULT_BILLING_TIMEOUT_MS = 4000;

function readStringEnv(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

export function getBillingTimeoutMs() {
  const rawValue = readStringEnv('PROMPTLAB_BILLING_TIMEOUT_MS', 'BILLING_REQUEST_TIMEOUT_MS');
  const parsed = Number.parseInt(rawValue, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_BILLING_TIMEOUT_MS;
}

export function createBillingTimeoutError(message = 'Billing request timed out.') {
  const error = new Error(message);
  error.name = 'BillingTimeoutError';
  error.code = 'BILLING_TIMEOUT';
  return error;
}

export function isBillingTimeoutError(error) {
  return error?.name === 'BillingTimeoutError' || error?.code === 'BILLING_TIMEOUT';
}

export async function withTimeout(
  promiseOrFactory,
  {
    timeoutMs = getBillingTimeoutMs(),
    timeoutMessage = 'Billing request timed out.',
  } = {},
) {
  let timeoutId = null;
  const promise =
    typeof promiseOrFactory === 'function'
      ? promiseOrFactory()
      : promiseOrFactory;

  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(createBillingTimeoutError(timeoutMessage)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export async function fetchWithTimeout(
  url,
  init = {},
  {
    timeoutMs = getBillingTimeoutMs(),
    timeoutMessage = 'Billing request timed out.',
  } = {},
) {
  const controller = new AbortController();
  const upstreamSignal = init.signal;
  let abortListener = null;
  let timeoutId = null;

  if (upstreamSignal) {
    if (upstreamSignal.aborted) {
      controller.abort(upstreamSignal.reason);
    } else {
      abortListener = () => controller.abort(upstreamSignal.reason);
      upstreamSignal.addEventListener('abort', abortListener, { once: true });
    }
  }

  try {
    return await Promise.race([
      fetch(url, {
        ...init,
        signal: controller.signal,
      }),
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          controller.abort();
          reject(createBillingTimeoutError(timeoutMessage));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    if (abortListener) upstreamSignal.removeEventListener('abort', abortListener);
  }
}
