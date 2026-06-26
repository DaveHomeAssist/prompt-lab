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
