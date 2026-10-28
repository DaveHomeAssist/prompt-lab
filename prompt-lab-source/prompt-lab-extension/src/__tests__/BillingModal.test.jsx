import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import BillingModal from '../modals/BillingModal.jsx';

const theme = {
  modalBg: 'modal-bg',
  modal: 'modal',
  border: 'border',
  text: 'text',
  textMuted: 'text-muted',
  textAlt: 'text-alt',
  textSub: 'text-sub',
  btn: 'button',
  surface: 'surface',
  input: 'input',
  dangerGhost: 'danger',
  codeBlock: 'code',
};

function createBilling() {
  return {
    customerEmail: '',
    customerName: '',
    customerId: '',
    clerkUserId: '',
    plan: 'free',
    planLabel: 'Free',
    statusCopy: 'Free plan is active.',
    busyAction: '',
    validationError: '',
    billingDisabled: false,
    ownerAccessAvailable: false,
    startCheckout: vi.fn(async () => true),
    activateLicense: vi.fn(async () => true),
    refreshLicense: vi.fn(async () => true),
    openManagePurchases: vi.fn(async () => true),
    deactivateLicense: vi.fn(async () => true),
    activateOwnerAccess: vi.fn(async () => true),
  };
}

describe('BillingModal landing period handoff', () => {
  it.each(['monthly', 'annual'])('highlights %s without starting checkout automatically', (period) => {
    const billing = createBilling();
    render(
      <BillingModal
        m={theme}
        billing={billing}
        requestedPeriod={period}
        requestedSource="landing-pricing"
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole('status')).toHaveTextContent(`Your ${period} choice`);
    const requestedButton = screen.getByRole('button', {
      name: period === 'monthly' ? /Go Pro Monthly/ : /Go Pro Annual/,
    });
    expect(requestedButton).toHaveAttribute('data-requested', 'true');
    expect(requestedButton).toHaveTextContent('Selected on pricing page');
    expect(requestedButton).toHaveTextContent(period === 'monthly' ? '$9/month' : '$79/year');
    expect(billing.startCheckout).not.toHaveBeenCalled();

    fireEvent.click(requestedButton);
    expect(billing.startCheckout).toHaveBeenCalledTimes(1);
    expect(billing.startCheckout).toHaveBeenCalledWith(period, 'landing-pricing');
  });

  it('ignores a non-allowlisted requested period', () => {
    const billing = createBilling();
    render(
      <BillingModal
        m={theme}
        billing={billing}
        requestedPeriod="weekly"
        onClose={vi.fn()}
      />,
    );

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(document.querySelector('[data-requested="true"]')).toBeNull();
    expect(billing.startCheckout).not.toHaveBeenCalled();
  });

  it('disables billing actions when billing is unavailable', () => {
    const billing = {
      ...createBilling(),
      customerEmail: 'user@example.com',
      billingDisabled: true,
    };
    render(
      <BillingModal
        m={theme}
        billing={billing}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole('status')).toHaveTextContent('Purchases are temporarily unavailable');
    const syncButton = screen.getByRole('button', { name: 'Sync Purchase' });
    const refreshButton = screen.getByRole('button', { name: 'Refresh Status' });
    expect(syncButton).toBeDisabled();
    expect(refreshButton).toBeDisabled();

    fireEvent.click(syncButton);
    fireEvent.click(refreshButton);
    expect(billing.activateLicense).not.toHaveBeenCalled();
    expect(billing.refreshLicense).not.toHaveBeenCalled();
  });

  it('hides unavailable checkout while retaining existing purchase management', () => {
    const billing = { ...createBilling(), checkoutDisabled: true, clerkUserId: 'user_test' };
    render(<BillingModal m={theme} billing={billing} requestedPeriod="annual" onClose={vi.fn()} />);

    expect(screen.getByRole('status')).toHaveTextContent('Purchases are temporarily unavailable');
    expect(screen.queryByRole('button', { name: /Go Pro/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Manage Purchases' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Sync Purchase' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Refresh Status' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Manage Purchases' }));
    expect(billing.openManagePurchases).toHaveBeenCalledTimes(1);
    expect(billing.startCheckout).not.toHaveBeenCalled();
  });

  it('shows open prelaunch access instead of an upgrade prompt for Free billing-disabled state', () => {
    const billing = {
      ...createBilling(),
      billingDisabled: true,
      statusCopy: 'All workflow features are available during prelaunch. Purchases are temporarily unavailable.',
    };
    render(
      <BillingModal
        m={theme}
        billing={billing}
        requestedFeature="collections"
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole('dialog', { name: 'All workflow features are open' })).toBeInTheDocument();
    expect(screen.getByText('All workflow features are available during prelaunch. Purchases are temporarily unavailable.')).toBeInTheDocument();
    expect(screen.queryByText('Collections is a Pro feature')).not.toBeInTheDocument();
    expect(screen.queryByText('Unlock Prompt Lab Pro')).not.toBeInTheDocument();
    expect(screen.getByText('Prompt Lab includes')).toBeInTheDocument();
  });

  it('traps focus, closes with Escape, restores focus, and isolates the background', () => {
    const billing = createBilling();
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <div>
          <button type="button" onClick={() => setOpen(true)}>Open billing</button>
          {open && (
            <BillingModal
              m={theme}
              billing={billing}
              requestedPeriod="annual"
              requestedSource="landing-pricing"
              onClose={() => setOpen(false)}
            />
          )}
        </div>
      );
    }

    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Open billing' });
    trigger.focus();
    fireEvent.click(trigger);

    const dialog = screen.getByRole('dialog', { name: 'Unlock Prompt Lab Pro' });
    const closeButton = screen.getByRole('button', { name: 'Close billing modal' });
    expect(closeButton).toHaveFocus();
    expect(trigger).toHaveAttribute('inert');
    expect(trigger).toHaveAttribute('aria-hidden', 'true');
    expect(document.body.style.overflow).toBe('hidden');

    const focusable = Array.from(dialog.querySelectorAll('button:not([disabled]), input:not([disabled])'));
    const last = focusable.at(-1);
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(last).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(closeButton).toHaveFocus();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(trigger).not.toHaveAttribute('inert');
    expect(trigger).not.toHaveAttribute('aria-hidden');
    expect(document.body.style.overflow).toBe('');
  });
});

