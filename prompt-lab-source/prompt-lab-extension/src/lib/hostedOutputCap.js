export const HOSTED_OUTPUT_CAP_STORAGE_KEY = 'pl2-hosted-output-cap';

let current;

function readStored() {
  if (current !== undefined) return current;
  current = null;
  try {
    const raw = globalThis.localStorage?.getItem(HOSTED_OUTPUT_CAP_STORAGE_KEY);
    if (raw) current = JSON.parse(raw);
  } catch {
    current = null;
  }
  return current;
}

function store(next) {
  current = next;
  try {
    if (next) globalThis.localStorage?.setItem(HOSTED_OUTPUT_CAP_STORAGE_KEY, JSON.stringify(next));
    else globalThis.localStorage?.removeItem(HOSTED_OUTPUT_CAP_STORAGE_KEY);
  } catch {
    // Storage is advisory. The in-memory value remains useful for this session.
  }
}

export function requestedMaxTokens(body) {
  try {
    const parsed = typeof body === 'string' ? JSON.parse(body) : body;
    const nested = typeof parsed?.body === 'string' ? JSON.parse(parsed.body) : parsed?.body;
    const value = Number(nested?.max_tokens ?? parsed?.max_tokens);
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
  } catch {
    return null;
  }
}

export function recordHostedOutputCap(response, requested) {
  if (response?.ok === false) return;
  const requestedTokens = Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : null;
  const header = response?.headers?.get?.('X-Hosted-Max-Tokens');
  const cap = Number(header);
  if (!requestedTokens || !Number.isFinite(cap) || cap <= 0) return;
  if (cap < requestedTokens) store({ cap, requested: requestedTokens, observedAt: Date.now() });
  else if (readStored()) store(null);
}

export function getHostedOutputCap() {
  return readStored()?.cap ?? null;
}
