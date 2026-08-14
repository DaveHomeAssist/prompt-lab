import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import useBillingState from '../hooks/useBillingState.js';

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

  it('normalizes Free owner markers to an ordinary Free state', () => {
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
    expect(result.current.hasFeature('collections')).toBe(false);
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
