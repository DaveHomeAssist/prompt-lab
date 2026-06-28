import { useEffect, useMemo, useState } from 'react';
import Ic from './icons';
import { APP_VERSION } from './constants';
import { submitDiscoveryFeedback } from './lib/discoveryReporter.js';

const INITIAL_FORM = Object.freeze({
  worthPayingFor: '',
  economicWorkflow: '',
  supportTemplatesEvals: '',
  priceSensitivity: '',
  consultantPain: '',
  contact: '',
  website: '',
});

function buildInputClass(m) {
  return `w-full rounded-lg border px-3 py-2 text-sm ${m.input} ${m.text} focus:outline-none focus:border-violet-500 transition-colors`;
}

export default function WillingnessToPayModal({
  show,
  onClose,
  m,
  notify,
  isWeb,
  defaultSurface,
  appContext,
  telemetry,
}) {
  const [form, setForm] = useState(INITIAL_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const inputClass = useMemo(() => buildInputClass(m), [m]);

  useEffect(() => {
    if (!show) return;
    setForm(INITIAL_FORM);
    setSubmitting(false);
    setSubmitError('');
    void telemetry?.track?.('feedback.discovery_opened', {
      surface: defaultSurface,
    });
  }, [defaultSurface, show, telemetry]);

  if (!show) return null;

  const updateField = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSubmitError('');
    setSubmitting(true);

    try {
      const result = await submitDiscoveryFeedback({
        product: 'Prompt Lab',
        surface: defaultSurface,
        contact: form.contact,
        worthPayingFor: form.worthPayingFor,
        economicWorkflow: form.economicWorkflow,
        supportTemplatesEvals: form.supportTemplatesEvals,
        priceSensitivity: form.priceSensitivity,
        consultantPain: form.consultantPain,
        url: appContext?.url || '',
        website: form.website,
        context: {
          ...appContext,
          appVersion: APP_VERSION,
        },
      }, {
        isWeb,
        locationOrigin: typeof window !== 'undefined' ? window.location.origin : '',
        override: import.meta.env?.VITE_DISCOVERY_FEEDBACK_ENDPOINT,
      });

      void telemetry?.track?.('feedback.discovery_submitted', {
        surface: defaultSurface,
        hasContact: Boolean(form.contact.trim()),
      });
      notify(result.pageUrl ? 'Discovery feedback saved to Notion.' : 'Discovery feedback submitted.');
      onClose();
    } catch (error) {
      setSubmitError(error?.message || 'Discovery feedback failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={`fixed inset-0 ${m.modalBg} flex items-center justify-center z-50 p-4`} onClick={onClose}>
      <div
        className={`pl-modal-panel ${m.modal} border rounded-xl p-5 w-full max-w-lg flex flex-col gap-4`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-paid-discovery"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex justify-between items-start gap-4">
          <div>
            <h2 id="modal-paid-discovery" className={`font-bold text-base ${m.text}`}>Paid Value Discovery</h2>
            <p className={`text-xs ${m.textMuted} mt-1`}>
              Separate from bug support. This defines the Pro feature set; it does not assume one.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className={`${m.textSub} rounded-lg p-2 hover:bg-white/10 transition-colors`}
            aria-label="Close paid value discovery dialog"
          >
            <Ic n="X" size={14} />
          </button>
        </div>

        <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
          <label className="flex flex-col gap-1.5">
            <span className={`text-xs font-semibold ${m.textSub} uppercase tracking-wider`}>What would make this worth paying for?</span>
            <textarea
              className={`${inputClass} min-h-[88px] resize-y`}
              value={form.worthPayingFor}
              onChange={(event) => updateField('worthPayingFor', event.target.value)}
              required
              placeholder="The feature, workflow, or outcome that would justify paying."
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className={`text-xs font-semibold ${m.textSub} uppercase tracking-wider`}>Which workflow creates economic value?</span>
            <textarea
              className={`${inputClass} min-h-[80px] resize-y`}
              value={form.economicWorkflow}
              onChange={(event) => updateField('economicWorkflow', event.target.value)}
              placeholder="Client work, production prompts, evaluation, reusable assets, reporting, or something else."
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className={`text-xs font-semibold ${m.textSub} uppercase tracking-wider`}>Which support, templates, evals, or history matter?</span>
            <textarea
              className={`${inputClass} min-h-[80px] resize-y`}
              value={form.supportTemplatesEvals}
              onChange={(event) => updateField('supportTemplatesEvals', event.target.value)}
              placeholder="Advanced eval history, templates, sync, support, hosted convenience, or other paid-value candidates."
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className={`text-xs font-semibold ${m.textSub} uppercase tracking-wider`}>Price sensitivity</span>
              <textarea
                className={`${inputClass} min-h-[88px] resize-y`}
                value={form.priceSensitivity}
                onChange={(event) => updateField('priceSensitivity', event.target.value)}
                placeholder="Acceptable monthly/annual range, must-have threshold, or not sure."
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={`text-xs font-semibold ${m.textSub} uppercase tracking-wider`}>Consultant or client-data pain</span>
              <textarea
                className={`${inputClass} min-h-[88px] resize-y`}
                value={form.consultantPain}
                onChange={(event) => updateField('consultantPain', event.target.value)}
                placeholder="Client security, local-first needs, handoff/reporting pain, or none."
              />
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className={`text-xs font-semibold ${m.textSub} uppercase tracking-wider`}>Surface</span>
              <input className={inputClass} value={defaultSurface} readOnly />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={`text-xs font-semibold ${m.textSub} uppercase tracking-wider`}>Contact</span>
              <input
                className={inputClass}
                value={form.contact}
                onChange={(event) => updateField('contact', event.target.value)}
                placeholder="Optional email or handle"
              />
            </label>
          </div>

          <input
            type="text"
            autoComplete="off"
            tabIndex={-1}
            value={form.website}
            onChange={(event) => updateField('website', event.target.value)}
            className="hidden"
            aria-hidden="true"
          />

          {submitError && (
            <div className="rounded-lg border border-red-400/40 bg-red-950/20 px-3 py-2 text-sm text-red-300">
              {submitError}
            </div>
          )}

          <div className={`rounded-lg border ${m.border} ${m.surface} px-3 py-2 text-xs ${m.textMuted}`}>
            Do not include client secrets. This form is for paid workflow discovery only; bugs and support issues use Report a Bug.
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className={`ui-control px-3 py-2 rounded-lg text-xs font-semibold ${m.btn} ${m.textBody} transition-colors`}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="ui-control flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white transition-colors"
            >
              {submitting ? <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Ic n="FileText" size={12} />}
              {submitting ? 'Submitting...' : 'Submit Discovery'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
