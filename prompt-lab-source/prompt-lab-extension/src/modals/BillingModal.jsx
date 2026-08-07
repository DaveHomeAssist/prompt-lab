import { useEffect, useMemo, useRef, useState } from 'react';
import Ic from '../icons';
import { BILLING_FEATURES, getFeatureMeta } from '../lib/billing.js';

const FEATURE_LIST = Object.values(BILLING_FEATURES);

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export default function BillingModal({
  m,
  billing,
  requestedFeature,
  requestedPeriod,
  requestedSource,
  onClose,
}) {
  const [accessEmail, setAccessEmail] = useState(billing.customerEmail || '');
  const [localError, setLocalError] = useState('');
  const feature = useMemo(() => getFeatureMeta(requestedFeature), [requestedFeature]);
  const overlayRef = useRef(null);
  const dialogRef = useRef(null);
  const closeButtonRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const safeRequestedPeriod = requestedPeriod === 'monthly' || requestedPeriod === 'annual'
    ? requestedPeriod
    : null;
  const checkoutSource = requestedSource === 'landing-pricing'
    ? 'landing-pricing'
    : (requestedFeature || 'billing-modal');

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const overlay = overlayRef.current;
    const parent = overlay?.parentElement;
    const backgroundState = parent
      ? Array.from(parent.children)
        .filter((element) => element !== overlay)
        .map((element) => ({
          element,
          inert: element.getAttribute('inert'),
          ariaHidden: element.getAttribute('aria-hidden'),
        }))
      : [];
    const previousBodyOverflow = document.body.style.overflow;

    backgroundState.forEach(({ element }) => {
      element.setAttribute('inert', '');
      element.setAttribute('aria-hidden', 'true');
    });
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current?.();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = Array.from(dialogRef.current?.querySelectorAll(FOCUSABLE_SELECTOR) || []);
      if (focusable.length === 0) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && (document.activeElement === first || !dialogRef.current?.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialogRef.current?.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      document.body.style.overflow = previousBodyOverflow;
      backgroundState.forEach(({ element, inert, ariaHidden }) => {
        if (inert == null) element.removeAttribute('inert');
        else element.setAttribute('inert', inert);
        if (ariaHidden == null) element.removeAttribute('aria-hidden');
        else element.setAttribute('aria-hidden', ariaHidden);
      });
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  useEffect(() => {
    setAccessEmail(billing.customerEmail || '');
  }, [billing.customerEmail]);

  useEffect(() => {
    setLocalError('');
  }, [requestedFeature]);

  async function handleActivate() {
    try {
      setLocalError('');
      await billing.activateLicense(accessEmail);
    } catch (error) {
      setLocalError(error.message || 'Could not sync this purchase.');
    }
  }

  async function handleRefresh() {
    try {
      setLocalError('');
      await billing.refreshLicense();
    } catch (error) {
      setLocalError(error.message || 'Could not verify billing.');
    }
  }

  async function handleManagePurchases() {
    try {
      setLocalError('');
      await billing.openManagePurchases({ customerEmail: accessEmail || billing.customerEmail });
    } catch (error) {
      setLocalError(error.message || 'Could not open billing portal.');
    }
  }

  async function handleCheckout(period) {
    try {
      setLocalError('');
      await billing.startCheckout(period, checkoutSource);
    } catch (error) {
      setLocalError(error.message || 'Could not open Stripe checkout.');
    }
  }

  async function handleDeactivate() {
    try {
      setLocalError('');
      await billing.deactivateLicense();
    } catch (error) {
      setLocalError(error.message || 'Could not deactivate this device.');
    }
  }

  async function handleOwnerAccess() {
    try {
      setLocalError('');
      await billing.activateOwnerAccess();
    } catch (error) {
      setLocalError(error.message || 'Could not enable owner access.');
    }
  }

  return (
    <div ref={overlayRef} className={`fixed inset-0 z-[70] flex items-center justify-center p-4 ${m.modalBg}`} onClick={onClose}>
      <div
        ref={dialogRef}
        className={`pl-modal-panel w-full max-w-lg rounded-2xl border p-5 shadow-2xl ${m.modal} ${m.border} ${m.text}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="billing-modal-title"
        aria-describedby="billing-modal-description"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className={`text-[11px] font-semibold uppercase tracking-[0.22em] ${m.textMuted}`}>
              {billing.plan === 'pro' ? 'Billing' : 'Prompt Lab Pro'}
            </p>
            <h2 id="billing-modal-title" className={`mt-1 text-lg font-semibold ${m.text}`}>
              {requestedFeature ? `${feature.label} is a Pro feature` : 'Unlock Prompt Lab Pro'}
            </h2>
            <p id="billing-modal-description" className={`mt-2 text-sm leading-relaxed ${m.textMuted}`}>
              {requestedFeature
                ? `${feature.description} Upgrade to Pro or sync an existing Stripe subscription to keep going.`
                : 'Use Stripe checkout for Prompt Lab Pro, then sync access on this device using the same billing email.'}
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className={`ui-control rounded-lg p-2 ${m.btn} ${m.textAlt} transition-colors hover:text-violet-400`}
            aria-label="Close billing modal"
          >
            <Ic n="X" size={14} />
          </button>
        </div>

        <div className={`mt-4 rounded-xl border p-3 ${m.surface} ${m.border}`}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className={`text-sm font-semibold ${m.text}`}>{billing.planLabel}</p>
              <p className={`mt-1 text-xs leading-relaxed ${m.textMuted}`}>{billing.statusCopy}</p>
            </div>
            <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${billing.plan === 'pro' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-slate-500/15 text-slate-300'}`}>
              {billing.plan === 'pro' ? 'Active' : 'Free'}
            </span>
          </div>
          {(billing.customerEmail || billing.customerName) && (
            <div className={`mt-3 text-xs ${m.textMuted}`}>
              {billing.customerName && <div>{billing.customerName}</div>}
              {billing.customerEmail && <div>{billing.customerEmail}</div>}
            </div>
          )}
        </div>

        {safeRequestedPeriod && (
          <p className={`mt-4 text-xs leading-relaxed ${m.textMuted}`} role="status">
            Your {safeRequestedPeriod} choice from the pricing page is highlighted. Checkout starts only when you choose it below.
          </p>
        )}

        <div className={`${safeRequestedPeriod ? 'mt-2' : 'mt-4'} grid gap-2 sm:grid-cols-2`}>
          <button
            type="button"
            onClick={() => handleCheckout('monthly')}
            disabled={billing.busyAction === 'checkout:monthly'}
            data-requested={safeRequestedPeriod === 'monthly' ? 'true' : undefined}
            className={`ui-control rounded-xl bg-violet-600 px-4 py-3 text-left text-white transition-colors hover:bg-violet-500 disabled:opacity-40 ${safeRequestedPeriod === 'monthly' ? 'ring-2 ring-violet-300' : ''}`}
          >
            <div className="text-sm font-semibold">Go Pro Monthly</div>
            <div className="mt-1 text-xs text-violet-100">$9/month via Stripe</div>
            {safeRequestedPeriod === 'monthly' && (
              <div className="mt-2 text-[11px] font-semibold uppercase tracking-wider text-white">Selected on pricing page</div>
            )}
          </button>
          <button
            type="button"
            onClick={() => handleCheckout('annual')}
            disabled={billing.busyAction === 'checkout:annual'}
            data-requested={safeRequestedPeriod === 'annual' ? 'true' : undefined}
            className={`ui-control rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-left text-emerald-100 transition-colors hover:border-emerald-400 hover:bg-emerald-500/15 disabled:opacity-40 ${safeRequestedPeriod === 'annual' ? 'ring-2 ring-emerald-300' : ''}`}
          >
            <div className="text-sm font-semibold">Go Pro Annual</div>
            <div className="mt-1 text-xs text-emerald-200">$100/year, best value</div>
            {safeRequestedPeriod === 'annual' && (
              <div className="mt-2 text-[11px] font-semibold uppercase tracking-wider text-emerald-100">Selected on pricing page</div>
            )}
          </button>
        </div>

        {billing.ownerAccessAvailable && billing.plan !== 'pro' && (
          <div className={`mt-4 rounded-xl border p-3 ${m.surface} ${m.border}`}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className={`text-sm font-semibold ${m.text}`}>Owner access</p>
                <p className={`mt-1 text-xs leading-relaxed ${m.textMuted}`}>
                  Local desktop/dev builds can unlock Pro without Stripe.
                </p>
              </div>
              <button
                type="button"
                onClick={handleOwnerAccess}
                className="ui-control rounded-lg bg-orange-500/90 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-orange-400"
              >
                Enable Owner Pro
              </button>
            </div>
          </div>
        )}

        <div className="mt-5">
          <div className="flex items-center justify-between gap-2">
            <p className={`text-xs font-semibold uppercase tracking-wider ${m.textSub}`}>Billing email</p>
            <button
              type="button"
              onClick={handleManagePurchases}
              disabled={billing.busyAction === 'portal'}
              className={`ui-control inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold transition-colors ${m.btn} ${m.textAlt}`}
            >
              <Ic n="ArrowRight" size={11} />
              Manage Purchases
            </button>
          </div>
          <div className="mt-2 flex flex-col gap-2">
            <input
              value={accessEmail}
              onChange={(event) => setAccessEmail(event.target.value)}
              placeholder="Enter the email used at Stripe checkout"
              className={`${m.input} w-full rounded-lg border px-3 py-2 text-sm ${m.border} ${m.text} focus:border-violet-500 focus:outline-none`}
            />
            <p className={`text-[11px] leading-relaxed ${m.textMuted}`}>
              Stripe keeps customer records. Prompt Lab also checks signed-in owner access from your account.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleActivate}
                disabled={(!accessEmail.trim() && !billing.clerkUserId) || billing.busyAction === 'activate'}
                className="ui-control rounded-lg bg-violet-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-violet-500 disabled:opacity-40"
              >
                Sync Purchase
              </button>
              <button
                type="button"
                onClick={handleRefresh}
                disabled={(!billing.customerEmail && !billing.customerId && !billing.clerkUserId) || billing.busyAction === 'validate'}
                className={`ui-control rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${m.btn} ${m.textAlt} disabled:opacity-40`}
              >
                Refresh Status
              </button>
              {billing.plan === 'pro' && (billing.customerEmail || billing.customerId) && (
                <button
                  type="button"
                  onClick={handleDeactivate}
                  disabled={billing.busyAction === 'deactivate'}
                  className={`ui-control rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${m.dangerGhost} disabled:opacity-40`}
                >
                  Clear Local Access
                </button>
              )}
            </div>
          </div>
          {(localError || billing.validationError) && (
            <p className="mt-2 text-xs text-red-400">{localError || billing.validationError}</p>
          )}
        </div>

        <div className={`mt-5 rounded-xl border p-3 ${m.codeBlock} ${m.border}`}>
          <p className={`text-xs font-semibold uppercase tracking-wider ${m.textSub}`}>Prompt Lab Pro includes</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {FEATURE_LIST.map((item) => (
              <div key={item.id} className="flex items-start gap-2">
                <Ic n="Check" size={12} className="mt-0.5 text-emerald-400" />
                <div>
                  <p className={`text-sm font-medium ${m.text}`}>{item.label}</p>
                  <p className={`text-xs leading-relaxed ${m.textMuted}`}>{item.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