describe('BillingModal plan order (conversion proposal 1)', () => {
  function planButtons() {
    return within(screen.getByTestId('billing-plan-options')).getAllByRole('button');
  }

  it('lists Annual first as the primary choice with a Best value tag', () => {
    const billing = createBilling();
    render(<BillingModal m={theme} billing={billing} onClose={vi.fn()} />);

    const [first, second] = planButtons();
    expect(planButtons()).toHaveLength(2);
    expect(first).toHaveAttribute('data-period', 'annual');
    expect(first).toHaveAccessibleName(/Go Pro Annual/);
    expect(first).toHaveAttribute('data-primary', 'true');
    expect(first.className).toContain('bg-orange-600');
    expect(within(first).getByTestId('billing-best-value')).toHaveTextContent('Best value');
    expect(first).toHaveTextContent('$79/year ($6.58/month), save $29');

    expect(second).toHaveAttribute('data-period', 'monthly');
    expect(second).toHaveAccessibleName(/Go Pro Monthly/);
    expect(second).not.toHaveAttribute('data-primary');
    expect(second.className).not.toContain('bg-orange-600');
    expect(within(second).queryByTestId('billing-best-value')).toBeNull();
    expect(second).toHaveTextContent('$9/month, cancel anytime');
    expect(screen.getAllByTestId('billing-best-value')).toHaveLength(1);

    // No plan is marked as chosen on the pricing page without an explicit choice.
    expect(document.querySelector('[data-requested="true"]')).toBeNull();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it.each([
    ['annual', 'billing-modal', undefined],
    ['monthly', 'billing-modal', undefined],
    ['annual', 'collections', 'collections'],
    ['monthly', 'collections', 'collections'],
  ])('starts %s checkout with source %s when that button is clicked', (period, source, requestedFeature) => {
    const billing = createBilling();
    render(<BillingModal m={theme} billing={billing} requestedFeature={requestedFeature} onClose={vi.fn()} />);
    expect(billing.startCheckout).not.toHaveBeenCalled();
    fireEvent.click(planButtons().find((button) => button.dataset.period === period));
    expect(billing.startCheckout).toHaveBeenCalledTimes(1);
    expect(billing.startCheckout).toHaveBeenCalledWith(period, source);
  });

  it('keeps an explicit monthly choice selected and primary, with Annual still first', () => {
    const billing = createBilling();
    render(
      <BillingModal
        m={theme}
        billing={billing}
        requestedPeriod="monthly"
        requestedSource="landing-pricing"
        onClose={vi.fn()}
      />,
    );

    const [annual, monthly] = planButtons();
    expect(annual).toHaveAttribute('data-period', 'annual');
    expect(monthly).toHaveAttribute('data-period', 'monthly');
    expect(monthly).toHaveAttribute('data-requested', 'true');
    expect(monthly).toHaveAttribute('data-primary', 'true');
    expect(monthly.className).toContain('bg-orange-600');
    expect(monthly).toHaveTextContent('Selected on pricing page');
    expect(annual).not.toHaveAttribute('data-primary');
    expect(annual).not.toHaveAttribute('data-requested');
    expect(annual).not.toHaveTextContent('Selected on pricing page');
    expect(within(annual).getByTestId('billing-best-value')).toHaveTextContent('Best value');
    expect(screen.getByRole('status')).toHaveTextContent('Your monthly choice from the pricing page is highlighted');

    fireEvent.click(monthly);
    expect(billing.startCheckout).toHaveBeenCalledWith('monthly', 'landing-pricing');
  });

  it('keeps an explicit annual choice selected and primary', () => {
    render(
      <BillingModal
        m={theme}
        billing={createBilling()}
        requestedPeriod="annual"
        requestedSource="landing-pricing"
        onClose={vi.fn()}
      />,
    );
    const [annual, monthly] = planButtons();
    expect(annual).toHaveAttribute('data-requested', 'true');
    expect(annual).toHaveAttribute('data-primary', 'true');
    expect(monthly).not.toHaveAttribute('data-primary');
  });
});

describe('BillingModal billing policy disclosure', () => {
  it('states renewal, cancellation and refund terms next to checkout', () => {
    render(<BillingModal m={theme} billing={createBilling()} onClose={vi.fn()} />);
    const terms = screen.getByTestId('billing-terms');
    expect(terms).toHaveTextContent('New Pro subscriptions renew automatically at $9/month or $79/year until you cancel');
    expect(terms).toHaveTextContent('Existing annual subscriptions retain their current price.');
    expect(terms).toHaveTextContent('Cancel anytime in Manage Purchases');
    expect(terms).toHaveTextContent('until the end of the period you paid for');
    expect(terms).toHaveTextContent('within 14 days of your first payment or an annual renewal');
  });

  it('omits purchase terms when checkout is not offered', () => {
    render(<BillingModal m={theme} billing={{ ...createBilling(), checkoutDisabled: true }} onClose={vi.fn()} />);
    expect(screen.queryByTestId('billing-terms')).toBeNull();
  });
});

describe('BillingModal for accounts that already have Pro (AUD-001)', () => {
  it.each([
    ['active', undefined],
    ['trialing', 'annual'],
    ['owner', 'monthly'],
  ])('shows Manage billing instead of Go Pro for a %s Pro account', (status, requestedPeriod) => {
    const billing = {
      ...createBilling(),
      plan: 'pro',
      status,
      planLabel: 'Prompt Lab Pro',
      statusCopy: 'Pro is active.',
    };
    render(
      <BillingModal
        m={theme}
        billing={billing}
        requestedPeriod={requestedPeriod}
        requestedSource={requestedPeriod ? 'landing-pricing' : undefined}
        onClose={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: /Go Pro/ })).not.toBeInTheDocument();
    expect(screen.queryByTestId('billing-terms')).not.toBeInTheDocument();
    expect(screen.queryByText(/choice from the pricing page/)).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Prompt Lab Pro is active' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Manage billing' }));
    expect(billing.openManagePurchases).toHaveBeenCalledTimes(1);
    expect(billing.startCheckout).not.toHaveBeenCalled();
  });

  it('still offers Go Pro to a Free account', () => {
    render(<BillingModal m={theme} billing={createBilling()} onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Go Pro Monthly/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Manage billing' })).not.toBeInTheDocument();
  });
});
