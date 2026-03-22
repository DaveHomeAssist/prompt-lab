import Ic from './icons';
import Toast from './Toast';
import BugReportModal from './BugReportModal';
import VersionDiffModal from './VersionDiffModal';
import DesktopSettingsModal from './DesktopSettingsModal';
import { isExtension } from './lib/platform.js';
import { isGhostVar } from './promptUtils';

// ── Modal / overlay orchestration layer ─────────────────────────────────────
// Pure extraction from App.jsx — no behaviour changes.
export default function ModalLayer({
  m,
  compact,
  toast,
  setToast,
  templateVars,
  settings,
  cmdPalette,
  shortcuts,
  pii,
  bugReport,
  versionDiff,
  desktopSettings,
}) {
  const {
    showVarForm, setShowVarForm, pendingTemplate,
    varVals, setVarVals, applyTemplate, skipTemplate,
    pendingTemplateInputMap,
  } = templateVars;

  const {
    showSettings, setShowSettings,
    showNotes, setShowNotes,
    density, setDensity,
    collections, setCollections, setLibrary,
    exportLib, importLib,
    openOptions, notify,
  } = settings;

  const {
    showCmdPalette, setShowCmdPalette,
    cmdQuery, setCmdQuery,
    filteredCmds,
  } = cmdPalette;

  const {
    showShortcuts, setShowShortcuts,
    primaryModKey,
  } = shortcuts;

  const {
    piiWarning, piiRedactAndSend, piiSendAnyway, piiCancel,
    piiSummary,
  } = pii;

  return (
    <>
      {/* ══ MODALS ══ */}
      {showVarForm && pendingTemplate && (
        <div className={`fixed inset-0 ${m.modalBg} flex items-center justify-center z-40 p-4`}>
          <div className={`pl-modal-panel ${m.modal} border rounded-xl p-5 w-full max-w-md flex flex-col gap-4`} role="dialog" aria-modal="true" aria-labelledby="modal-vars">
            <div className="flex justify-between items-center">
              <h2 id="modal-vars" className={`font-bold text-sm ${m.text}`}>Fill Template Variables</h2>
              <button type="button" onClick={() => setShowVarForm(false)} className={`${m.textSub} hover:text-white`}><Ic n="X" size={15} /></button>
            </div>
            <p className={`text-xs ${m.textAlt}`}>"{pendingTemplate.title}" contains template variables:</p>
            <div className="flex flex-col gap-2">
              {Object.keys(varVals).map(k => {
                const inputDef = pendingTemplateInputMap[k];
                const isSelect = inputDef?.type === 'select' && Array.isArray(inputDef.options) && inputDef.options.length > 0;
                return (
                <div key={k}>
                  <label className="text-xs font-mono font-semibold text-violet-400 block mb-1">
                    {inputDef?.label || `{{${k}}}`}
                    {isGhostVar(k) && (
                      <span className="ml-2 inline-flex items-center rounded-full border border-emerald-500/30 bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-sans font-semibold uppercase tracking-wide text-emerald-300">
                        auto
                      </span>
                    )}
                  </label>
                  {isSelect ? (
                    <select
                      className={`w-full ${m.input} border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-violet-500 ${m.text}`}
                      value={varVals[k]}
                      onChange={e => setVarVals(p => ({ ...p, [k]: e.target.value }))}
                      aria-label={inputDef.label || k}
                    >
                      <option value="">{inputDef.placeholder || `Select ${inputDef.label || k}…`}</option>
                      {inputDef.options.map((opt) => (
                        <option key={typeof opt === 'string' ? opt : opt.value} value={typeof opt === 'string' ? opt : opt.value}>
                          {typeof opt === 'string' ? opt : (opt.label || opt.value)}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input className={`w-full ${m.input} border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-violet-500 ${m.text}`}
                      placeholder={inputDef?.placeholder || (isGhostVar(k) ? 'Auto-filled · editable' : `Value for ${k}…`)}
                      value={varVals[k]} onChange={e => setVarVals(p => ({ ...p, [k]: e.target.value }))} />
                  )}
                </div>
                );
              })}
            </div>
            <div className="flex gap-2">
              <button onClick={applyTemplate} className="flex-1 bg-violet-600 hover:bg-violet-500 text-white rounded-lg py-2 text-sm font-semibold transition-colors">Apply Template</button>
              <button onClick={skipTemplate} className={`px-4 ${m.btn} rounded-lg text-sm ${m.textBody} transition-colors`}>Skip</button>
            </div>
          </div>
        </div>
      )}

      {showSettings && (
        <div className={`fixed inset-0 ${m.modalBg} flex items-center justify-center z-40 p-4`}>
          <div className={`pl-modal-panel ${m.modal} border rounded-xl p-5 w-full max-w-sm flex flex-col gap-4`} role="dialog" aria-modal="true" aria-labelledby="modal-settings">
            <div className="flex justify-between items-center">
              <h2 id="modal-settings" className={`font-bold text-base ${m.text}`}>Settings</h2>
              <button type="button" onClick={() => setShowSettings(false)} className={`${m.textSub} hover:text-white`}><Ic n="X" size={15} /></button>
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
            {collections.length > 0 && (
              <div>
                <p className={`text-xs font-semibold ${m.textSub} uppercase tracking-wider mb-2`}>Collections</p>
                <div className="flex flex-col gap-1 max-h-36 overflow-y-auto">
                  {collections.map(c => (
                    <div key={c} className="flex items-center justify-between">
                      <span className={`text-xs ${m.textAlt} flex items-center gap-1`}><Ic n="FolderOpen" size={9} />{c}</span>
                      <button onClick={() => setCollections(p => p.filter(x => x !== c))} className={`text-xs ${m.textMuted} hover:text-red-400 transition-colors`}><Ic n="Trash2" size={11} /></button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <button onClick={openOptions} className={`flex items-center gap-2 text-sm ${m.btn} rounded-lg px-3 py-2 text-violet-400 font-semibold transition-colors`}>
              🔑 Manage API Key (Options)
            </button>
            <div className={`border-t ${m.border} pt-3 flex flex-col gap-2`}>
              <button onClick={exportLib} className={`flex items-center gap-2 text-sm ${m.btn} rounded-lg px-3 py-2 ${m.textBody} transition-colors`}><Ic n="Download" size={12} />Export Library</button>
              <label className={`flex items-center gap-2 text-sm ${m.btn} rounded-lg px-3 py-2 ${m.textBody} cursor-pointer transition-colors`}><Ic n="Upload" size={12} />Import Library<input type="file" accept=".json" onChange={importLib} className="hidden" /></label>
              <button onClick={() => { if (window.confirm('Clear all prompts from the library?')) { setLibrary([]); notify('Library cleared.'); } }} className="flex items-center gap-2 text-sm bg-red-600 hover:bg-red-500 text-white rounded-lg px-3 py-2 transition-colors"><Ic n="Trash2" size={12} />Clear All Prompts</button>
            </div>
          </div>
        </div>
      )}

      {showCmdPalette && (
        <div className={`fixed inset-0 ${m.modalBg} flex items-start justify-center z-50 pt-20 p-4`} onClick={() => setShowCmdPalette(false)}>
          <div className={`pl-modal-panel ${m.modal} border rounded-xl w-full max-w-md overflow-hidden shadow-2xl`} onClick={e => e.stopPropagation()}>
            <div className={`flex items-center gap-2 px-4 py-3 border-b ${m.border}`}>
              <Ic n="Search" size={13} className={m.textSub} />
              <input autoFocus className={`flex-1 bg-transparent text-sm ${m.text} focus:outline-none placeholder-gray-500`}
                placeholder="Search commands…" value={cmdQuery} onChange={e => setCmdQuery(e.target.value)} />
              <span className={`text-xs ${m.textSub} font-mono`}>ESC</span>
            </div>
            <div className="max-h-72 overflow-y-auto">
              {filteredCmds.map((a, i) => (
                <button key={i} onClick={a.action}
                  className={`w-full flex items-center justify-between px-4 py-2.5 text-sm ${m.textBody} hover:bg-violet-600 hover:text-white transition-colors text-left`}>
                  <span>{a.label}</span>
                  {a.hint && <kbd className={`text-xs font-mono px-1.5 py-0.5 ${m.pill} rounded`}>{a.hint}</kbd>}
                </button>
              ))}
              {filteredCmds.length === 0 && <div className={`ui-empty-state text-xs ${m.textMuted}`}>No commands found</div>}
            </div>
          </div>
        </div>
      )}

      {showShortcuts && (
        <div className={`fixed inset-0 ${m.modalBg} flex items-center justify-center z-50 p-4`} onClick={() => setShowShortcuts(false)}>
          <div className={`pl-modal-panel ${m.modal} border rounded-xl p-5 w-full max-w-sm`} role="dialog" aria-modal="true" aria-labelledby="modal-shortcuts" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4">
              <h2 id="modal-shortcuts" className={`font-bold text-sm ${m.text}`}>Keyboard Shortcuts</h2>
              <button type="button" onClick={() => setShowShortcuts(false)} className={`${m.textSub} rounded-lg p-2 hover:bg-white/10 transition-colors`}><Ic n="X" size={14} /></button>
            </div>
            <div className="flex flex-col gap-4">
              <div>
                <p className={`text-xs font-semibold ${m.textSub} uppercase tracking-wider mb-2`}>Global</p>
                <div className="flex flex-col gap-2.5">
                  {[[`${primaryModKey} ↵`, 'Enhance prompt'], [`${primaryModKey} S`, 'Save prompt'], [`${primaryModKey} K`, 'Command palette'], ['?', 'Show shortcuts'], ['Esc', 'Close modals']].map(([key, label]) => (
                    <div key={key} className="flex items-center justify-between">
                      <span className={`text-sm ${m.textBody}`}>{label}</span>
                      <kbd className={`text-xs font-mono px-2 py-1 ${m.pill} rounded-md`}>{key}</kbd>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <p className={`text-xs font-semibold ${m.textSub} uppercase tracking-wider mb-2`}>Scratchpad (PadTab)</p>
                <div className="flex flex-col gap-2.5">
                  {[
                    [`${primaryModKey} E`, 'Export / download pad'],
                    [`${primaryModKey} ⇧ D`, 'Insert date separator'],
                    [`${primaryModKey} ⇧ C`, 'Copy all content'],
                    [`${primaryModKey} ⇧ X`, 'Clear pad'],
                  ].map(([key, label]) => (
                    <div key={key} className="flex items-center justify-between">
                      <span className={`text-sm ${m.textBody}`}>{label}</span>
                      <kbd className={`text-xs font-mono px-2 py-1 ${m.pill} rounded-md`}>{key}</kbd>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <BugReportModal
        show={bugReport.showBugReport}
        onClose={bugReport.onCloseBugReport}
        m={m}
        notify={bugReport.notify}
        isWeb={bugReport.isWeb}
        defaultSurface={bugReport.currentSurface}
        appContext={bugReport.bugReportContext}
        raw={bugReport.raw}
        enhanced={bugReport.enhanced}
        enhMode={bugReport.enhMode}
      />

      <VersionDiffModal
        entry={versionDiff.entry}
        selectedIndex={versionDiff.selectedIndex}
        onSelectIndex={versionDiff.onSelectIndex}
        onClose={versionDiff.onClose}
        onRestore={versionDiff.onRestore}
        m={m}
      />

      {/* ══ PII WARNING MODAL ══ */}
      {piiWarning && (
        <div className={`fixed inset-0 ${m.modalBg} flex items-center justify-center z-50 p-4`}>
          <div className={`pl-modal-panel ${m.modal} border rounded-xl p-5 w-full max-w-md flex flex-col gap-4`} role="dialog" aria-modal="true" aria-labelledby="modal-pii">
            <div className="flex justify-between items-center">
              <h2 id="modal-pii" className={`font-bold text-sm ${m.text}`}>Sensitive Data Detected</h2>
              <button type="button" onClick={piiCancel} className={`${m.textSub} hover:text-white`}><Ic n="X" size={15} /></button>
            </div>
            <p className={`text-xs ${m.textAlt}`}>The following potentially sensitive items were found in your prompt.</p>
            {piiSummary && (
              <p className={`text-xs ${m.textMuted}`}>Detected: {piiSummary}</p>
            )}
            <div className="flex flex-col gap-1 max-h-40 overflow-y-auto">
              {piiWarning.matches.map(match => (
                <div key={match.id} className={`text-xs ${m.textBody} flex items-center gap-2`}>
                  <span className="text-yellow-400 font-semibold uppercase text-[10px]">{match.type}</span>
                  <span className="font-mono truncate">{match.snippet.length > 32
                    ? `${match.snippet.slice(0, 8)}...${match.snippet.slice(-6)}`
                    : match.snippet}</span>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <button onClick={piiRedactAndSend}
                className="flex-1 bg-violet-600 hover:bg-violet-500 text-white rounded-lg py-2 text-xs font-semibold transition-colors">
                Redact & Send
              </button>
              <button onClick={piiSendAnyway}
                className="flex-1 bg-amber-500 hover:bg-amber-400 text-gray-950 rounded-lg py-2 text-xs font-semibold transition-colors">
                Send Anyway
              </button>
              <button onClick={piiCancel}
                className={`px-3 ${m.btn} ${m.textBody} rounded-lg py-2 text-xs font-semibold transition-colors`}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
      {!isExtension && (
        <DesktopSettingsModal
          show={desktopSettings.showDesktopSettings}
          onClose={desktopSettings.onCloseDesktopSettings}
          m={m}
          notify={desktopSettings.notify}
        />
      )}
    </>
  );
}
