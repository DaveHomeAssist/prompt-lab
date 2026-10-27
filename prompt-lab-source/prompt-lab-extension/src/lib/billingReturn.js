// AUD-009: Stripe Checkout returns to /app/?billing=success or
// /app/?billing=cancelled (api/_lib/stripeBilling.js defaults; "cancel" and
// "canceled" are accepted too). The app reads the parameter once, removes it
// from the URL, then refreshes entitlement and tells the user what happened.
const SUCCESS_VALUES = new Set(['success']);
const CANCEL_VALUES = new Set(['cancel', 'canceled', 'cancelled']);

export const BILLING_RETURN_POLL_DELAYS_MS = Object.freeze([0, 2000, 5000, 10000]);

export function parseBillingReturn(search = '') {
  let params;
  try {
    params = new URLSearchParams(String(search).replace(/^\?/, ''));
  } catch {
    return null;
  }
  const value = String(params.get('billing') || '').trim().toLowerCase();
  if (SUCCESS_VALUES.has(value)) return 'success';
  if (CANCEL_VALUES.has(value)) return 'cancelled';
  return null;
}

export function stripBillingReturnParam(href) {
  try {
    const url = new URL(String(href));
    url.searchParams.delete('billing');
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return '';
  }
}

// Reads and removes ?billing=… from the current location. Returns the outcome
// ('success' | 'cancelled') or null. Safe outside a browser.
export function consumeBillingReturnFromLocation(win = typeof window !== 'undefined' ? window : null) {
  if (!win?.location) return null;
  const outcome = parseBillingReturn(win.location.search);
  if (!outcome) return null;
  const nextUrl = stripBillingReturnParam(win.location.href);
  if (nextUrl) {
    try {
      win.history?.replaceState?.(win.history.state, '', nextUrl);
    } catch {
      // The outcome is still handled once; only the URL cleanup is skipped.
    }
  }
  return outcome;
}

// Checkout and the portal open in a new tab. Browsers only allow that during
// the click itself, but the Stripe URL arrives after an awaited API call, so
// the web app opens a blank tab synchronously and points it at Stripe once the
// URL is known. Returns null when the browser blocked the tab.
export function shouldPreopenExternalTab() {
  return import.meta.env?.VITE_WEB_MODE === 'true';
}

export function preopenExternalTab(win = typeof window !== 'undefined' ? window : null) {
  if (!win || typeof win.open !== 'function') return null;
  try {
    return win.open('', '_blank') || null;
  } catch {
    return null;
  }
}

export function navigateExternalTab(tab, url) {
  if (!tab || tab.closed) return false;
  try {
    // Drop the opener before leaving about:blank so Stripe's page cannot
    // reach back into Prompt Lab (reverse tabnabbing).
    tab.opener = null;
    tab.location.replace(url);
    return true;
  } catch {
    return false;
  }
}

export function closeExternalTab(tab) {
  try {
    if (tab && !tab.closed) tab.close();
  } catch {
    // Nothing to clean up.
  }
}
