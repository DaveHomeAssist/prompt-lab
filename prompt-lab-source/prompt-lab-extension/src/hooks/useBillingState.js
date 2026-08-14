import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  canAccessFeature,
  createOwnerBillingState,
  createDefaultBillingState,
  describeBillingStatus,
  getBillingApiBase,
  getPlanLabel,
  isOwnerProState,
  isOwnerAccessAvailable,
  normalizeBillingState,
} from '../lib/billing.js';
import { loadJson, saveJson, storageKeys } from '../lib/storage.js';

const REVALIDATE_AFTER_MS = 6 * 60 * 60 * 1000;

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
  return (Date.now() - lastValidated) > REVALIDATE_AFTER_MS;
}

function normalizeResponseState(payload, previousState) {
  if (payload?.billingDisabled) {
    // Terminal billing-off contract: the server has no entitlement data, so
    // keep whatever this device already knows and stamp the validation clock
    // so revalidation stops retrying. The flag is kept so purchase UI can
    // render a truthful disabled state instead of dead checkout controls.
    return normalizeBillingState({
      ...previousState,
      billingDisabled: true,
      validationError: '',
      lastValidatedAt: new Date().toISOString(),
    });
  }
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
    validationError: '',
    lastValidatedAt: new Date().toISOString(),
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
  const autoSyncKeyRef = useRef('');
  const revalidateKeyRef = useRef('');
  // Latest-state ref so callbacks can read fresh state without depending on
  // it, which would recreate them (and re-fire effects) on every state write.
  const stateRef = useRef(state);
  stateRef.current = state;
  const apiBase = getBillingApiBase();

  // Sync Clerk identity into billing state when available
  useEffect(() => {
    if (!clerkUser) return;
    const email = readClerkEmail(clerkUser);
    const clerkId = typeof clerkUser.id === 'string' ? clerkUser.id.trim() : '';
    if (!clerkId) return;
    if (email === state.customerEmail && clerkId === state.clerkUserId) return;

    setState((prev) => {
      // A different Clerk account signed in on this device: drop the previous
      // account's entitlements instead of merging them into the new identity.
      const base = prev.clerkUserId && prev.clerkUserId !== clerkId && prev.status !== 'owner'
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
      return response.json();
    } catch (err) {
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
        setState((prev) => normalizeResponseState(payload, prev));
      } catch {
        // Account sync is quiet on load; manual Sync or Refresh surfaces errors.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [clerkGetToken, requestBilling, state.clerkUserId, state.customerEmail, state.customerId, state.plan]);

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
      setState((prev) => normalizeBillingState({
        ...prev,
        status: prev.plan === 'pro' ? 'offline' : 'error',
        validationError: error.message || 'Could not verify billing.',
        // Stamp even on failure: a failed validation is still a completed
        // attempt, and leaving the clock stale is what caused revalidation
        // to retry in a loop.
        lastValidatedAt: new Date().toISOString(),
      }));
      if (!silent) notify?.(error.message || 'Could not verify billing.');
      return stateRef.current.plan === 'pro';
    } finally {
      if (!silent) setBusyAction('');
    }
  }, [notify, requestBilling]);

  useEffect(() => {
    if (clerkGetToken && state.plan !== 'pro') return;
    if (!shouldRevalidate(state)) return;
    const revalidateKey = `${state.clerkUserId}:${state.customerEmail || ''}:${state.customerId || ''}:${state.lastValidatedAt || ''}`;
    if (revalidateKeyRef.current === revalidateKey) return;
    revalidateKeyRef.current = revalidateKey;
    refreshLicense({ silent: true });
  }, [clerkGetToken, refreshLicense, state]);

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
    setBusyAction(`checkout:${period}`);
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
      if (!payload?.url) {
        throw new Error('Billing checkout did not return a URL.');
      }
      window.open(payload.url, '_blank', 'noopener,noreferrer');
      notify?.('Opened Stripe checkout.');
      telemetry?.track?.('billing.checkout_started', {
        period,
        source,
        surface: telemetry?.surface || '',
      });
      return true;
    } finally {
      setBusyAction('');
    }
  }, [notify, requestBilling, telemetry]);

  const openManagePurchases = useCallback(async (overrides = {}) => {
    if (isOwnerProState(state)) {
      notify?.('Owner Pro access is managed by Prompt Lab owner settings.');
      return false;
    }

    setBusyAction('portal');
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
      window.open(payload.url, '_blank', 'noopener,noreferrer');
      telemetry?.track?.('billing.portal_opened', { plan: state.plan });
      return true;
    } finally {
      setBusyAction('');
    }
  }, [notify, requestBilling, state.billingPeriod, state.customerEmail, state.customerId, state.plan, state.status, telemetry]);

  const billing = useMemo(() => ({
    ...state,
    busyAction,
    isPro: state.plan === 'pro',
    planLabel: getPlanLabel(state),
    statusCopy: describeBillingStatus(state),
    hasFeature: (featureId) => canAccessFeature(state.plan, featureId),
    ownerAccessAvailable: isOwnerAccessAvailable(),
    activateOwnerAccess,
    refreshLicense,
    activateLicense,
    deactivateLicense,
    startCheckout,
    openManagePurchases,
  }), [activateLicense, activateOwnerAccess, busyAction, deactivateLicense, openManagePurchases, refreshLicense, startCheckout, state]);

  return billing;
}
