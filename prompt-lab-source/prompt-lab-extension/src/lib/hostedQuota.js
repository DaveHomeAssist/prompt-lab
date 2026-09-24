/**
 * Hosted quota snapshot.
 *
 * The hosted proxy reports the caller's daily windows on every response it
 * serves (X-Demo-* for the per-IP demo cap, X-Global-* for the shared budget,
 * X-Hosted-Access for owner/standard). proxyFetch records them here so the UI
 * can show "2 of 3 left today" before a run instead of only after a 429.
 *
 * Only hosted web mode talks to /api/proxy, so nothing is ever recorded on the
 * desktop or extension surfaces and the badge stays hidden there.
 */

export const HOSTED_QUOTA_STORAGE_KEY = 'pl2-hosted-quota';
export const HOSTED_QUOTA_CHANGED = 'pl2-hosted-quota-changed';

let current;

function parseCount(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function parseResetAt(value) {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function readWindow(headers, prefix) {
  const remaining = parseCount(headers.get(`X-${prefix}-Remaining`));
  if (remaining == null) return null;
  return {
    remaining,
    limit: parseCount(headers.get(`X-${prefix}-Limit`)),
    resetAt: parseResetAt(headers.get(`X-${prefix}-Reset`)),
  };
}

function load() {
  if (current !== undefined) return current;
  current = null;
  try {
    const raw = globalThis.localStorage?.getItem(HOSTED_QUOTA_STORAGE_KEY);
    if (raw) current = JSON.parse(raw);
  } catch {
    current = null;
  }
  return current;
}

function notifyChanged() {
  try {
    globalThis.window?.dispatchEvent(new Event(HOSTED_QUOTA_CHANGED));
  } catch {
    // No window (tests, workers).
  }
}

function store(next) {
  current = next;
  try {
    globalThis.localStorage?.setItem(HOSTED_QUOTA_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Persistence is a convenience; the in-memory snapshot still drives the UI.
  }
  notifyChanged();
}

/** Record the quota headers from a hosted proxy response. */
export function recordHostedQuota(response, now = Date.now()) {
  const headers = response?.headers;
  if (typeof headers?.get !== 'function') return;

  const access = headers.get('X-Hosted-Access');
  const demo = readWindow(headers, 'Demo');
  const global = readWindow(headers, 'Global');

  if (access) {
    // The request reached the provider, so this header set is complete: a
    // missing window means it did not apply (owner access or a personal key).
    store({ access, demo, global, observedAt: now });
  } else if (demo || global) {
    // A proxy 429 carries only the window that tripped; keep the other.
    const previous = load();
    store({
      access: previous?.access ?? null,
      demo: demo ?? previous?.demo ?? null,
      global: global ?? previous?.global ?? null,
      observedAt: now,
    });
  }
}

function liveWindow(window, now) {
  if (!window) return null;
  const reset = Date.parse(window.resetAt || '');
  // A window whose reset has passed no longer describes the caller.
  if (Number.isFinite(reset) && reset <= now) return null;
  return window;
}

/**
 * The current snapshot with expired windows dropped, or null when there is
 * nothing to show (no hosted request yet, or a personal key is in use).
 */
export function getHostedQuota(now = Date.now()) {
  const snapshot = load();
  if (!snapshot) return null;
  const demo = liveWindow(snapshot.demo, now);
  const global = liveWindow(snapshot.global, now);
  if (!demo && !global && snapshot.access !== 'owner') return null;
  return { access: snapshot.access ?? null, demo, global };
}

/** The earliest future reset in the snapshot, so a view can refresh then. */
export function nextHostedQuotaReset(now = Date.now()) {
  const quota = getHostedQuota(now);
  const resets = [quota?.demo?.resetAt, quota?.global?.resetAt]
    .map((value) => Date.parse(value || ''))
    .filter((value) => Number.isFinite(value) && value > now);
  return resets.length ? Math.min(...resets) : null;
}

/**
 * Forget the snapshot. Saving provider settings can switch between the shared
 * hosted key and a personal key, so the last shared-key windows may no longer
 * apply; the next hosted response records the current state.
 */
export function clearHostedQuota() {
  current = null;
  try {
    globalThis.localStorage?.removeItem(HOSTED_QUOTA_STORAGE_KEY);
  } catch {
    // Nothing persisted to remove.
  }
  notifyChanged();
}

/** Reload from storage (another tab wrote) or clear. Test hook as well. */
export function resetHostedQuotaCache() {
  current = undefined;
}
