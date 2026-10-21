import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BILLING_STATUS_VERIFICATION_EXPIRED,
  canAccessFeature,
  areFeatureGatesActive,
  createOwnerBillingState,
  createDefaultBillingState,
  describeBillingStatus,
  getBillingApiBase,
  getPlanLabel,
  isOwnerProState,
  isOwnerAccessAvailable,
  normalizeBillingState,
} from '../lib/billing.js';
import {
  BILLING_OFFLINE_GRACE_MS,
  BILLING_REVALIDATE_AFTER_MS,
  BILLING_REVALIDATE_CHECK_INTERVAL_MS,
} from '../lib/billingPolicy.js';
import { loadJson, saveJson, storageKeys } from '../lib/storage.js';
import {
  BILLING_RETURN_POLL_DELAYS_MS,
  closeExternalTab,
  consumeBillingReturnFromLocation,
  navigateExternalTab,
  preopenExternalTab,
  shouldPreopenExternalTab,
} from '../lib/billingReturn.js';

const CHECKOUT_UNAVAILABLE_MESSAGE = 'Purchases are temporarily unavailable. Existing purchase management is still available.';
const AUTO_SYNC_RETRY_BASE_MS = 5000;
const BLOCKED_TAB_MESSAGES = {
  checkout: 'Your browser blocked the Stripe Checkout tab. Use "Continue to Stripe Checkout" in the billing dialog.',
  portal: 'Your browser blocked the billing portal tab. Use "Open billing portal" in the billing dialog.',
};

// Opens a Stripe URL that arrived after an await. With a pre-opened tab (web
// app) the tab is pointed at Stripe; otherwise a direct window.open is tried.
// Returns true when a tab was opened, false when the browser blocked it.
function openStripeUrl(preopenedTab, url, preopenAttempted) {
  if (preopenedTab) return navigateExternalTab(preopenedTab, url);
  // The click-time tab was blocked; a second window.open after the await
  // would be blocked too, so go straight to the visible fallback link.
  if (preopenAttempted) return false;
  if (typeof window === 'undefined' || typeof window.open !== 'function') return false;
  window.open(url, '_blank', 'noopener,noreferrer');
  // With noopener the return value is always null, so a blocked tab cannot be
  // detected on this path; only the web app (pre-opened tab) can tell.
  return true;
}

function readClerkEmail(clerkUser) {
  const directEmail = clerkUser?.primaryEmailAddress?.emailAddress;
  if (typeof directEmail === 'string' && directEmail.trim()) return directEmail.trim();

  const primaryId = typeof clerkUser?.primaryEmailAddressId === 'string'
    ? clerkUser.primaryEmailAddressId
    : '';
  const emailAddresses = Array.isArray(clerkUser?.emailAddresses) ? clerkUser.emailAddresses : [];
  const primaryEmail = emailAddresses.find((item) => item?.id === primaryId)?.emailAddress;
  if (typeof primaryEmail === 'string' && primaryEmail.trim()) return primaryEmail.trim();

  const firstEmail = emailAddresses.find((item) => typeof item?.emailAddress === 'string' && item.emailAddress.trim())?.emailAddress;
  return typeof firstEmail === 'string' ? firstEmail.trim() : '';
}

function shouldRevalidate(state) {
  if (state.status === 'owner') return false;
  // Keep parity with refreshLicense: a Clerk user id alone (e.g. GitHub login
  // with a private email) is enough identity to revalidate against.
  if (!state.customerEmail && !state.customerId && !state.clerkUserId) return false;
  const lastValidated = Date.parse(state.lastValidatedAt || '');
  if (!Number.isFinite(lastValidated)) return true;
  // Pro paused by the offline grace limit retries on the short check cadence so
  // access returns soon after the device is back online.
  const retryAfter = state.status === BILLING_STATUS_VERIFICATION_EXPIRED
    ? BILLING_REVALIDATE_CHECK_INTERVAL_MS
    : BILLING_REVALIDATE_AFTER_MS;
  return (Date.now() - lastValidated) > retryAfter;
}

