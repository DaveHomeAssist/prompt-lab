import { useEffect, useState } from 'react';
import Ic from '../icons';

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
  onReportBug,
}) {
  const [telemetryEnabled, setTelemetryEnabled] = useState(telemetry?.telemetryEnabled !== false);
  const [contactEmail, setContactEmail] = useState(telemetry?.contactEmail || '');

  useEffect(() => {
    setTelemetryEnabled(telemetry?.telemetryEnabled !== false);
    setContactEmail(telemetry?.contactEmail || '');
  }, [telemetry?.contactEmail, telemetry?.telemetryEnabled]);

  return (
    <div className={`fixed inset-0 ${m.modalBg} flex items-center justify-center z-40 p-4`}>
      <div className={`pl-modal-panel ${m.modal} border rounded-xl p-5 w-full max-w-sm flex flex-col gap-4`} role="dialog" aria-modal="true" aria-labelledby="modal-settings">
        <div className="flex justify-between items-center">
          <h2 id="modal-settings" className={`font-bold text-base ${m.text}`}>Settings</h2>
          <button type="button" onClick={onClose} className={`${m.textSub} hover:text-white`}><Ic n="X" size={15} /></button>
        </div>
        <label className={`flex items-center justify-between text-sm ${m.textBody} cursor-pointer`}>
          <span>Show enhancement notes</span>
          <input type="checkbox" checked={showNotes} onChange={e => setShowNotes(e.target.checked)} className="accent-violet-500" />
        </label>
        <div>
          <p className={`text-xs font-semibold ${m.textSub} uppercase tracking-wider mb-2`}>Density</p>
          <div className="flex gap-1">
            {[['compact', 'Compact'], ['comfortable', 'Comfortable'], ['spacious', 'Spacious']].map(([id, label]) => (
              <button key={id} type="button" onClick={() => setDensity(id)}
                className={`flex-1 text-xs px-2 py-1.5 rounded-lg transition-colors font-medium ${density === id ? 'bg-violet-600 text-white' : `${m.btn} ${m.textAlt}`}`}>
                {label}
              </button>
            ))}
          </div>
        </div>
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
                className="ui-control rounded-lg bg-violet-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-violet-500"
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
              <input
                type="checkbox"
                checked={telemetryEnabled}
                onChange={(event) => setTelemetryEnabled(event.target.checked)}
                className="mt-1 accent-violet-500"
                aria-label="Enable usage insights"
              />
            </div>
            <input
              value={contactEmail}
              onChange={(event) => setContactEmail(event.target.value)}
              placeholder="Billing or contact email"
              className={`${m.input} w-full rounded-lg border px-3 py-2 text-sm ${m.border} ${m.text} focus:border-violet-500 focus:outline-none`}
            />
            <div className="flex items-center justify-between gap-3">
              <p className={`text-[11px] leading-relaxed ${m.textMuted}`}>
                Prompt text, provider API keys, and model responses are not included in insights events.
              </p>
              <button
                type="button"
                onClick={() => telemetry.updatePreferences?.({ telemetryEnabled, contactEmail })}
                disabled={telemetry.busyAction === 'preferences'}
                className="ui-control rounded-lg bg-violet-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-violet-500 disabled:opacity-40"
              >
                {telemetry.busyAction === 'preferences' ? 'Saving...' : 'Save'}
              </button>
            </div>
            {(telemetry.lastSyncedAt || telemetry.lastError) && (
              <p className={`text-[11px] ${telemetry.lastError ? 'text-red-400' : m.textMuted}`}>
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
                  <button type="button" onClick={() => deleteCollection(c)} className={`text-xs ${m.textMuted} hover:text-red-400 transition-colors`}><Ic n="Trash2" size={11} /></button>
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
        <button onClick={openOptions} className={`flex items-center gap-2 text-sm ${m.btn} rounded-lg px-3 py-2 text-violet-400 font-semibold transition-colors`}>
          🔑 Manage API Key (Options)
        </button>
        <button type="button" onClick={onReportBug} className={`flex items-center gap-2 text-sm ${m.btn} rounded-lg px-3 py-2 ${m.textBody} transition-colors`}>
          <Ic n="FileText" size={12} />Report a Bug
        </button>
        <div className={`border-t ${m.border} pt-3 flex flex-col gap-2`}>
          <button onClick={canExportLibrary ? exportLib : () => openBilling?.('export')} className={`flex items-center gap-2 text-sm rounded-lg px-3 py-2 transition-colors ${canExportLibrary ? `${m.btn} ${m.textBody}` : 'border border-violet-500/40 bg-violet-500/12 text-violet-200'}`}><Ic n="Download" size={12} />{canExportLibrary ? 'Export Library' : 'Export Library (Pro)'}</button>
          <label className={`flex items-center gap-2 text-sm ${m.btn} rounded-lg px-3 py-2 ${m.textBody} cursor-pointer transition-colors`}><Ic n="Upload" size={12} />Import Library<input type="file" accept=".json" onChange={importLib} className="hidden" /></label>
          <button type="button" onClick={() => { if (window.confirm('Clear all prompts from the library?')) clearLibrary(); }} className="flex items-center gap-2 text-sm bg-red-600 hover:bg-red-500 text-white rounded-lg px-3 py-2 transition-colors"><Ic n="Trash2" size={12} />Clear All Prompts</button>
        </div>
      </div>
    </div>
  );
}
