import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import useBillingState, { applyFailedValidation } from '../hooks/useBillingState.js';
import { BILLING_OFFLINE_GRACE_MS, BILLING_REVALIDATE_AFTER_MS } from '../lib/billingPolicy.js';

describe('useBillingState', () => {
  const originalFetch = global.fetch;
  const originalOpen = window.open;

  beforeEach(() => {
    localStorage.clear();
    window.open = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    window.open = originalOpen;
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('syncs a Stripe purchase and persists Pro state', async () => {
    global.fetch = vi.fn(async (_url, init) => {
      expect(init.headers.Authorization).toBe('Bearer clerk-token');
      expect(JSON.parse(init.body)).toEqual({ action: 'activate' });
      return new Response(JSON.stringify({
      ok: true,
      plan: 'pro',
      status: 'active',
      billingPeriod: 'monthly',
      customerId: 'cus_123',
      customerEmail: 'user@example.com',
      subscriptionId: 'sub_123',
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
    });

    const notify = vi.fn();
    const clerkGetToken = vi.fn(async () => 'clerk-token');
    const { result } = renderHook(() => useBillingState({ notify, clerkGetToken }));

    await act(async () => {
      await result.current.activateLicense('user@example.com');
    });

    expect(result.current.plan).toBe('pro');
    expect(result.current.billingPeriod).toBe('monthly');
    expect(result.current.customerId).toBe('cus_123');
    expect(result.current.hasFeature('abTesting')).toBe(true);
    expect(notify).toHaveBeenCalledWith('Prompt Lab Pro synced to this device.');
  });

  it('retains checkout readiness from license validation without blocking the portal', async () => {
    global.fetch = vi.fn(async (url) => new Response(JSON.stringify(url.endsWith('/billing/portal')
      ? { url: 'https://billing.stripe.com/session/test' }
      : { ok: true, plan: 'free', customerId: 'cus_test', checkoutDisabled: true }), { status: 200 }));
    const clerkGetToken = vi.fn(async () => 'clerk-token');
    const clerkUser = { id: 'user_test' };
    const { result } = renderHook(() => useBillingState({ clerkGetToken, clerkUser }));
    await waitFor(() => expect(result.current.checkoutDisabled).toBe(true));
    expect(result.current.billingDisabled).toBe(false);
    await expect(result.current.startCheckout('monthly')).rejects.toThrow('Purchases are temporarily unavailable');
    expect(global.fetch).not.toHaveBeenCalledWith(expect.stringContaining('/billing/checkout'), expect.anything());
    await act(async () => { await result.current.openManagePurchases(); });
    expect(window.open).toHaveBeenCalledWith('https://billing.stripe.com/session/test', '_blank', 'noopener,noreferrer');
  });

  it('pauses only checkout when the checkout endpoint reports purchases unavailable', async () => {
    global.fetch = vi.fn(async (url) => {
      if (url.endsWith('/billing/checkout')) {
        return new Response(JSON.stringify({
          error: 'Purchases are temporarily unavailable.',
          checkoutDisabled: true,
          retryable: false,
        }), { status: 200 });
      }
      if (url.endsWith('/billing/portal')) {
        return new Response(JSON.stringify({ url: 'https://billing.stripe.com/session/test' }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true, plan: 'free', customerId: 'cus_test', checkoutDisabled: false }), { status: 200 });
    });
    const clerkGetToken = vi.fn(async () => 'clerk-token');
    const clerkUser = { id: 'user_test' };
    const { result } = renderHook(() => useBillingState({ clerkGetToken, clerkUser }));
    await waitFor(() => expect(result.current.customerId).toBe('cus_test'));
    expect(result.current.checkoutDisabled).toBe(false);

    let checkoutError;
    await act(async () => {
      checkoutError = await result.current.startCheckout('annual').catch((error) => error);
    });
    expect(checkoutError.message).toMatch('Purchases are temporarily unavailable');
    expect(checkoutError.retryable).toBe(false);
    expect(result.current.checkoutDisabled).toBe(true);
    expect(result.current.billingDisabled).toBe(false);
    expect(window.open).not.toHaveBeenCalled();

    // Refresh still reaches the server and clears the pause once it is ready.
    await act(async () => { await result.current.refreshLicense({ silent: true }); });
    expect(result.current.checkoutDisabled).toBe(false);
    await act(async () => { await result.current.openManagePurchases(); });
    expect(window.open).toHaveBeenCalledWith('https://billing.stripe.com/session/test', '_blank', 'noopener,noreferrer');
  });

  it('keeps cached Pro access when billing validation is temporarily offline', async () => {
    localStorage.setItem('pl2-billing', JSON.stringify({
      plan: 'pro',
      status: 'active',
      customerEmail: 'user@example.com',
      customerId: 'cus_123',
      lastValidatedAt: new Date(Date.now() - (8 * 60 * 60 * 1000)).toISOString(),
    }));

    global.fetch = vi.fn(async () => {
      throw new Error('Billing service unavailable.');
    });

    const { result } = renderHook(() => useBillingState({ notify: vi.fn() }));

    await waitFor(() => {
      expect(result.current.status).toBe('offline');
    });

    expect(result.current.plan).toBe('pro');
    expect(result.current.hasFeature('export')).toBe(true);
  });

  it('normalizes Free owner markers without reintroducing feature gates', () => {
    localStorage.setItem('pl2-billing', JSON.stringify({
      plan: 'free',
      status: 'owner',
      billingPeriod: 'owner',
      customerEmail: 'owner@example.com',
    }));

    const { result } = renderHook(() => useBillingState({ notify: vi.fn() }));

    expect(result.current.plan).toBe('free');
    expect(result.current.status).toBe('free');
    expect(result.current.billingPeriod).toBe('');
    expect(result.current.planLabel).toBe('Free');
    expect(result.current.statusCopy).toBe('Free plan active. Upgrade to unlock advanced workflow features.');
    expect(result.current.hasFeature('collections')).toBe(true);
    expect(result.current.hasFeature('abTesting')).toBe(true);
    expect(result.current.hasFeature('diffView')).toBe(true);
    expect(result.current.hasFeature('batchRuns')).toBe(true);
    expect(result.current.hasFeature('export')).toBe(true);
  });

  it('describes Free billing-disabled access as prelaunch-open without promoting the plan', () => {
    localStorage.setItem('pl2-billing', JSON.stringify({
      plan: 'free',
      status: 'free',
      billingDisabled: true,
    }));

    const { result } = renderHook(() => useBillingState({ notify: vi.fn() }));

    expect(result.current.plan).toBe('free');
    expect(result.current.planLabel).toBe('Free');
    expect(result.current.statusCopy).toBe('All workflow features are available during prelaunch. Purchases are temporarily unavailable.');
    expect(result.current.hasFeature('collections')).toBe(true);
    expect(result.current.hasFeature('abTesting')).toBe(true);
    expect(result.current.hasFeature('diffView')).toBe(true);
    expect(result.current.hasFeature('batchRuns')).toBe(true);
    expect(result.current.hasFeature('export')).toBe(true);
  });

  it('auto-syncs owner Pro for a signed-in Clerk user id without cached billing email', async () => {
    global.fetch = vi.fn(async (_url, init) => {
      expect(init.headers.Authorization).toBe('Bearer clerk-token');
      expect(JSON.parse(init.body)).toEqual({ action: 'validate' });
      return new Response(JSON.stringify({
        ok: true,
        plan: 'pro',
        status: 'active',
        billingPeriod: 'owner',
        clerkUserId: 'user_owner',
        customerEmail: '',
        owner: true,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const clerkGetToken = vi.fn(async () => 'clerk-token');
    const clerkUser = {
      id: 'user_owner',
      primaryEmailAddress: null,
      primaryEmailAddressId: '',
      emailAddresses: [],
    };
    const { result } = renderHook(() => useBillingState({ notify: vi.fn(), clerkGetToken, clerkUser }));

    await waitFor(() => {
      expect(result.current.plan).toBe('pro');
    });

    expect(result.current.planLabel).toBe('Owner Pro');
    expect(result.current.clerkUserId).toBe('user_owner');
    expect(result.current.hasFeature('collections')).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('auto-syncs owner Pro for a signed-in Clerk user id with stale cached billing email', async () => {
    localStorage.setItem('pl2-billing', JSON.stringify({
      plan: 'free',
      status: 'free',
      customerEmail: 'old@example.com',
      lastValidatedAt: '',
    }));
    global.fetch = vi.fn(async (_url, init) => {
      expect(init.headers.Authorization).toBe('Bearer clerk-token');
      expect(JSON.parse(init.body)).toEqual({ action: 'validate' });
      return new Response(JSON.stringify({
        ok: true,
        plan: 'pro',
        status: 'active',
        billingPeriod: 'owner',
        clerkUserId: 'user_owner',
        customerEmail: '',
        owner: true,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const clerkGetToken = vi.fn(async () => 'clerk-token');
    const clerkUser = {
      id: 'user_owner',
      primaryEmailAddress: null,
      primaryEmailAddressId: '',
      emailAddresses: [],
    };
    const { result } = renderHook(() => useBillingState({ notify: vi.fn(), clerkGetToken, clerkUser }));

    await waitFor(() => {
      expect(result.current.plan).toBe('pro');
    });

    expect(result.current.planLabel).toBe('Owner Pro');
    expect(result.current.clerkUserId).toBe('user_owner');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('activates local owner Pro access without Stripe checkout', async () => {
    global.fetch = vi.fn();

    const notify = vi.fn();
    const { result } = renderHook(() => useBillingState({ notify }));

    expect(result.current.ownerAccessAvailable).toBe(true);

    await act(async () => {
      await result.current.activateOwnerAccess();
    });

    expect(result.current.plan).toBe('pro');
    expect(result.current.status).toBe('owner');
    expect(result.current.billingPeriod).toBe('owner');
    expect(result.current.planLabel).toBe('Owner Pro');
    expect(result.current.hasFeature('abTesting')).toBe(true);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem('pl2-billing'))).toMatchObject({
      plan: 'pro',
      status: 'owner',
      billingPeriod: 'owner',
    });
    expect(notify).toHaveBeenCalledWith('Owner Pro access enabled on this device.');
  });

  it('does not start checkout without a Clerk session token', async () => {
    global.fetch = vi.fn();

    const { result } = renderHook(() => useBillingState({ notify: vi.fn() }));
    let checkoutError;

    await act(async () => {
      try {
        await result.current.startCheckout('monthly');
      } catch (error) {
        checkoutError = error;
      }
    });

    expect(checkoutError).toBeInstanceOf(Error);
    expect(checkoutError.message).toBe('Sign in to Prompt Lab before syncing billing.');
    expect(global.fetch).not.toHaveBeenCalled();
    expect(window.open).not.toHaveBeenCalled();
  });

  it('authenticates checkout and sends only the selected period and source', async () => {
    global.fetch = vi.fn(async (_url, init) => {
      expect(init.headers.Authorization).toBe('Bearer clerk-token');
      expect(JSON.parse(init.body)).toEqual({
        period: 'annual',
        source: 'landing-pricing',
      });
      return new Response(JSON.stringify({
        ok: true,
        url: 'https://checkout.stripe.com/c/pay/cs_test_123',
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const clerkGetToken = vi.fn(async () => 'clerk-token');
    const telemetry = {
      contactEmail: 'private@example.com',
      deviceId: 'private-device',
      sessionId: 'private-session',
      surface: 'web',
      track: vi.fn(),
    };
    const { result } = renderHook(() => useBillingState({
      notify: vi.fn(),
      clerkGetToken,
      telemetry,
    }));

    await act(async () => {
      await result.current.startCheckout('annual', 'landing-pricing');
    });

    expect(window.open).toHaveBeenCalledWith(
      'https://checkout.stripe.com/c/pay/cs_test_123',
      '_blank',
      'noopener,noreferrer',
    );
  });

  it('keeps cached Pro and stamps lastValidatedAt on a terminal billingDisabled response', async () => {
    const staleStamp = new Date(Date.now() - (8 * 60 * 60 * 1000)).toISOString();
    localStorage.setItem('pl2-billing', JSON.stringify({
      plan: 'pro',
      status: 'active',
      customerEmail: 'user@example.com',
      customerId: 'cus_123',
      lastValidatedAt: staleStamp,
    }));

    global.fetch = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      plan: 'free',
      status: 'free',
      billingDisabled: true,
      retryable: false,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));

    const clerkGetToken = vi.fn(async () => 'clerk-token');
    const { result } = renderHook(() => useBillingState({ notify: vi.fn(), clerkGetToken }));

    await waitFor(() => {
      expect(Date.parse(result.current.lastValidatedAt)).toBeGreaterThan(Date.parse(staleStamp));
    });

    expect(result.current.plan).toBe('pro');
    expect(result.current.status).toBe('active');
    expect(result.current.validationError).toBe('');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('does not claim a disabled purchase sync succeeded', async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      plan: 'free',
      status: 'free',
      billingDisabled: true,
      retryable: false,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));

    const notify = vi.fn();
    const clerkGetToken = vi.fn(async () => 'clerk-token');
    const { result } = renderHook(() => useBillingState({ notify, clerkGetToken }));
    let syncError;

    await act(async () => {
      try {
        await result.current.activateLicense('user@example.com');
      } catch (error) {
        syncError = error;
      }
    });

    expect(syncError).toBeInstanceOf(Error);
    expect(syncError.message).toBe('Billing is temporarily unavailable. Cached access is unchanged.');
    expect(result.current.billingDisabled).toBe(true);
    expect(notify).not.toHaveBeenCalledWith('Prompt Lab Pro synced to this device.');
  });

  it('reports disabled billing without claiming a refresh verified access', async () => {
    localStorage.setItem('pl2-billing', JSON.stringify({
      plan: 'pro',
      status: 'active',
      customerEmail: 'user@example.com',
      lastValidatedAt: new Date().toISOString(),
    }));
    global.fetch = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      plan: 'free',
      status: 'free',
      billingDisabled: true,
      retryable: false,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));

    const notify = vi.fn();
    const clerkGetToken = vi.fn(async () => 'clerk-token');
    const { result } = renderHook(() => useBillingState({ notify, clerkGetToken }));

    await act(async () => {
      await result.current.refreshLicense();
    });

    expect(result.current.plan).toBe('pro');
    expect(result.current.billingDisabled).toBe(true);
    expect(notify).toHaveBeenCalledWith('Billing is temporarily unavailable. Cached access is unchanged.');
    expect(notify).not.toHaveBeenCalledWith('Prompt Lab Pro verified.');
  });

  it('stamps lastValidatedAt when validation fails so silent revalidation does not loop', async () => {
    const staleStamp = new Date(Date.now() - (8 * 60 * 60 * 1000)).toISOString();
    localStorage.setItem('pl2-billing', JSON.stringify({
      plan: 'pro',
      status: 'active',
      customerEmail: 'user@example.com',
      customerId: 'cus_123',
      lastValidatedAt: staleStamp,
    }));

    global.fetch = vi.fn(async () => new Response(JSON.stringify({
      error: 'Billing is disabled.',
    }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    }));

    const clerkGetToken = vi.fn(async () => 'clerk-token');
    const { result } = renderHook(() => useBillingState({ notify: vi.fn(), clerkGetToken }));

    await waitFor(() => {
      expect(result.current.status).toBe('offline');
    });

    expect(result.current.plan).toBe('pro');
    expect(result.current.validationError).toBe('Billing is disabled.');
    expect(Date.parse(result.current.lastValidatedAt)).toBeGreaterThan(Date.parse(staleStamp));
    // The stamp plus the revalidate latch mean exactly one request, not a loop.
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('attaches status and retryable metadata to billing request errors', async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({
      error: 'Billing is disabled.',
      retryable: false,
    }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    }));

    const clerkGetToken = vi.fn(async () => 'clerk-token');
    const { result } = renderHook(() => useBillingState({ notify: vi.fn(), clerkGetToken }));

    let requestError;
    await act(async () => {
      try {
        await result.current.activateLicense('user@example.com');
      } catch (error) {
        requestError = error;
      }
    });

    expect(requestError).toBeInstanceOf(Error);
    expect(requestError.message).toBe('Billing is disabled.');
    expect(requestError.status).toBe(503);
    expect(requestError.retryable).toBe(false);
  });

  it('labels server owner Pro access and does not open a Stripe portal', async () => {
    localStorage.setItem('pl2-billing', JSON.stringify({
      plan: 'pro',
      status: 'active',
      billingPeriod: 'owner',
      customerEmail: 'owner@example.com',
      lastValidatedAt: new Date().toISOString(),
    }));
    global.fetch = vi.fn();

    const notify = vi.fn();
    const { result } = renderHook(() => useBillingState({ notify }));

    expect(result.current.planLabel).toBe('Owner Pro');
    expect(result.current.statusCopy).toBe('Owner Pro access is active for this signed-in account.');
    expect(result.current.hasFeature('abTesting')).toBe(true);

    await act(async () => {
      await result.current.openManagePurchases();
    });

    expect(global.fetch).not.toHaveBeenCalled();
    expect(window.open).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith('Owner Pro access is managed by Prompt Lab owner settings.');
  });
});

describe('useBillingState entitlement cache policy', () => {
  const originalFetch = global.fetch;
  const HOUR = 60 * 60 * 1000;
  const DAY = 24 * HOUR;

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    global.fetch = originalFetch;
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('pins the documented six-hour cache and seven-day offline grace', () => {
    expect(BILLING_REVALIDATE_AFTER_MS).toBe(6 * HOUR);
    expect(BILLING_OFFLINE_GRACE_MS).toBe(7 * DAY);
  });

  it('keeps cached Pro offline within the grace window and pauses it afterwards', () => {
    const now = Date.parse('2026-10-18T12:00:00Z');
    const cached = { plan: 'pro', status: 'active', customerId: 'cus_123', billingPeriod: 'monthly' };
    const error = new Error('Billing service unavailable.');

    const within = applyFailedValidation({ ...cached, lastVerifiedAt: new Date(now - 6 * DAY).toISOString() }, error, now);
    expect(within.plan).toBe('pro');
    expect(within.status).toBe('offline');

    const expired = applyFailedValidation({ ...cached, lastVerifiedAt: new Date(now - 8 * DAY).toISOString() }, error, now);
    expect(expired.plan).toBe('free');
    expect(expired.status).toBe('verification_expired');
    expect(expired.customerId).toBe('cus_123');
    expect(expired.lastVerifiedAt).toBe(new Date(now - 8 * DAY).toISOString());
    expect(expired.lastValidatedAt).toBe(new Date(now).toISOString());
  });

  it('anchors legacy caches once so repeated failures cannot extend the grace window', () => {
    const now = Date.parse('2026-10-18T12:00:00Z');
    const legacyStamp = new Date(now - 5 * DAY).toISOString();
    const error = new Error('offline');
    const first = applyFailedValidation({ plan: 'pro', status: 'active', customerId: 'cus_123', lastValidatedAt: legacyStamp }, error, now);
    expect(first.status).toBe('offline');
    expect(first.lastVerifiedAt).toBe(legacyStamp);

    const later = applyFailedValidation(first, error, now + 3 * DAY);
    expect(later.plan).toBe('free');
    expect(later.status).toBe('verification_expired');
  });

  it('never expires owner access and leaves Free failures as errors', () => {
    const now = Date.now();
    const owner = applyFailedValidation({ plan: 'pro', status: 'owner', billingPeriod: 'owner', lastValidatedAt: new Date(now - 30 * DAY).toISOString() }, new Error('x'), now);
    expect(owner.plan).toBe('pro');
    const free = applyFailedValidation({ plan: 'free', status: 'free', customerId: 'cus_1' }, new Error('x'), now);
    expect(free.plan).toBe('free');
    expect(free.status).toBe('error');
    expect(free.lastVerifiedAt).toBe('');
  });

  it('pauses stale cached Pro on load when billing stays unreachable past the grace window', async () => {
    localStorage.setItem('pl2-billing', JSON.stringify({
      plan: 'pro',
      status: 'active',
      customerEmail: 'user@example.com',
      customerId: 'cus_123',
      lastValidatedAt: new Date(Date.now() - 8 * DAY).toISOString(),
      lastVerifiedAt: new Date(Date.now() - 8 * DAY).toISOString(),
    }));
    global.fetch = vi.fn(async () => { throw new Error('Billing service unavailable.'); });

    const { result } = renderHook(() => useBillingState({ notify: vi.fn() }));

    await waitFor(() => expect(result.current.status).toBe('verification_expired'));
    expect(result.current.plan).toBe('free');
    expect(result.current.statusCopy).toMatch(/could not be verified for 7 days/);
  });

  it('stamps lastVerifiedAt only on a successful server answer', async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({
      ok: true, plan: 'pro', status: 'active', billingPeriod: 'monthly', customerId: 'cus_123',
    }), { status: 200 }));
    const clerkGetToken = vi.fn(async () => 'clerk-token');
    const { result } = renderHook(() => useBillingState({ notify: vi.fn(), clerkGetToken }));

    await act(async () => { await result.current.activateLicense('user@example.com'); });
    const verifiedAt = result.current.lastVerifiedAt;
    expect(Date.parse(verifiedAt)).toBeGreaterThan(0);

    global.fetch = vi.fn(async () => { throw new Error('offline'); });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await act(async () => { await result.current.refreshLicense({ silent: true }); });
    expect(result.current.status).toBe('offline');
    expect(result.current.plan).toBe('pro');
    expect(result.current.lastVerifiedAt).toBe(verifiedAt);
    expect(Date.parse(result.current.lastValidatedAt)).toBeGreaterThan(Date.parse(verifiedAt));
  });

  it('re-checks a long-lived tab after six hours without a reload', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(new Date('2026-10-18T12:00:00Z'));
    const stamp = new Date().toISOString();
    localStorage.setItem('pl2-billing', JSON.stringify({
      plan: 'pro', status: 'active', billingPeriod: 'monthly', customerId: 'cus_123',
      customerEmail: 'user@example.com', lastValidatedAt: stamp, lastVerifiedAt: stamp,
    }));
    global.fetch = vi.fn(async () => new Response(JSON.stringify({
      ok: true, plan: 'free', status: 'canceled', customerId: 'cus_123',
    }), { status: 200 }));
    const clerkGetToken = vi.fn(async () => 'clerk-token');
    const { result } = renderHook(() => useBillingState({ notify: vi.fn(), clerkGetToken }));
    const settle = async () => {
      for (let i = 0; i < 5; i += 1) {
        // setTimeout stays real here, so this drains pending fetch promises.
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
      }
    };

    await act(async () => { vi.advanceTimersByTime(5 * HOUR); });
    await settle();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(result.current.plan).toBe('pro');

    await act(async () => { vi.advanceTimersByTime(HOUR + 16 * 60 * 1000); });
    await settle();
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(result.current.plan).toBe('free');
    expect(result.current.status).toBe('canceled');
  });
});