// Billing policy (docs/billing-policy.md): a failed check keeps cached Pro only
// within the offline grace window, counted from the last successful check.
export function applyFailedValidation(previousState, error, now = Date.now()) {
  const stamp = new Date(now).toISOString();
  const validationError = error?.message || 'Could not verify billing.';
  // Caches written before lastVerifiedAt existed fall back to their last stamp
  // once; persisting it means later failures cannot keep moving the anchor.
  const lastVerifiedAt = previousState.plan === 'pro'
    ? (previousState.lastVerifiedAt || previousState.lastValidatedAt || stamp)
    : previousState.lastVerifiedAt;
  const verifiedAt = Date.parse(lastVerifiedAt || '');
  const graceExpired = previousState.plan === 'pro'
    && !isOwnerProState(previousState)
    && (!Number.isFinite(verifiedAt) || (now - verifiedAt) > BILLING_OFFLINE_GRACE_MS);
  return normalizeBillingState({
    ...previousState,
    ...(graceExpired ? { plan: 'free' } : {}),
    // A device already paused by the grace limit stays in that state on later
    // failures, so it keeps retrying and recovers once a check succeeds.
    status: graceExpired || previousState.status === BILLING_STATUS_VERIFICATION_EXPIRED
      ? BILLING_STATUS_VERIFICATION_EXPIRED
      : (previousState.plan === 'pro' ? 'offline' : 'error'),
    validationError,
    // Stamp even on failure: a failed validation is still a completed
    // attempt, and leaving the clock stale is what caused revalidation
    // to retry in a loop.
    lastValidatedAt: stamp,
    lastVerifiedAt: lastVerifiedAt || '',
  });
}

function normalizeResponseState(payload, previousState) {
  if (payload?.billingDisabled) {
    // Terminal billing-off contract: the server has no entitlement data, so
    // keep whatever this device already knows and stamp the validation clock
    // so revalidation stops retrying. The flag is kept so purchase UI can
    // render a truthful disabled state instead of dead checkout controls.
    const stamp = new Date().toISOString();
    return normalizeBillingState({
      ...previousState,
      billingDisabled: true,
      validationError: '',
      lastValidatedAt: stamp,
      // A definitive server answer: billing being off must not expire access
      // a customer already paid for.
      lastVerifiedAt: stamp,
    });
  }
  const verifiedAt = new Date().toISOString();
  const hasField = (name) => Object.prototype.hasOwnProperty.call(payload || {}, name);
  return normalizeBillingState({
    ...previousState,
    plan: payload.plan,
    status: payload.status || (payload.plan === 'pro' ? 'active' : 'free'),
    customerId: hasField('customerId') ? payload.customerId : previousState.customerId,
    subscriptionId: hasField('subscriptionId') ? payload.subscriptionId : previousState.subscriptionId,
    priceId: hasField('priceId') ? payload.priceId : previousState.priceId,
    billingPeriod: hasField('billingPeriod') ? payload.billingPeriod : previousState.billingPeriod,
    productName: hasField('productName') ? payload.productName : previousState.productName,
    clerkUserId: hasField('clerkUserId') ? payload.clerkUserId : previousState.clerkUserId,
    customerEmail: hasField('customerEmail') ? payload.customerEmail : previousState.customerEmail,
    customerName: hasField('customerName') ? payload.customerName : previousState.customerName,
    manageUrl: hasField('manageUrl') ? payload.manageUrl : previousState.manageUrl,
    billingDisabled: false,
    checkoutDisabled: payload.checkoutDisabled === true,
    validationError: '',
    lastValidatedAt: verifiedAt,
    lastVerifiedAt: verifiedAt,
  });
}

// Server billing-off responses arrive as HTTP 200 with a terminal payload;
// surface the server's own message and remember the state for the UI.
function billingDisabledError(payload, fallback) {
  const message = typeof payload?.error === 'string' && payload.error.trim()
    ? payload.error.trim()
    : fallback;
  const error = new Error(message);
  error.billingDisabled = true;
  error.retryable = false;
  return error;
}

async function buildResponseError(response, fallback) {
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    // Ignore malformed responses.
  }
  const message = typeof payload?.error === 'string' && payload.error.trim()
    ? payload.error.trim()
    : fallback;
  const error = new Error(message);
  error.status = response.status;
  if (typeof payload?.code === 'string') error.code = payload.code;
  error.retryable = typeof payload?.retryable === 'boolean'
    ? payload.retryable
    : response.status === 429 || response.status >= 500;
  return error;
}

