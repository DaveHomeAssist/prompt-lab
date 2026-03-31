import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  buildLicenseInstanceName,
  canAccessFeature,
  createDefaultBillingState,
  describeBillingStatus,
  getBillingApiBase,
  getPlanLabel,
  normalizeBillingState,
} from '../lib/billing.js';
import { loadJson, saveJson, storageKeys } from '../lib/storage.js';

const REVALIDATE_AFTER_MS = 6 * 60 * 60 * 1000;

function shouldRevalidate(state) {
  if (!state.licenseKey) return false;
  const lastValidated = Date.parse(state.lastValidatedAt || '');
  if (!Number.isFinite(lastValidated)) return true;
  return (Date.now() - lastValidated) > REVALIDATE_AFTER_MS;
}

function normalizeResponseState(payload, previousState) {
  return normalizeBillingState({
    ...previousState,
    plan: payload.plan,
    status: payload.status || (payload.plan === 'pro' ? 'active' : 'free'),
    licenseKey: payload.licenseKey || previousState.licenseKey,
    instanceId: payload.instanceId || previousState.instanceId,
    instanceName: payload.instanceName || previousState.instanceName,
    billingPeriod: payload.billingPeriod || previousState.billingPeriod,
    variantId: payload.variantId || previousState.variantId,
    productName: payload.productName || previousState.productName,
    customerEmail: payload.customerEmail || previousState.customerEmail,
    customerName: payload.customerName || previousState.customerName,
    manageUrl: payload.manageUrl || previousState.manageUrl,
    validationError: '',
    lastValidatedAt: new Date().toISOString(),
  });
}

async function parseErrorMessage(response, fallback) {
  try {
    const payload = await response.json();
    if (typeof payload?.error === 'string' && payload.error.trim()) return payload.error.trim();
  } catch {
    // Ignore malformed responses.
  }
  return fallback;
}

export default function useBillingState({ notify, telemetry }) {
  const [state, setState] = useState(() => normalizeBillingState(
    loadJson(storageKeys.billing, createDefaultBillingState()),
  ));
  const [busyAction, setBusyAction] = useState('');
  const apiBase = getBillingApiBase();

  useEffect(() => {
    saveJson(storageKeys.billing, state);
  }, [state]);

  const requestBilling = useCallback(async (path, init) => {
    const response = await fetch(`${apiBase}${path}`, init);
    if (!response.ok) {
      throw new Error(await parseErrorMessage(response, 'Billing request failed.'));
    }
    return response.json();
  }, [apiBase]);

  const refreshLicense = useCallback(async ({ silent = false } = {}) => {
    if (!state.licenseKey) return false;

    if (!silent) setBusyAction('validate');
    try {
      const payload = await requestBilling('/billing/license', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'validate',
          licenseKey: state.licenseKey,
          instanceId: state.instanceId || undefined,
        }),
      });

      const nextState = normalizeResponseState(payload, state);
      setState(nextState);
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
      }));
      if (!silent) notify?.(error.message || 'Could not verify billing.');
      return state.plan === 'pro';
    } finally {
      if (!silent) setBusyAction('');
    }
  }, [notify, requestBilling, state]);

  useEffect(() => {
    if (!shouldRevalidate(state)) return;
    refreshLicense({ silent: true });
  }, [refreshLicense, state]);

  const activateLicense = useCallback(async (licenseKeyInput) => {
    const licenseKey = String(licenseKeyInput || '').trim();
    if (!licenseKey) throw new Error('Enter a Lemon Squeezy license key.');

    setBusyAction('activate');
    try {
      const instanceName = buildLicenseInstanceName();
      const payload = await requestBilling('/billing/license', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'activate',
          licenseKey,
          instanceName,
        }),
      });
      const nextState = normalizeResponseState(payload, {
        ...state,
        licenseKey,
        instanceName,
      });
      setState(nextState);
      notify?.('Prompt Lab Pro activated.');
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
    if (!state.licenseKey || !state.instanceId) {
      setState(createDefaultBillingState());
      return;
    }

    setBusyAction('deactivate');
    try {
      await requestBilling('/billing/license', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'deactivate',
          licenseKey: state.licenseKey,
          instanceId: state.instanceId,
        }),
      });
      setState(createDefaultBillingState());
      notify?.('Prompt Lab Pro deactivated on this device.');
      telemetry?.track?.('billing.license_deactivated', { plan: 'free' });
    } finally {
      setBusyAction('');
    }
  }, [notify, requestBilling, state.instanceId, state.licenseKey, telemetry]);

  const startCheckout = useCallback(async (period, source = 'billing-modal', metadata = {}) => {
    setBusyAction(`checkout:${period}`);
    try {
      const payload = await requestBilling('/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          period,
          email: state.customerEmail || telemetry?.contactEmail || '',
          name: state.customerName,
          source,
          deviceId: metadata?.deviceId || telemetry?.deviceId || '',
          sessionId: metadata?.sessionId || telemetry?.sessionId || '',
          surface: metadata?.surface || telemetry?.surface || '',
          contactEmail: telemetry?.contactEmail || '',
        }),
      });
      if (!payload?.url) {
        throw new Error('Billing checkout did not return a URL.');
      }
      window.open(payload.url, '_blank', 'noopener,noreferrer');
      notify?.('Opened Lemon Squeezy checkout.');
      telemetry?.track?.('billing.checkout_started', {
        period,
        source,
        surface: metadata?.surface || telemetry?.surface || '',
      });
      return true;
    } finally {
      setBusyAction('');
    }
  }, [notify, requestBilling, state.customerEmail, state.customerName, telemetry]);

  const openManagePurchases = useCallback(async () => {
    setBusyAction('portal');
    try {
      const payload = await requestBilling('/billing/portal', {
        method: 'GET',
      });
      if (!payload?.url) {
        throw new Error('Billing portal is not configured.');
      }
      window.open(payload.url, '_blank', 'noopener,noreferrer');
      telemetry?.track?.('billing.portal_opened', { plan: state.plan });
      return true;
    } finally {
      setBusyAction('');
    }
  }, [requestBilling, state.plan, telemetry]);

  const billing = useMemo(() => ({
    ...state,
    busyAction,
    isPro: state.plan === 'pro',
    planLabel: getPlanLabel(state),
    statusCopy: describeBillingStatus(state),
    hasFeature: (featureId) => canAccessFeature(state.plan, featureId),
    refreshLicense,
    activateLicense,
    deactivateLicense,
    startCheckout,
    openManagePurchases,
  }), [activateLicense, busyAction, deactivateLicense, openManagePurchases, refreshLicense, startCheckout, state]);

  return billing;
}
