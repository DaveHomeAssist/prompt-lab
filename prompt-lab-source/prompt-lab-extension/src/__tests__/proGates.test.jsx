import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BILLING_FEATURES,
  areFeatureGatesActive,
  areProGatesBuildEnabled,
  canAccessFeature,
  createOwnerBillingState,
  isPrelaunchOpenAccess,
  isProFeature,
} from '../lib/billing.js';
import useBillingState from '../hooks/useBillingState.js';

// The shared test setup stubs chrome.runtime, which makes every test run as
// the extension. Control the surface explicitly here.
const platformState = vi.hoisted(() => ({ isExtension: false }));
vi.mock('../lib/platform.js', () => ({
  get isExtension() { return platformState.isExtension; },
}));

const PRO_FEATURE_IDS = ['abTesting', 'batchRuns', 'collections'];

function enableWebGates() {
  vi.stubEnv('VITE_WEB_MODE', 'true');
  vi.stubEnv('VITE_PROMPTLAB_PRO_GATES', 'on');
}

function jsonResponse(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('Pro feature gates', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    platformState.isExtension = false;
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    global.fetch = originalFetch;
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('keeps the diff viewer free on every plan (AUD-008)', () => {
    enableWebGates();
    expect(isProFeature('diffView')).toBe(false);
    expect(canAccessFeature({ plan: 'free' }, 'diffView')).toBe(true);
  });

  it('gates exactly the three advertised Pro features and nothing else', () => {
    expect(Object.keys(BILLING_FEATURES).sort()).toEqual([...PRO_FEATURE_IDS].sort());
    for (const id of PRO_FEATURE_IDS) expect(isProFeature(id)).toBe(true);
    // Import and preset packs are Free on the landing page.
    enableWebGates();
    expect(canAccessFeature({ plan: 'free' }, 'import')).toBe(true);
    expect(canAccessFeature({ plan: 'free' }, 'packs')).toBe(true);
    expect(canAccessFeature({ plan: 'free' }, 'enhance')).toBe(true);
  });

  it('is enforced only in hosted web builds with the gate flag on', () => {
    expect(areProGatesBuildEnabled()).toBe(false);

    vi.stubEnv('VITE_WEB_MODE', 'true');
    expect(areProGatesBuildEnabled()).toBe(false);

    vi.stubEnv('VITE_PROMPTLAB_PRO_GATES', 'off');
    expect(areProGatesBuildEnabled()).toBe(false);

    vi.stubEnv('VITE_PROMPTLAB_PRO_GATES', 'on');
    expect(areProGatesBuildEnabled()).toBe(true);

    vi.stubEnv('VITE_WEB_MODE', 'false');
    expect(areProGatesBuildEnabled()).toBe(false);
  });

  it('locks Pro features for Free web users and keeps them for Pro and Owner', () => {
    enableWebGates();
    const owner = createOwnerBillingState();
    for (const id of PRO_FEATURE_IDS) {
      expect(canAccessFeature({ plan: 'free', status: 'free' }, id)).toBe(false);
      expect(canAccessFeature('free', id)).toBe(false);
      expect(canAccessFeature({ plan: 'pro', status: 'active' }, id)).toBe(true);
      expect(canAccessFeature({ plan: 'pro', status: 'past_due' }, id)).toBe(true);
      expect(canAccessFeature({ plan: 'pro', status: 'offline' }, id)).toBe(true);
      expect(canAccessFeature(owner, id)).toBe(true);
    }
  });

  it('keeps every feature open for Free users when they cannot buy', () => {
    enableWebGates();
    const billingOff = { plan: 'free', billingDisabled: true };
    const checkoutPaused = { plan: 'free', checkoutDisabled: true };
    expect(areFeatureGatesActive(billingOff)).toBe(false);
    expect(areFeatureGatesActive(checkoutPaused)).toBe(false);
    for (const id of PRO_FEATURE_IDS) {
      expect(canAccessFeature(billingOff, id)).toBe(true);
      expect(canAccessFeature(checkoutPaused, id)).toBe(true);
    }
    expect(isPrelaunchOpenAccess(billingOff)).toBe(true);
    expect(isPrelaunchOpenAccess(checkoutPaused)).toBe(false);
    expect(isPrelaunchOpenAccess({ plan: 'pro', billingDisabled: true })).toBe(false);
  });

  it('keeps every feature open in extension and desktop builds (no sign-in, no checkout)', () => {
    vi.stubEnv('VITE_PROMPTLAB_PRO_GATES', 'on');
    // Desktop (Tauri) build: not web mode.
    vi.stubEnv('VITE_WEB_MODE', 'false');
    for (const id of PRO_FEATURE_IDS) {
      expect(canAccessFeature({ plan: 'free' }, id)).toBe(true);
    }
    // Extension runtime, even if the web flags leaked into the build.
    vi.stubEnv('VITE_WEB_MODE', 'true');
    platformState.isExtension = true;
    expect(areProGatesBuildEnabled()).toBe(false);
    for (const id of PRO_FEATURE_IDS) {
      expect(canAccessFeature({ plan: 'free' }, id)).toBe(true);
    }
  });

  it('auto-syncs a signed-in web subscriber on load so Pro stays unlocked', async () => {
    enableWebGates();
    global.fetch = vi.fn(async (_url, init) => {
      expect(init.headers.Authorization).toBe('Bearer clerk-token');
      expect(JSON.parse(init.body)).toEqual({ action: 'validate' });
      return jsonResponse({
        ok: true,
        plan: 'pro',
        status: 'active',
        billingPeriod: 'annual',
        customerId: 'cus_web',
        subscriptionId: 'sub_web',
      });
    });
    const clerkUser = { id: 'user_web', primaryEmailAddress: { emailAddress: 'pro@example.com' } };
    const clerkGetToken = vi.fn(async () => 'clerk-token');
    const { result } = renderHook(() => useBillingState({ clerkUser, clerkGetToken }));

    expect(result.current.featureGatesActive).toBe(true);
    expect(result.current.hasFeature('abTesting')).toBe(false);

    await waitFor(() => expect(result.current.plan).toBe('pro'));
    for (const id of PRO_FEATURE_IDS) expect(result.current.hasFeature(id)).toBe(true);
  });

  it('locks a signed-in web user with no subscription and reopens if billing is turned off', async () => {
    enableWebGates();
    let billingDisabled = false;
    global.fetch = vi.fn(async () => jsonResponse(billingDisabled
      ? { ok: true, billingDisabled: true }
      : { ok: true, plan: 'free', status: 'inactive', customerId: '' }));
    const clerkUser = { id: 'user_free', primaryEmailAddress: { emailAddress: 'free@example.com' } };
    const clerkGetToken = vi.fn(async () => 'clerk-token');
    const { result } = renderHook(() => useBillingState({ clerkUser, clerkGetToken }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    await waitFor(() => expect(result.current.status).toBe('inactive'));
    for (const id of PRO_FEATURE_IDS) expect(result.current.hasFeature(id)).toBe(false);

    billingDisabled = true;
    await act(async () => {
      await result.current.refreshLicense({ silent: true });
    });
    expect(result.current.billingDisabled).toBe(true);
    for (const id of PRO_FEATURE_IDS) expect(result.current.hasFeature(id)).toBe(true);
  });

  it('drops Pro features once a canceled subscription is revalidated', async () => {
    enableWebGates();
    localStorage.setItem('pl2-billing', JSON.stringify({
      plan: 'pro',
      status: 'active',
      billingPeriod: 'monthly',
      customerId: 'cus_cancel',
      clerkUserId: 'user_cancel',
      lastValidatedAt: new Date().toISOString(),
    }));
    global.fetch = vi.fn(async () => jsonResponse({
      ok: true,
      plan: 'free',
      status: 'canceled',
      customerId: 'cus_cancel',
    }));
    const clerkGetToken = vi.fn(async () => 'clerk-token');
    const { result } = renderHook(() => useBillingState({ clerkGetToken }));
    expect(result.current.hasFeature('collections')).toBe(true);

    await act(async () => {
      await result.current.refreshLicense({ silent: true });
    });
    expect(result.current.plan).toBe('free');
    expect(result.current.hasFeature('collections')).toBe(false);
    // Export stays available after Pro ends so users can take their data out.
    expect(result.current.hasFeature('export')).toBe(true);
  });
});