export default function useBillingState({ notify, telemetry, clerkUser, clerkGetToken }) {
  const [state, setState] = useState(() => normalizeBillingState(
    loadJson(storageKeys.billing, createDefaultBillingState()),
  ));
  const [busyAction, setBusyAction] = useState('');
  // AUD-009: Stripe URL to show as a visible link when the browser blocked
  // the new tab. Kept out of persisted billing state on purpose.
  const [blockedExternal, setBlockedExternal] = useState(null);
  const billingReturnRef = useRef(undefined);
  if (billingReturnRef.current === undefined) {
    billingReturnRef.current = consumeBillingReturnFromLocation();
  }
  const billingReturnHandledRef = useRef(false);
  const unmountedRef = useRef(false);
  useEffect(() => {
    unmountedRef.current = false;
    return () => { unmountedRef.current = true; };
  }, []);
  const autoSyncKeyRef = useRef('');
  const autoSyncAttemptsRef = useRef(0);
  const [autoSyncRetryTick, setAutoSyncRetryTick] = useState(0);
  const revalidateKeyRef = useRef('');
  // Latest-state ref so callbacks can read fresh state without depending on
  // it, which would recreate them (and re-fire effects) on every state write.
  const stateRef = useRef(state);
  stateRef.current = state;
  const apiBase = getBillingApiBase();
  const clerkId = typeof clerkUser?.id === 'string' ? clerkUser.id.trim() : '';
  const accountRef = useRef({ id: clerkId, generation: 0 });
  if (accountRef.current.id !== clerkId) {
    accountRef.current = { id: clerkId, generation: accountRef.current.generation + 1 };
  }
  useEffect(() => () => {
    // Invalidate in-flight work when sign-out unmounts the hosted app, too.
    accountRef.current = { ...accountRef.current, generation: accountRef.current.generation + 1 };
  }, []);

  // Sync Clerk identity into billing state when available
  useEffect(() => {
    if (!clerkUser) {
      if (clerkUser === null) setState(createDefaultBillingState());
      return;
    }
    const email = readClerkEmail(clerkUser);
    const clerkId = typeof clerkUser.id === 'string' ? clerkUser.id.trim() : '';
    if (!clerkId) return;
    if (email === state.customerEmail && clerkId === state.clerkUserId) return;

    setState((prev) => {
      // A different Clerk account signed in on this device: drop the previous
      // account's entitlements instead of merging them into the new identity.
      const base = prev.clerkUserId !== clerkId
        ? createDefaultBillingState()
        : prev;
      return normalizeBillingState({
        ...base,
        ...(email ? { customerEmail: email } : {}),
        clerkUserId: clerkId,
      });
    });
  }, [clerkUser, state.clerkUserId, state.customerEmail]);

  useEffect(() => {
    saveJson(storageKeys.billing, state);
  }, [state]);

  const requestBilling = useCallback(async (path, init) => {
    const account = accountRef.current;
    const assertCurrentAccount = () => {
      if (accountRef.current !== account) {
        const error = new Error('The signed-in account changed. Retry from the current account.');
        error.code = 'BILLING_ACCOUNT_CHANGED';
        throw error;
      }
    };
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);
    try {
      const requiresAuth = path === '/billing/license'
        || path === '/billing/portal'
        || path === '/billing/checkout';
      const headers = { ...(init?.headers || {}) };
      let token = '';
      if (clerkGetToken) {
        try {
          token = await clerkGetToken();
        } catch { /* Surface a consistent auth error below. */ }
      }
      assertCurrentAccount();
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      } else if (requiresAuth) {
        throw new Error('Sign in to Prompt Lab before syncing billing.');
      }
      const response = await fetch(`${apiBase}${path}`, {
        ...init,
        headers,
        signal: controller.signal,
      });
      if (!response.ok) {
        throw await buildResponseError(response, 'Billing request failed.');
      }
      const payload = await response.json();
      assertCurrentAccount();
      return payload;
    } catch (err) {
      assertCurrentAccount();
      if (err?.name === 'AbortError') {
        throw new Error('Billing request timed out. Please try again.');
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }, [apiBase, clerkGetToken]);

  useEffect(() => {
    if (!clerkGetToken || !state.clerkUserId || state.plan === 'pro') return undefined;
    const autoSyncKey = `${state.clerkUserId}:${state.customerEmail || ''}:${state.customerId || ''}`;
    if (autoSyncKeyRef.current === autoSyncKey) return undefined;
    autoSyncKeyRef.current = autoSyncKey;

    let cancelled = false;
    let retryTimer = null;
    (async () => {
      try {
        const payload = await requestBilling('/billing/license', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'validate',
          }),
        });
        if (cancelled) return;
        autoSyncAttemptsRef.current = 0;
        setState((prev) => normalizeResponseState(payload, prev));
      } catch {
        // Account sync is quiet on load; manual Sync or Refresh surfaces errors.
        // A transient failure (offline, Clerk token not ready) must not leave a
        // paid account on Free for the whole session, so retry with backoff.
        if (cancelled) return;
        if (autoSyncKeyRef.current === autoSyncKey) autoSyncKeyRef.current = '';
        const attempt = autoSyncAttemptsRef.current + 1;
        autoSyncAttemptsRef.current = attempt;
        const delay = Math.min(AUTO_SYNC_RETRY_BASE_MS * (2 ** (attempt - 1)), BILLING_REVALIDATE_CHECK_INTERVAL_MS);
        retryTimer = setTimeout(() => setAutoSyncRetryTick((tick) => tick + 1), delay);
      }
    })();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [autoSyncRetryTick, clerkGetToken, requestBilling, state.clerkUserId, state.customerEmail, state.customerId, state.plan]);

  const refreshLicense = useCallback(async ({ silent = false } = {}) => {
    if (isOwnerProState(stateRef.current)) return true;
    if (!stateRef.current.customerEmail && !stateRef.current.customerId && !stateRef.current.clerkUserId) return false;
    if (stateRef.current.billingDisabled) {
      if (!silent) notify?.('Billing is temporarily unavailable. Cached access is unchanged.');
      return stateRef.current.plan === 'pro';
    }

    if (!silent) setBusyAction('validate');
    try {
      const payload = await requestBilling('/billing/license', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'validate',
        }),
      });

      const nextState = normalizeResponseState(payload, stateRef.current);
      setState(() => nextState);
      if (payload?.billingDisabled) {
        if (!silent) notify?.('Billing is temporarily unavailable. Cached access is unchanged.');
        return nextState.plan === 'pro';
      }
      if (!silent) notify?.(nextState.plan === 'pro' ? 'Prompt Lab Pro verified.' : 'Billing verified.');
      if (!silent) {
        telemetry?.track?.('billing.license_validated', {
          plan: nextState.plan,
          status: nextState.status,
          billingPeriod: nextState.billingPeriod,
        });
      }
      return nextState.plan === 'pro';
    } catch (error) {
      if (error?.code === 'BILLING_ACCOUNT_CHANGED') return false;
      const failedAt = Date.now();
      const nextState = applyFailedValidation(stateRef.current, error, failedAt);
      setState((prev) => applyFailedValidation(prev, error, failedAt));
      if (!silent) notify?.(error.message || 'Could not verify billing.');
      return nextState.plan === 'pro';
    } finally {
      if (!silent) setBusyAction('');
    }
  }, [notify, requestBilling]);

  // Without a timer the six-hour window was only re-evaluated on reload or a
  // state change, so a long-lived tab could keep stale Pro indefinitely.
  const [revalidateTick, setRevalidateTick] = useState(0);
  const watchesEntitlementCache = (state.plan === 'pro' && !isOwnerProState(state))
    || state.status === BILLING_STATUS_VERIFICATION_EXPIRED;
  useEffect(() => {
    if (!watchesEntitlementCache) return undefined;
    const tick = () => setRevalidateTick(Date.now());
    const intervalId = setInterval(tick, BILLING_REVALIDATE_CHECK_INTERVAL_MS);
    const onVisibilityChange = () => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') tick();
    };
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      clearInterval(intervalId);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [watchesEntitlementCache]);

  useEffect(() => {
    if (clerkGetToken && state.plan !== 'pro' && state.status !== BILLING_STATUS_VERIFICATION_EXPIRED) return;
    if (!shouldRevalidate(state)) return;
    const revalidateKey = `${state.clerkUserId}:${state.customerEmail || ''}:${state.customerId || ''}:${state.lastValidatedAt || ''}`;
    if (revalidateKeyRef.current === revalidateKey) return;
    revalidateKeyRef.current = revalidateKey;
    refreshLicense({ silent: true });
  }, [clerkGetToken, refreshLicense, revalidateTick, state]);

  // AUD-009: handle the return from Stripe Checkout once, after the signed-in
  // identity is known, so the license refresh is authenticated.
  const refreshLicenseRef = useRef(refreshLicense);
  refreshLicenseRef.current = refreshLicense;
  useEffect(() => {
    const outcome = billingReturnRef.current;
    if (!outcome || billingReturnHandledRef.current) return;
    if (outcome === 'cancelled') {
      billingReturnHandledRef.current = true;
      notify?.('Checkout canceled. You have not been charged.');
      telemetry?.track?.('billing.checkout_returned', { outcome });
      return;
    }
    if (clerkGetToken && !state.clerkUserId) return;
    billingReturnHandledRef.current = true;
    (async () => {
      for (const delay of BILLING_RETURN_POLL_DELAYS_MS) {
        if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
        if (unmountedRef.current) return;
        const isPro = await refreshLicenseRef.current({ silent: true });
        if (unmountedRef.current) return;
        if (isPro) {
          notify?.('Welcome to Prompt Lab Pro. Your subscription is active.');
          telemetry?.track?.('billing.checkout_returned', { outcome, plan: 'pro' });
          return;
        }
      }
      notify?.('Payment received. Pro access can take a minute to appear. Use Refresh Status in Billing if it does not.');
      telemetry?.track?.('billing.checkout_returned', { outcome, plan: 'pending' });
    })();
  }, [clerkGetToken, notify, state.clerkUserId, telemetry]);

  const activateLicense = useCallback(async (customerEmailInput) => {
    const customerEmail = String(customerEmailInput || state.customerEmail || '').trim().toLowerCase();
    if (stateRef.current.billingDisabled) {
      throw billingDisabledError(null, 'Billing is temporarily unavailable. Cached access is unchanged.');
    }
    setBusyAction('activate');
    try {
      const payload = await requestBilling('/billing/license', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'activate',
        }),
      });
      const nextState = normalizeResponseState(payload, {
        ...state,
        customerEmail,
      });
      setState(nextState);
      if (payload?.billingDisabled) {
        throw billingDisabledError(payload, 'Billing is temporarily unavailable. Cached access is unchanged.');
      }
      notify?.('Prompt Lab Pro synced to this device.');
      telemetry?.track?.('billing.license_activated', {
        plan: nextState.plan,
        status: nextState.status,
        billingPeriod: nextState.billingPeriod,
      });
      return nextState;
    } finally {
      setBusyAction('');
    }
  }, [notify, requestBilling, state]);

  const deactivateLicense = useCallback(async () => {
    setBusyAction('deactivate');
    try {
      setState(createDefaultBillingState());
      notify?.('Cleared local billing access on this device.');
      telemetry?.track?.('billing.license_deactivated', { plan: 'free' });
    } finally {
      setBusyAction('');
    }
  }, [notify, telemetry]);

  const activateOwnerAccess = useCallback(async () => {
    if (!isOwnerAccessAvailable()) {
      throw new Error('Owner access is only available in local desktop/dev builds.');
    }

    const nextState = createOwnerBillingState();
    setState(nextState);
    notify?.('Owner Pro access enabled on this device.');
    telemetry?.track?.('billing.owner_access_activated', { plan: 'pro', status: 'owner' });
    return nextState;
  }, [notify, telemetry]);

  const startCheckout = useCallback(async (period, source = 'billing-modal') => {
    if (stateRef.current.checkoutDisabled) {
      throw new Error(CHECKOUT_UNAVAILABLE_MESSAGE);
    }
    setBusyAction(`checkout:${period}`);
    setBlockedExternal(null);
    // Must run before the first await: browsers only allow a new tab during
    // the click that triggered it.
    const preopenAttempted = shouldPreopenExternalTab();
    const preopenedTab = preopenAttempted ? preopenExternalTab() : null;
    let tabHandedOff = false;
    try {
      const payload = await requestBilling('/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          period,
          source,
        }),
      });
      if (payload?.billingDisabled) {
        setState((prev) => normalizeBillingState({ ...prev, billingDisabled: true }));
        throw billingDisabledError(payload, 'Billing is disabled. Purchases are temporarily unavailable.');
      }
      if (payload?.checkoutDisabled) {
        // Only purchases are paused; keep Manage Purchases, Sync and Refresh.
        // The next license validation clears this once the server is ready.
        setState((prev) => normalizeBillingState({ ...prev, checkoutDisabled: true }));
        const error = new Error(CHECKOUT_UNAVAILABLE_MESSAGE);
        error.retryable = false;
        throw error;
      }
      if (!payload?.url) {
        throw new Error('Billing checkout did not return a URL.');
      }
      const opened = openStripeUrl(preopenedTab, payload.url, preopenAttempted);
      tabHandedOff = opened;
      if (opened) {
        notify?.('Stripe Checkout opened in a new tab.');
      } else {
        setBlockedExternal({ kind: 'checkout', url: payload.url });
        notify?.(BLOCKED_TAB_MESSAGES.checkout);
      }
      telemetry?.track?.('billing.checkout_started', {
        period,
        source,
        surface: telemetry?.surface || '',
        tabBlocked: !opened,
      });
      return opened;
    } catch (error) {
      if (error?.status === 409 && error?.code === 'already_subscribed') {
        // The server found an existing Prompt Lab subscription. Refresh so the
        // UI switches to Pro (Manage billing) instead of offering checkout.
        void refreshLicense({ silent: true });
      }
      throw error;
    } finally {
      if (!tabHandedOff) closeExternalTab(preopenedTab);
      setBusyAction('');
    }
  }, [notify, refreshLicense, requestBilling, telemetry]);

  const openManagePurchases = useCallback(async (overrides = {}) => {
    if (isOwnerProState(state)) {
      notify?.('Owner Pro access is managed by Prompt Lab owner settings.');
      return false;
    }

    setBusyAction('portal');
    setBlockedExternal(null);
    const preopenAttempted = shouldPreopenExternalTab();
    const preopenedTab = preopenAttempted ? preopenExternalTab() : null;
    let tabHandedOff = false;
    try {
      const payload = await requestBilling('/billing/portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (payload?.billingDisabled) {
        setState((prev) => normalizeBillingState({ ...prev, billingDisabled: true }));
        throw billingDisabledError(payload, 'Billing is disabled. Purchase management is temporarily unavailable.');
      }
      if (!payload?.url) {
        throw new Error('Billing portal is not configured.');
      }
      const opened = openStripeUrl(preopenedTab, payload.url, preopenAttempted);
      tabHandedOff = opened;
      if (!opened) {
        setBlockedExternal({ kind: 'portal', url: payload.url });
        notify?.(BLOCKED_TAB_MESSAGES.portal);
      }
      telemetry?.track?.('billing.portal_opened', { plan: state.plan, tabBlocked: !opened });
      return opened;
    } finally {
      if (!tabHandedOff) closeExternalTab(preopenedTab);
      setBusyAction('');
    }
  }, [notify, requestBilling, state.billingPeriod, state.customerEmail, state.customerId, state.plan, state.status, telemetry]);

  // Do not expose another account's cache during the render before effects run.
  const visibleState = clerkUser !== undefined && (!clerkId || state.clerkUserId !== clerkId)
    ? createDefaultBillingState()
    : state;
  const billing = useMemo(() => ({
    ...visibleState,
    busyAction,
    isPro: visibleState.plan === 'pro',
    planLabel: getPlanLabel(visibleState),
    statusCopy: describeBillingStatus(visibleState),
    hasFeature: (featureId) => canAccessFeature(visibleState, featureId),
    featureGatesActive: areFeatureGatesActive(visibleState),
    ownerAccessAvailable: isOwnerAccessAvailable(),
    activateOwnerAccess,
    refreshLicense,
    activateLicense,
    deactivateLicense,
    startCheckout,
    openManagePurchases,
    blockedExternal,
    clearBlockedExternal: () => setBlockedExternal(null),
  }), [activateLicense, activateOwnerAccess, blockedExternal, busyAction, deactivateLicense, openManagePurchases, refreshLicense, startCheckout, visibleState]);

  return billing;
}
