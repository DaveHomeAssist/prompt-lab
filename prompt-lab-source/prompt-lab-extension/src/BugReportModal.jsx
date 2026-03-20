import { useEffect, useMemo, useState } from 'react';
import Ic from './icons';
import { APP_VERSION } from './constants';
import { submitBugReport } from './lib/bugReporter.js';

const INITIAL_FORM = Object.freeze({
  title: '',
  severity: 'Medium',
  steps: '',
  expected: '',
  actual: '',
  contact: '',
  includePromptContext: false,
  website: '',
});

function buildInputClass(m) {
  return `w-full rounded-lg border px-3 py-2 text-sm ${m.input} ${m.text} focus:outline-none focus:border-violet-500 transition-colors`;
}

export default function BugReportModal({
  show,
  onClose,
  m,
  notify,
  isWeb,
  defaultSurface,
  appContext,
  raw,
  enhanced,
  enhMode,
}) {
  const [form, setForm] = useState(INITIAL_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  useEffect(() => {
    if (!show) return;
    setForm({
      ...INITIAL_FORM,
      actual: appContext?.lastError ? `Observed error: ${appContext.lastError}` : '',
    });
    setSubmitting(false);
    setSubmitError('');
  }, [appContext?.lastError, show]);

  const inputClass = useMemo(() => buildInputClass(m), [m]);

  if (!show) return null;

  const updateField = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSubmitError('');
    setSubmitting(true);

    try {
      const payload = {
        title: form.title,
        severity: form.severity,
        product: 'Prompt Lab',
        surface: defaultSurface,
        steps: form.steps,
        expected: form.expected,
        actual: form.actual,
        contact: form.contact,
        url: appContext?.url || '',
        website: form.website,
        context: {
          ...appContext,
          appVersion: APP_VERSION,
        },
        promptContext: form.includePromptContext
          ? {
              raw,
              enhanced,
              mode: enhMode,
            }
          : null,
      };

      const result = await submitBugReport(payload, {
        isWeb,
        locationOrigin: typeof window !== 'undefined' ? window.location.origin : '',
        override: import.meta.env?.VITE_BUG_REPORT_ENDPOINT,
      });

      notify(result.pageUrl ? 'Bug report saved to Notion.' : 'Bug report submitted.');
      onClose();
    } catch (error) {
      setSubmitError(error?.message || 'Bug report failed');
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
        aria-labelledby="modal-bug-report"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex justify-between items-center gap-4">
          <div>
            <h2 id="modal-bug-report" className={`font-bold text-base ${m.text}`}>Report Bug</h2>
            <p className={`text-xs ${m.textMuted} mt-1`}>
              Sends a structured bug note to Notion with app and surface context.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className={`${m.textSub} rounded-lg p-2 hover:bg-white/10 transition-colors`}
            aria-label="Close bug report dialog"
          >
            <Ic n="X" size={14} />
          </button>
        </div>

        <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem]">
            <label className="flex flex-col gap-1.5">
              <span className={`text-xs font-semibold ${m.textSub} uppercase tracking-wider`}>Title</span>
              <input
                className={inputClass}
                value={form.title}
                onChange={(event) => updateField('title', event.target.value)}
                placeholder="Short bug summary"
                required
                maxLength={160}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={`text-xs font-semibold ${m.textSub} uppercase tracking-wider`}>Severity</span>
              <select
                className={inputClass}
                value={form.severity}
                onChange={(event) => updateField('severity', event.target.value)}
              >
                {['Low', 'Medium', 'High', 'Critical'].map((level) => (
                  <option key={level} value={level}>{level}</option>
                ))}
              </select>
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

          <label className="flex flex-col gap-1.5">
            <span className={`text-xs font-semibold ${m.textSub} uppercase tracking-wider`}>Steps to Reproduce</span>
            <textarea
              className={`${inputClass} min-h-[96px] resize-y`}
              value={form.steps}
              onChange={(event) => updateField('steps', event.target.value)}
              placeholder="1. Open Prompt Lab&#10;2. ..."
              required
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className={`text-xs font-semibold ${m.textSub} uppercase tracking-wider`}>Expected</span>
              <textarea
                className={`${inputClass} min-h-[88px] resize-y`}
                value={form.expected}
                onChange={(event) => updateField('expected', event.target.value)}
                placeholder="What should have happened?"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={`text-xs font-semibold ${m.textSub} uppercase tracking-wider`}>Actual</span>
              <textarea
                className={`${inputClass} min-h-[88px] resize-y`}
                value={form.actual}
                onChange={(event) => updateField('actual', event.target.value)}
                placeholder="What actually happened?"
              />
            </label>
          </div>

          <label className={`flex items-start gap-2 rounded-lg border ${m.border} ${m.surface} px-3 py-2 text-sm ${m.textBody}`}>
            <input
              type="checkbox"
              checked={form.includePromptContext}
              onChange={(event) => updateField('includePromptContext', event.target.checked)}
              className="mt-0.5 accent-violet-500"
            />
            <span>
              Include current prompt context
              <span className={`block text-xs ${m.textMuted} mt-0.5`}>
                Off by default. When enabled, the current raw and enhanced prompt text is attached to the report.
              </span>
            </span>
          </label>

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
            Reports include URL, browser, view state, app version, and viewport automatically.
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
              {submitting ? 'Submitting...' : 'Submit to Notion'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
