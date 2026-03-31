import { useEffect, useMemo, useState } from 'react';
import Ic from '../icons';
import { BILLING_FEATURES, getFeatureMeta } from '../lib/billing.js';

const FEATURE_LIST = Object.values(BILLING_FEATURES);

export default function BillingModal({ m, billing, requestedFeature, onClose }) {
  const [licenseKey, setLicenseKey] = useState(billing.licenseKey || '');
  const [localError, setLocalError] = useState('');
  const feature = useMemo(() => getFeatureMeta(requestedFeature), [requestedFeature]);

  useEffect(() => {
    setLicenseKey(billing.licenseKey || '');
  }, [billing.licenseKey]);

  useEffect(() => {
    setLocalError('');
  }, [requestedFeature]);

  async function handleActivate() {
    try {
      setLocalError('');
      await billing.activateLicense(licenseKey);
    } catch (error) {
      setLocalError(error.message || 'Could not activate this license.');
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
      await billing.openManagePurchases();
    } catch (error) {
      setLocalError(error.message || 'Could not open billing portal.');
    }
  }

  async function handleCheckout(period) {
    try {
      setLocalError('');
      await billing.startCheckout(period, requestedFeature || 'billing-modal');
    } catch (error) {
      setLocalError(error.message || 'Could not open Lemon Squeezy checkout.');
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

  return (
    <div className={`fixed inset-0 z-[70] flex items-center justify-center p-4 ${m.modalBg}`} onClick={onClose}>
      <div
        className={`pl-modal-panel w-full max-w-lg rounded-2xl border p-5 shadow-2xl ${m.modal} ${m.border} ${m.text}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="billing-modal-title"
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
            <p className={`mt-2 text-sm leading-relaxed ${m.textMuted}`}>
              {requestedFeature
                ? `${feature.description} Upgrade to Pro or activate an existing Lemon Squeezy license key to keep going.`
                : 'Use Lemon Squeezy checkout for Prompt Lab Pro, then activate the license key from your receipt email here.'}
            </p>
          </div>
          <button
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

        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => handleCheckout('monthly')}
            disabled={billing.busyAction === 'checkout:monthly'}
            className="ui-control rounded-xl bg-violet-600 px-4 py-3 text-left text-white transition-colors hover:bg-violet-500 disabled:opacity-40"
          >
            <div className="text-sm font-semibold">Go Pro Monthly</div>
            <div className="mt-1 text-xs text-violet-100">$9/month via Lemon Squeezy</div>
          </button>
          <button
            type="button"
            onClick={() => handleCheckout('annual')}
            disabled={billing.busyAction === 'checkout:annual'}
            className="ui-control rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-left text-emerald-100 transition-colors hover:border-emerald-400 hover:bg-emerald-500/15 disabled:opacity-40"
          >
            <div className="text-sm font-semibold">Go Pro Annual</div>
            <div className="mt-1 text-xs text-emerald-200">$100/year, best value</div>
          </button>
        </div>

        <div className="mt-5">
          <div className="flex items-center justify-between gap-2">
            <p className={`text-xs font-semibold uppercase tracking-wider ${m.textSub}`}>License key</p>
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
              value={licenseKey}
              onChange={(event) => setLicenseKey(event.target.value)}
              placeholder="Paste your Lemon Squeezy license key"
              className={`${m.input} w-full rounded-lg border px-3 py-2 text-sm ${m.border} ${m.text} focus:border-violet-500 focus:outline-none`}
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleActivate}
                disabled={!licenseKey.trim() || billing.busyAction === 'activate'}
                className="ui-control rounded-lg bg-violet-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-violet-500 disabled:opacity-40"
              >
                Activate License
              </button>
              <button
                type="button"
                onClick={handleRefresh}
                disabled={!billing.licenseKey || billing.busyAction === 'validate'}
                className={`ui-control rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${m.btn} ${m.textAlt} disabled:opacity-40`}
              >
                Refresh Status
              </button>
              {billing.plan === 'pro' && billing.instanceId && (
                <button
                  type="button"
                  onClick={handleDeactivate}
                  disabled={billing.busyAction === 'deactivate'}
                  className={`ui-control rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${m.dangerGhost} disabled:opacity-40`}
                >
                  Deactivate Here
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
