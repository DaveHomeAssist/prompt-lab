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
    global.fetch = vi.fn(async () => new Response(JSON.stringify({
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
    }));

    const notify = vi.fn();
    const { result } = renderHook(() => useBillingState({ notify }));

    await act(async () => {
      await result.current.activateLicense('user@example.com');
    });

    expect(result.current.plan).toBe('pro');
    expect(result.current.billingPeriod).toBe('monthly');
    expect(result.current.customerId).toBe('cus_123');
    expect(result.current.hasFeature('abTesting')).toBe(true);
    expect(notify).toHaveBeenCalledWith('Prompt Lab Pro synced to this device.');
  });

  it('syncs Clerk identity into local billing state when available', async () => {
    const clerkUser = {
      id: 'user_123',
      primaryEmailAddress: { emailAddress: 'user@example.com' },
    };

    const { result } = renderHook(() => useBillingState({ notify: vi.fn(), clerkUser }));

    await waitFor(() => {
      expect(result.current.customerEmail).toBe('user@example.com');
      expect(result.current.clerkUserId).toBe('user_123');
    });
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

  it('backs off silent billing retries after an offline validation failure', async () => {
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

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(Date.now() - Date.parse(result.current.lastValidatedAt)).toBeLessThan(5000);
  });

  it('includes Clerk identity when starting hosted checkout', async () => {
    const clerkUser = {
      id: 'user_123',
      primaryEmailAddress: { emailAddress: 'user@example.com' },
    };
    const clerkGetToken = vi.fn(async () => 'token_123');
    const requests = [];

    global.fetch = vi.fn(async (_url, init) => {
      requests.push({
        headers: init.headers,
        body: JSON.parse(init.body),
      });
      return new Response(JSON.stringify({
        ok: true,
        url: 'https://checkout.stripe.com/c/pay/cs_test_123',
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const { result } = renderHook(() => useBillingState({ notify: vi.fn(), clerkUser, clerkGetToken }));

    await waitFor(() => {
      expect(result.current.clerkUserId).toBe('user_123');
    });

    await act(async () => {
      await result.current.startCheckout('monthly');
    });

    expect(clerkGetToken).toHaveBeenCalled();
    expect(requests).toHaveLength(1);
    expect(requests[0].headers.Authorization).toBe('Bearer token_123');
    expect(requests[0].body.clerkUserId).toBe('user_123');
    expect(requests[0].body.email).toBe('user@example.com');
    expect(window.open).toHaveBeenCalledWith(
      'https://checkout.stripe.com/c/pay/cs_test_123',
      '_blank',
      'noopener,noreferrer',
    );
  });
});
