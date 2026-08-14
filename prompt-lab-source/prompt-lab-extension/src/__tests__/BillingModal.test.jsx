import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
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
