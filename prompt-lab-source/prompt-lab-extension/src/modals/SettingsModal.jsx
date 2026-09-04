import { useCallback, useEffect, useRef, useState } from 'react';
import Ic from '../icons';
import useDialogA11y from '../hooks/useDialogA11y.js';

export default function SettingsModal({
  m,
  showNotes,
  setShowNotes,
  density,
  setDensity,
  collections,
  deleteCollection,
  exportLib,
  importLib,
  clearLibrary,
  openOptions,
  onClose,
  billing,
  openBilling,
  canUseCollections = true,
  canExportLibrary = true,
  telemetry,
  returnFocusRef,
}) {
  const [telemetryEnabled, setTelemetryEnabled] = useState(telemetry?.telemetryEnabled !== false);
  const [contactEmail, setContactEmail] = useState(telemetry?.contactEmail || '');
  const closeRef = useRef(onClose);
  const importInputRef = useRef(null);
  closeRef.current = onClose;
  const closeDialog = useCallback(() => closeRef.current?.(), []);
  const dialogRef = useDialogA11y({ onClose: closeDialog, returnFocusRef });

  useEffect(() => {
    setTelemetryEnabled(telemetry?.telemetryEnabled !== false);
    setContactEmail(telemetry?.contactEmail || '');
  }, [telemetry?.contactEmail, telemetry?.telemetryEnabled]);

  return (
    <div className={`fixed inset-0 ${m.modalBg} flex items-center justify-center z-[90] p-4`} onClick={closeDialog}>
      <div
        ref={dialogRef}
        className={`pl-modal-panel ${m.modal} border rounded-xl p-5 w-full max-w-sm max-h-[90vh] overflow-y-auto flex flex-col gap-4`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-settings"
        aria-describedby="modal-settings-description"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex justify-between items-center">
          <h2 id="modal-settings" className={`font-bold text-base ${m.text}`}>Settings</h2>
          <button type="button" onClick={closeDialog} aria-label="Close settings" className={`${m.textSub} min-h-11 min-w-11 rounded-lg p-2 hover:text-white`}><Ic n="X" size={15} /></button>
        </div>
        <p id="modal-settings-description" className="sr-only">Configure appearance, billing, insights, collections, and library data.</p>
        <label className={`flex min-h-11 items-center justify-between text-sm ${m.textBody} cursor-pointer`}>
          <span>Show enhancement notes</span>
          <input type="checkbox" checked={showNotes} onChange={e => setShowNotes(e.target.checked)} className="accent-orange-500" />
        </label>
        <fieldset>
          <legend className={`text-xs font-semibold ${m.textSub} uppercase tracking-wider mb-2`}>Density</legend>
          <div className="flex gap-1">
            {[['compact', 'Compact'], ['comfortable', 'Comfortable'], ['spacious', 'Spacious']].map(([id, label]) => (
              <button key={id} type="button" onClick={() => setDensity(id)}
                aria-pressed={density === id}
                className={`min-h-11 flex-1 text-xs px-2 py-1.5 rounded-lg transition-colors font-medium ${density === id ? 'bg-orange-600 text-white' : `${m.btn} ${m.textAlt}`}`}>
                {label}
              </button>
            ))}
          </div>
        </fieldset>
        {billing && (
          <div className={`rounded-xl border p-3 ${m.surface} ${m.border}`}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className={`text-xs font-semibold uppercase tracking-wider ${m.textSub}`}>Billing</p>
                <p className={`mt-1 text-sm font-semibold ${m.text}`}>{billing.planLabel}</p>
                <p className={`mt-1 text-xs leading-relaxed ${m.textMuted}`}>{billing.statusCopy}</p>
              </div>
              <button
                type="button"
                onClick={() => openBilling?.()}
                className="ui-control min-h-11 rounded-lg bg-orange-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-orange-500"
              >
                {billing.plan === 'pro' ? 'Manage Billing' : 'Upgrade to Pro'}
              </button>
            </div>
          </div>
        )}
        {telemetry && (
          <div className={`rounded-xl border p-3 ${m.surface} ${m.border} flex flex-col gap-3`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className={`text-xs font-semibold uppercase tracking-wider ${m.textSub}`}>Insights</p>
                <p className={`mt-1 text-xs leading-relaxed ${m.textMuted}`}>
                  Share lightweight usage events and an optional contact email so Prompt Lab can understand activation, upgrade, and retention patterns.
                </p>
              </div>
              <label className="flex min-h-11 min-w-11 items-center justify-center">
                <span className="sr-only">Enable usage insights</span>
                <input
                  type="checkbox"
                  checked={telemetryEnabled}
                  onChange={(event) => setTelemetryEnabled(event.target.checked)}
                  className="accent-orange-500"
                />
              </label>
            </div>
            <label>
              <span className="sr-only">Billing or contact email</span>
              <input
                type="email"
                value={contactEmail}
                onChange={(event) => setContactEmail(event.target.value)}
                placeholder="Billing or contact email"
                className={`${m.input} min-h-11 w-full rounded-lg border px-3 py-2 text-sm ${m.border} ${m.text} focus:border-orange-500 focus:outline-none`}
              />
            </label>
            <div className="flex items-center justify-between gap-3">
              <p className={`text-[11px] leading-relaxed ${m.textMuted}`}>
                Prompt text, provider API keys, and model responses are not included in insights events.
              </p>
              <button
                type="button"
                onClick={() => telemetry.updatePreferences?.({ telemetryEnabled, contactEmail })}
                disabled={telemetry.busyAction === 'preferences'}
                className="ui-control min-h-11 rounded-lg bg-orange-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-orange-500 disabled:opacity-40"
              >
                {telemetry.busyAction === 'preferences' ? 'Saving...' : 'Save'}
              </button>
            </div>
            {(telemetry.lastSyncedAt || telemetry.lastError) && (
              <p role={telemetry.lastError ? 'alert' : 'status'} className={`text-[11px] ${telemetry.lastError ? 'text-red-400' : m.textMuted}`}>
                {telemetry.lastError || `Last synced ${new Date(telemetry.lastSyncedAt).toLocaleString()}`}
              </p>
            )}
          </div>
        )}
        {canUseCollections && collections.length > 0 && (
          <div>
            <p className={`text-xs font-semibold ${m.textSub} uppercase tracking-wider mb-2`}>Collections</p>
            <div className="flex flex-col gap-1 max-h-36 overflow-y-auto">
              {collections.map(c => (
                <div key={c} className="flex items-center justify-between">
                  <span className={`text-xs ${m.textAlt} flex items-center gap-1`}><Ic n="FolderOpen" size={9} />{c}</span>
                  <button type="button" onClick={() => deleteCollection(c)} aria-label={`Delete ${c} collection`} className={`min-h-11 min-w-11 rounded-lg p-2 text-xs ${m.textMuted} hover:text-red-400 transition-colors`}><Ic n="Trash2" size={11} /></button>
                </div>
              ))}
            </div>
          </div>
        )}
        {!canUseCollections && (
          <div className={`rounded-xl border p-3 ${m.codeBlock} ${m.border}`}>
            <p className={`text-xs font-semibold uppercase tracking-wider ${m.textSub}`}>Collections</p>
            <p className={`mt-1 text-xs leading-relaxed ${m.textMuted}`}>
              Collections are available on Prompt Lab Pro. Use the billing panel to unlock grouped prompt sets.
            </p>
          </div>
        )}
        <button type="button" onClick={openOptions} className={`flex min-h-11 items-center gap-2 text-sm ${m.btn} rounded-lg px-3 py-2 text-orange-400 font-semibold transition-colors`}>
          ⚙️ Provider Settings
        </button>
        <div className={`border-t ${m.border} pt-3 flex flex-col gap-2`}>
          <button type="button" onClick={canExportLibrary ? exportLib : () => openBilling?.('export')} className={`flex min-h-11 items-center gap-2 text-sm rounded-lg px-3 py-2 transition-colors ${canExportLibrary ? `${m.btn} ${m.textBody}` : 'border border-orange-500/40 bg-orange-500/12 text-orange-200'}`}><Ic n="Download" size={12} />{canExportLibrary ? 'Export Library' : 'Export Library (Pro)'}</button>
          <input ref={importInputRef} type="file" accept=".json" onChange={importLib} className="hidden" tabIndex={-1} aria-hidden="true" />
          <button type="button" onClick={() => importInputRef.current?.click()} className={`flex min-h-11 items-center gap-2 text-sm ${m.btn} rounded-lg px-3 py-2 ${m.textBody} cursor-pointer transition-colors`}><Ic n="Upload" size={12} />Import Library</button>
          <button type="button" onClick={() => { if (window.confirm('Clear all prompts from the library?')) clearLibrary(); }} className="flex min-h-11 items-center gap-2 text-sm bg-red-600 hover:bg-red-500 text-white rounded-lg px-3 py-2 transition-colors"><Ic n="Trash2" size={12} />Clear All Prompts</button>
        </div>
      </div>
    </div>
  );
}
