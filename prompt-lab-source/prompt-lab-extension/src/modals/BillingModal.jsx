import { useEffect, useMemo, useRef, useState } from 'react';
import Ic from '../icons';
import { PRICE_COPY } from '../../../shared/pricing.js';
import {
  BILLING_FEATURES,
  getFeatureMeta,
  isPrelaunchOpenAccess,
} from '../lib/billing.js';

const FEATURE_LIST = Object.values(BILLING_FEATURES);

// Proposal 1 (conversion review, 2026-10-23): Annual is listed first and is the
// filled, primary choice with a "Best value" tag; Monthly is one click away as
// the secondary button. An explicit plan choice (landing toggle or the AUD-006
// signed-out ?period= handoff) keeps that plan highlighted and primary.
// All amounts come from shared/pricing.js.
const PLAN_ORDER = Object.freeze(['annual', 'monthly']);
const DEFAULT_PRIMARY_PERIOD = 'annual';
const PLAN_OPTIONS = Object.freeze({
  annual: Object.freeze({
    title: 'Go Pro Annual',
    tag: 'Best value',
    detail: `${PRICE_COPY.annualPerPeriod} (${PRICE_COPY.annualEffectiveMonthly}/month), save ${PRICE_COPY.annualSavings}`,
  }),
  monthly: Object.freeze({
    title: 'Go Pro Monthly',
    tag: '',
    detail: `${PRICE_COPY.monthlyPerPeriod}, cancel anytime`,
  }),
});

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
  const prelaunchOpenAccess = isPrelaunchOpenAccess(billing);
  // AUD-001: a Pro account never sees purchase CTAs; it manages billing instead.
  const isPro = billing.plan === 'pro';
  const showPurchase = !isPro && !billing.billingDisabled && !billing.checkoutDisabled;
  const overlayRef = useRef(null);
  const dialogRef = useRef(null);
  const closeButtonRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const safeRequestedPeriod = requestedPeriod === 'monthly' || requestedPeriod === 'annual'
    ? requestedPeriod
    : null;
  const primaryPeriod = safeRequestedPeriod || DEFAULT_PRIMARY_PERIOD;
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
    <div ref={overlayRef} className={`fixed inset-0 z-[90] flex items-center justify-center p-4 ${m.modalBg}`} onClick={onClose}>
      <div
        ref={dialogRef}
        className={`pl-modal-panel max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border p-5 shadow-2xl ${m.modal} ${m.border} ${m.text}`}
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
              {billing.plan === 'pro' ? 'Billing' : (prelaunchOpenAccess ? 'Prompt Lab Access' : 'Prompt Lab Pro')}
            </p>
            <h2 id="billing-modal-title" className={`mt-1 text-lg font-semibold ${m.text}`}>
              {prelaunchOpenAccess
                ? 'All workflow features are open'
                : (isPro
                  ? 'Prompt Lab Pro is active'
                  : (requestedFeature ? `${feature.label} is a Pro feature` : 'Unlock Prompt Lab Pro'))}
            </h2>
            <p id="billing-modal-description" className={`mt-2 text-sm leading-relaxed ${m.textMuted}`}>
              {prelaunchOpenAccess
                ? 'Billing is unavailable on this deployment, but every Prompt Lab workflow remains available during prelaunch.'
                : isPro
                ? 'Your account already has Prompt Lab Pro. Use Manage billing to change plan, update payment details, or cancel.'
                : (requestedFeature
                ? `${feature.description} Upgrade to Pro or sync an existing Stripe subscription to keep going.`
                : 'Use Stripe checkout for Prompt Lab Pro, then sync access on this device using the same billing email.')}
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className={`ui-control rounded-lg p-2 ${m.btn} ${m.textAlt} transition-colors hover:text-orange-400`}
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

        {billing.billingDisabled && (
          <div className="mt-4 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4" role="status">
            <p className="text-sm font-semibold text-amber-300">Purchases are temporarily unavailable</p>
            <p className="mt-1 text-xs leading-relaxed text-amber-200/90">
              Billing is currently disabled on this deployment, so checkout and purchase management
              are turned off. Existing Pro access on this device is unaffected. Please check back later.
            </p>
          </div>
        )}

        {!billing.billingDisabled && billing.checkoutDisabled && (
          <div className="mt-4 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4" role="status">
            <p className="text-sm font-semibold text-amber-300">Purchases are temporarily unavailable</p>
            <p className="mt-1 text-xs leading-relaxed text-amber-200/90">
              You can still manage existing purchases and refresh your access. Please check back later to start a new subscription.
            </p>
          </div>
        )}

        {billing.blockedExternal?.url && (
          <div data-testid="billing-blocked-tab" className="mt-4 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4" role="alert">
            <p className="text-sm font-semibold text-amber-200">Your browser blocked the new tab</p>
            <p className="mt-1 text-xs leading-relaxed text-amber-100/90">
              Open Stripe with the link below. It opens in a new tab and Prompt Lab stays open here.
            </p>
            <a
              href={billing.blockedExternal.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => billing.clearBlockedExternal?.()}
              className="ui-control mt-3 inline-flex rounded-lg bg-amber-500 px-3 py-2 text-xs font-semibold text-slate-950 transition-colors hover:bg-amber-400"
            >
              {billing.blockedExternal.kind === 'portal' ? 'Open billing portal' : 'Continue to Stripe Checkout'}
            </a>
          </div>
        )}

        {isPro && !billing.billingDisabled && (
          <div data-testid="billing-pro-manage" className="mt-4 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4">
            <p className="text-sm font-semibold text-emerald-200">You already have Prompt Lab Pro</p>
            <p className="mt-1 text-xs leading-relaxed text-emerald-100/90">
              There is nothing more to buy. Change plan, update payment details or cancel in the Stripe billing portal.
            </p>
            <button
              type="button"
              onClick={handleManagePurchases}
              disabled={billing.busyAction === 'portal'}
              className="ui-control mt-3 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-emerald-500 disabled:opacity-40"
            >
              Manage billing
            </button>
          </div>
        )}

        {showPurchase && safeRequestedPeriod && (
          <p className={`mt-4 text-xs leading-relaxed ${m.textMuted}`} role="status">
            Your {safeRequestedPeriod} choice from the pricing page is highlighted. Checkout starts only when you choose it below.
          </p>
        )}

        {showPurchase && (
        <div data-testid="billing-plan-options" className={`${safeRequestedPeriod ? 'mt-2' : 'mt-4'} grid gap-2 sm:grid-cols-2`}>
          {PLAN_ORDER.map((period) => {
            const plan = PLAN_OPTIONS[period];
            const isPrimary = period === primaryPeriod;
            const isRequested = safeRequestedPeriod === period;
            return (
              <button
                key={period}
                type="button"
                onClick={() => handleCheckout(period)}
                disabled={billing.busyAction === `checkout:${period}`}
                data-period={period}
                data-primary={isPrimary ? 'true' : undefined}
                data-requested={isRequested ? 'true' : undefined}
                className={`ui-control rounded-xl px-4 py-3 text-left transition-colors disabled:opacity-40 ${isPrimary
                  ? 'bg-orange-600 text-white hover:bg-orange-500'
                  : `border ${m.border} ${m.surface} ${m.text} hover:border-orange-400`} ${isRequested ? 'ring-2 ring-orange-300' : ''}`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold">{plan.title}</span>
                  {plan.tag && (
                    <span
                      data-testid="billing-best-value"
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${isPrimary ? 'bg-white/20 text-white' : 'bg-orange-500/15 text-orange-400'}`}
                    >
                      {plan.tag}
                    </span>
                  )}
                </div>
                {/* The primary card's price line inherits the button's action-text
                    colour. The theme maps text-orange-* to --pl-brand-ember-bright,
                    which equals the button fill in light mode (invisible text). */}
                <div data-testid="billing-plan-detail" className={`mt-1 text-xs ${isPrimary ? 'opacity-90' : m.textMuted}`}>{plan.detail}</div>
                {isRequested && (
                  <div className={`mt-2 text-[11px] font-semibold uppercase tracking-wider ${isPrimary ? 'text-white' : m.text}`}>Selected on pricing page</div>
                )}
              </button>
            );
          })}
        </div>
        )}

        {showPurchase && (
          <p data-testid="billing-terms" className={`mt-2 text-[11px] leading-relaxed ${m.textMuted}`}>
            New Pro subscriptions renew automatically at {PRICE_COPY.monthlyPerPeriod} or {PRICE_COPY.annualPerPeriod} until you cancel. Existing annual subscriptions retain their current price. Cancel anytime in Manage Purchases;
            Pro stays active until the end of the period you paid for. Full refunds are available within 14 days of
            your first payment or an annual renewal, and a refund ends Pro.
          </p>
        )}

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
            <label htmlFor="billing-email" className={`text-xs font-semibold uppercase tracking-wider ${m.textSub}`}>Billing email</label>
            <button
              type="button"
              onClick={handleManagePurchases}
              disabled={billing.busyAction === 'portal' || billing.billingDisabled}
              title={billing.billingDisabled ? 'Billing is currently disabled on this deployment.' : undefined}
              className={`ui-control inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold transition-colors ${m.btn} ${m.textAlt} disabled:opacity-40`}
            >
              <Ic n="ArrowRight" size={11} />
              Manage Purchases
            </button>
          </div>
          <div className="mt-2 flex flex-col gap-2">
            <input
              id="billing-email"
              value={accessEmail}
              onChange={(event) => setAccessEmail(event.target.value)}
              placeholder="Enter the email used at Stripe checkout"
              className={`${m.input} w-full rounded-lg border px-3 py-2 text-sm ${m.border} ${m.text} focus:border-orange-500 focus:outline-none`}
            />
            <p className={`text-[11px] leading-relaxed ${m.textMuted}`}>
              Stripe keeps customer records. Prompt Lab also checks signed-in owner access from your account.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleActivate}
                disabled={billing.billingDisabled || (!accessEmail.trim() && !billing.clerkUserId) || billing.busyAction === 'activate'}
                title={billing.billingDisabled ? 'Billing is currently disabled on this deployment.' : undefined}
                className="ui-control rounded-lg bg-orange-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-orange-500 disabled:opacity-40"
              >
                Sync Purchase
              </button>
              <button
                type="button"
                onClick={handleRefresh}
                disabled={billing.billingDisabled || (!billing.customerEmail && !billing.customerId && !billing.clerkUserId) || billing.busyAction === 'validate'}
                title={billing.billingDisabled ? 'Billing is currently disabled on this deployment.' : undefined}
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
            <p role="alert" aria-live="assertive" className="mt-2 text-xs text-red-400">{localError || billing.validationError}</p>
          )}
        </div>

        <div className={`mt-5 rounded-xl border p-3 ${m.codeBlock} ${m.border}`}>
          <p className={`text-xs font-semibold uppercase tracking-wider ${m.textSub}`}>
            {prelaunchOpenAccess ? 'Prompt Lab includes' : 'Prompt Lab Pro includes'}
          </p>
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
