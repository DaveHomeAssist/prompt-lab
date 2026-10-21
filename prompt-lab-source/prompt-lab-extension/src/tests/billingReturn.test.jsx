import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import useBillingState from '../hooks/useBillingState.js';
import BillingModal from '../modals/BillingModal.jsx';
import {
  consumeBillingReturnFromLocation,
  navigateExternalTab,
  parseBillingReturn,
  preopenExternalTab,
  stripBillingReturnParam,
} from '../lib/billingReturn.js';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function fakeTab() {
  return { closed: false, opener: { leaked: true }, location: { replace: vi.fn() }, close: vi.fn() };
}

describe('billing return helpers (AUD-009)', () => {
  it('parses success and every cancel spelling, ignores anything else', () => {
    expect(parseBillingReturn('?billing=success')).toBe('success');
    for (const value of ['cancel', 'canceled', 'cancelled', 'CANCELLED']) {
      expect(parseBillingReturn(`?billing=${value}`)).toBe('cancelled');
    }
    expect(parseBillingReturn('?billing=maybe')).toBeNull();
    expect(parseBillingReturn('')).toBeNull();
  });

  it('strips only the billing parameter and keeps the hash route', () => {
    expect(stripBillingReturnParam('https://promptlab.tools/app/?billing=success&x=1#/library')).toBe('/app/?x=1#/library');
    expect(stripBillingReturnParam('https://promptlab.tools/app/?billing=cancelled')).toBe('/app/');
  });

  it('consumes the parameter from the location exactly once', () => {
    window.history.replaceState(null, '', '/app/?billing=success#/create');
    expect(consumeBillingReturnFromLocation()).toBe('success');
    expect(window.location.search).toBe('');
    expect(window.location.hash).toBe('#/create');
    expect(consumeBillingReturnFromLocation()).toBeNull();
  });

  it('pre-opens a blank tab and later points it at Stripe without an opener', () => {
    const tab = fakeTab();
    const win = { open: vi.fn(() => tab) };
    expect(preopenExternalTab(win)).toBe(tab);
    expect(win.open).toHaveBeenCalledWith('', '_blank');
    expect(navigateExternalTab(tab, 'https://checkout.stripe.com/c/pay/cs_1')).toBe(true);
    expect(tab.opener).toBeNull();
    expect(tab.location.replace).toHaveBeenCalledWith('https://checkout.stripe.com/c/pay/cs_1');
    expect(preopenExternalTab({ open: () => null })).toBeNull();
    expect(navigateExternalTab(null, 'https://x')).toBe(false);
  });
});

