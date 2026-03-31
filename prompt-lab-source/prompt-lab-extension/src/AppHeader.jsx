import Ic from './icons';
import { APP_VERSION } from './constants';
import { SUBVIEWS } from './lib/navigationRegistry.js';

export default function AppHeader({
  m, compact, libraryCount, colorMode, setColorMode,
  activeSection, openSection, openCreateView, openRunsView,
  primaryView, setPrimaryView, workspaceView, runsView,
  effectiveEditorLayout, setEditorLayout, createLayoutOptions,
  setShowCmdPalette, setCmdQuery, setShowShortcuts, setShowSettings,
  billingPlan, billingLabel, openBilling,
}) {
  const createModeButtons = [
    { id: 'editor', label: 'Write', action: () => openSection('create'), active: primaryView === 'create' && workspaceView !== 'composer' },
    { id: 'composer', label: 'Compose', action: () => openCreateView('composer'), active: primaryView === 'create' && workspaceView === 'composer' },
  ];
  const notebookBtnClass = primaryView === 'notebook'
    ? 'border border-violet-400/50 bg-violet-500/15 text-violet-100'
    : (colorMode === 'dark'
        ? 'border border-gray-700 bg-transparent text-gray-300 hover:border-violet-500/40 hover:text-violet-300'
        : 'border border-slate-300 bg-white/70 text-slate-700 hover:border-violet-400 hover:text-violet-600');
  const utilityCopy = primaryView === 'notebook'
    ? 'Scratchpad + working notes'
    : activeSection === 'create'
      ? 'Create workbench'
      : activeSection === 'evaluate'
        ? 'Compare + run history'
        : 'Reusable library';

  return (
    <header className={`px-4 py-2 ${m.header} border-b shrink-0`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 shrink-0">
              <Ic n="Wand2" size={15} className="text-violet-500" />
              <span className="font-bold text-sm">Prompt Lab</span>
              <span className={`text-[10px] font-mono ${m.textMuted}`}>v{APP_VERSION}</span>
            </div>
            <span className={`text-[10px] font-semibold uppercase tracking-[0.22em] ${m.textMuted}`}>
              {utilityCopy}
            </span>
          </div>
          <span className={`text-[11px] ${m.textMuted}`}>{libraryCount} saved</span>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${billingPlan === 'pro' ? 'bg-emerald-500/15 text-emerald-300' : `${m.btn} ${m.textAlt}`}`}>
            {billingLabel}
          </span>
          {billingPlan !== 'pro' && (
            <button
              type="button"
              onClick={() => openBilling()}
              className="ui-control rounded-full bg-violet-600 px-2.5 py-1 text-[10px] font-semibold text-white transition-colors hover:bg-violet-500"
            >
              Upgrade
            </button>
          )}
        </div>
        <div className="ml-auto flex items-center gap-1">
          <button type="button" onClick={() => { setShowCmdPalette(true); setCmdQuery(''); }} className={`ui-control px-2 py-1 rounded-lg ${m.btn} ${m.textAlt} text-[11px] font-mono hover:text-violet-400 transition-colors`}>⌘K</button>
          <button type="button" aria-label={colorMode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} onClick={() => setColorMode(p => p === 'dark' ? 'light' : 'dark')} className={`ui-control p-1.5 rounded-lg ${m.btn} ${m.textAlt} hover:text-violet-400 transition-colors`}>
            {colorMode === 'dark' ? <Ic n="Sun" size={13} /> : <Ic n="Moon" size={13} />}
          </button>
          <button type="button" aria-label="Keyboard shortcuts" onClick={() => setShowShortcuts(true)} className={`ui-control p-1.5 rounded-lg ${m.btn} ${m.textAlt} hover:text-violet-400 transition-colors`}><Ic n="Keyboard" size={13} /></button>
          <button type="button" aria-label="Settings" onClick={() => setShowSettings(true)} className={`ui-control p-1.5 rounded-lg ${m.btn} ${m.textAlt} hover:text-violet-400 transition-colors`}><Ic n="Settings" size={13} /></button>
        </div>
      </div>
      <div className={`mt-2 flex items-center gap-2 ${compact ? 'flex-wrap' : ''}`}>
        <div className={`${compact ? 'overflow-x-auto pb-1 pl-subtle-scroll flex-1' : ''}`} role="tablist" aria-label="Primary workspaces">
          <div className="pl-scroll-row">
            {[
              ['create', 'Create'],
              ['library', 'Library'],
              ['evaluate', 'Evaluate'],
            ].map(([id, label]) => (
              <button key={id} type="button" onClick={() => openSection(id)} role="tab" aria-selected={activeSection === id}
                className={`pl-tab-btn ui-control px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap ${activeSection === id ? 'bg-violet-600 text-white' : `${m.btn} ${m.textAlt}`}`}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className={`${compact ? 'overflow-x-auto pb-1 pl-subtle-scroll w-full' : 'ml-auto min-w-0'}`} aria-label="Prompt Lab context controls">
          <div className="pl-scroll-row">
            <button type="button" onClick={() => setPrimaryView('notebook')}
              className={`pl-tab-btn ui-control px-2.5 py-1 text-[11px] font-semibold rounded-full transition-colors whitespace-nowrap ${notebookBtnClass}`}>
              Notebook
            </button>
            {activeSection === 'evaluate' && (
              <div role="tablist" aria-label="Evaluate views" className="pl-scroll-row">
                {SUBVIEWS.runs.map(({ id, label }) => (
                  <button key={id} type="button" onClick={() => openRunsView(id)} role="tab" aria-selected={runsView === id}
                    className={`pl-tab-btn ui-control px-2.5 py-1 text-[11px] font-semibold rounded-lg transition-colors whitespace-nowrap ${runsView === id ? 'bg-violet-600 text-white' : `${m.btn} ${m.textAlt}`}`}>
                    {label}
                  </button>
                ))}
              </div>
            )}
            {activeSection === 'create' && (
              <>
                {createModeButtons.map(({ id, label, action, active }) => (
                  <button key={id} type="button" onClick={action}
                    className={`pl-tab-btn ui-control px-2.5 py-1 text-[11px] font-semibold rounded-lg transition-colors whitespace-nowrap ${active ? 'bg-violet-600 text-white' : `${m.btn} ${m.textAlt}`}`}>
                    {label}
                  </button>
                ))}
                {createLayoutOptions.map(([id, label]) => (
                  <button key={id} type="button" onClick={() => setEditorLayout(id)}
                    className={`pl-tab-btn ui-control px-2.5 py-1 text-[11px] font-semibold rounded-lg transition-colors whitespace-nowrap ${effectiveEditorLayout === id ? 'bg-violet-600 text-white' : `${m.btn} ${m.textAlt}`}`}>
                    {label}
                  </button>
                ))}
              </>
            )}
            {primaryView === 'notebook' && (
              <span className={`text-[11px] ${m.textMuted}`}>Scratchpad notes with library handoff</span>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