describe('useBillingState checkout tab and return handling (AUD-009)', () => {
  const originalFetch = global.fetch;
  const originalOpen = window.open;

  beforeEach(() => {
    localStorage.clear();
    vi.stubEnv('VITE_WEB_MODE', 'true');
    window.history.replaceState(null, '', '/app/');
  });

  afterEach(() => {
    global.fetch = originalFetch;
    window.open = originalOpen;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    localStorage.clear();
    window.history.replaceState(null, '', '/');
  });

  it('opens the tab synchronously on click, then sends it to Stripe', async () => {
    const tab = fakeTab();
    let fetchStarted = false;
    window.open = vi.fn(() => {
      expect(fetchStarted).toBe(false);
      return tab;
    });
    global.fetch = vi.fn(async () => {
      fetchStarted = true;
      return jsonResponse({ ok: true, url: 'https://checkout.stripe.com/c/pay/cs_live_1' });
    });
    const notify = vi.fn();
    const { result } = renderHook(() => useBillingState({ notify, clerkGetToken: vi.fn(async () => 'tok') }));

    let opened;
    await act(async () => {
      opened = await result.current.startCheckout('annual');
    });

    expect(opened).toBe(true);
    expect(window.open).toHaveBeenCalledWith('', '_blank');
    expect(tab.location.replace).toHaveBeenCalledWith('https://checkout.stripe.com/c/pay/cs_live_1');
    expect(tab.opener).toBeNull();
    expect(tab.close).not.toHaveBeenCalled();
    expect(result.current.blockedExternal).toBeNull();
    expect(notify).toHaveBeenCalledWith('Stripe Checkout opened in a new tab.');
  });

  it('shows a visible fallback link when the browser blocks the tab', async () => {
    window.open = vi.fn(() => null);
    global.fetch = vi.fn(async () => jsonResponse({ ok: true, url: 'https://checkout.stripe.com/c/pay/cs_live_2' }));
    const notify = vi.fn();
    const { result } = renderHook(() => useBillingState({ notify, clerkGetToken: vi.fn(async () => 'tok') }));

    let opened;
    await act(async () => {
      opened = await result.current.startCheckout('monthly');
    });

    expect(opened).toBe(false);
    expect(result.current.blockedExternal).toEqual({ kind: 'checkout', url: 'https://checkout.stripe.com/c/pay/cs_live_2' });
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('blocked the Stripe Checkout tab'));
  });

  it('closes the pre-opened tab when checkout fails', async () => {
    const tab = fakeTab();
    window.open = vi.fn(() => tab);
    global.fetch = vi.fn(async () => jsonResponse({ error: 'Stripe is down.' }, 502));
    const { result } = renderHook(() => useBillingState({ notify: vi.fn(), clerkGetToken: vi.fn(async () => 'tok') }));

    await act(async () => {
      await result.current.startCheckout('monthly').catch(() => {});
    });

    expect(tab.close).toHaveBeenCalledTimes(1);
    expect(tab.location.replace).not.toHaveBeenCalled();
  });

  it('applies the same pattern to the billing portal', async () => {
    window.open = vi.fn(() => null);
    global.fetch = vi.fn(async () => jsonResponse({ ok: true, url: 'https://billing.stripe.com/p/session/1' }));
    const { result } = renderHook(() => useBillingState({ notify: vi.fn(), clerkGetToken: vi.fn(async () => 'tok') }));
    await act(async () => {
      await result.current.openManagePurchases();
    });
    expect(result.current.blockedExternal).toEqual({ kind: 'portal', url: 'https://billing.stripe.com/p/session/1' });
  });

  it('on ?billing=success refreshes entitlement, toasts and cleans the URL', async () => {
    window.history.replaceState(null, '', '/app/?billing=success#/create');
    localStorage.setItem('pl2-billing', JSON.stringify({ plan: 'free', status: 'free', clerkUserId: 'user_1' }));
    global.fetch = vi.fn(async () => jsonResponse({ ok: true, plan: 'pro', status: 'active', billingPeriod: 'annual' }));
    const notify = vi.fn();
    const { result } = renderHook(() => useBillingState({ notify, clerkGetToken: vi.fn(async () => 'tok') }));

    expect(window.location.search).toBe('');
    expect(window.location.hash).toBe('#/create');
    await waitFor(() => expect(notify).toHaveBeenCalledWith('Welcome to Prompt Lab Pro. Your subscription is active.'));
    expect(result.current.plan).toBe('pro');
  });

  it('on ?billing=cancelled toasts that nothing was charged and cleans the URL', async () => {
    window.history.replaceState(null, '', '/app/?billing=cancelled');
    global.fetch = vi.fn(async () => jsonResponse({ ok: true, plan: 'free', status: 'free' }));
    const notify = vi.fn();
    renderHook(() => useBillingState({ notify }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith('Checkout canceled. You have not been charged.'));
    expect(window.location.search).toBe('');
  });
});

describe('BillingModal blocked-tab fallback (AUD-009)', () => {
  it('renders a link to the Stripe URL', () => {
    const clearBlockedExternal = vi.fn();
    render(
      <BillingModal
        m={{}}
        billing={{
          plan: 'free', planLabel: 'Free', statusCopy: '', customerEmail: '', busyAction: '',
          blockedExternal: { kind: 'checkout', url: 'https://checkout.stripe.com/c/pay/cs_live_3' },
          clearBlockedExternal,
        }}
        onClose={vi.fn()}
      />,
    );
    const link = screen.getByRole('link', { name: 'Continue to Stripe Checkout' });
    expect(link).toHaveAttribute('href', 'https://checkout.stripe.com/c/pay/cs_live_3');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    fireEvent.click(link);
    expect(clearBlockedExternal).toHaveBeenCalled();
  });
});
