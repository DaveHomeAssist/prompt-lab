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
  clerkUserButton,
}) {
  const createModeButtons = [
    { id: 'editor', label: 'Write', action: () => openSection('create'), active: primaryView === 'create' && workspaceView !== 'composer' },
    { id: 'composer', label: 'Compose', action: () => openCreateView('composer'), active: primaryView === 'create' && workspaceView === 'composer' },
  ];
  const activeTabClass = 'border border-orange-400/50 bg-orange-500/15 text-orange-50 shadow-[0_0_0_1px_rgba(251,146,60,0.12)]';
  const inactiveTabClass = `${m.btn} ${m.textAlt}`;
  const notebookBtnClass = primaryView === 'notebook'
    ? activeTabClass
    : (colorMode === 'dark'
        ? 'border border-white/10 bg-transparent text-[#c7c2bb] hover:border-orange-400/40 hover:text-orange-200'
        : 'border border-slate-300 bg-white/70 text-slate-700 hover:border-orange-400 hover:text-orange-600');
  const utilityCopy = primaryView === 'notebook'
    ? 'Scratchpad + working notes'
    : activeSection === 'create'
      ? 'Prompt engineering workbench'
      : activeSection === 'evaluate'
        ? 'Compare + run history'
        : 'Reusable library';

  return (
    <header className={`px-4 py-2 ${m.header} border-b shrink-0`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 shrink-0">
              <Ic n="Wand2" size={15} className="text-orange-400" />
              <span className="pl-brand-title font-bold text-sm">Prompt Lab</span>
              <span className={`text-[10px] font-mono ${m.textMuted}`}>v{APP_VERSION}</span>
            </div>
            <span className={`text-[10px] font-semibold uppercase tracking-[0.22em] ${m.textMuted}`}>
              {utilityCopy}
            </span>
          </div>
          <span data-testid="library-count" className={`text-[11px] ${m.textMuted}`}>{libraryCount} saved</span>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${billingPlan === 'pro' ? 'pl-brand-chip' : `${m.btn} ${m.textAlt}`}`}>
            {billingLabel}
          </span>
          {billingPlan !== 'pro' && (
            <button
              type="button"
              data-testid="upgrade-trigger"
              onClick={() => openBilling()}
              className="ui-control rounded-full bg-orange-500/90 px-2.5 py-1 text-[10px] font-semibold text-white transition-colors hover:bg-orange-400"
            >
              Upgrade
            </button>
          )}
        </div>
        <div className="ml-auto flex items-center gap-1">
          <button type="button" onClick={() => { setShowCmdPalette(true); setCmdQuery(''); }} className={`ui-control px-2 py-1 rounded-lg ${m.btn} ${m.textAlt} text-[11px] font-mono hover:text-orange-300 transition-colors`}>⌘K</button>
          <button type="button" aria-label={colorMode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} onClick={() => setColorMode(p => p === 'dark' ? 'light' : 'dark')} className={`ui-control p-1.5 rounded-lg ${m.btn} ${m.textAlt} hover:text-orange-300 transition-colors`}>
            {colorMode === 'dark' ? <Ic n="Sun" size={13} /> : <Ic n="Moon" size={13} />}
          </button>
          <button type="button" aria-label="Keyboard shortcuts" onClick={() => setShowShortcuts(true)} className={`ui-control p-1.5 rounded-lg ${m.btn} ${m.textAlt} hover:text-orange-300 transition-colors`}><Ic n="Keyboard" size={13} /></button>
          <button type="button" aria-label="Settings" onClick={() => setShowSettings(true)} className={`ui-control p-1.5 rounded-lg ${m.btn} ${m.textAlt} hover:text-orange-300 transition-colors`}><Ic n="Settings" size={13} /></button>
          {clerkUserButton && <div className="ml-1">{clerkUserButton}</div>}
        </div>
      </div>
      <div className={`mt-2 flex items-center gap-2 ${compact ? 'flex-wrap' : ''}`}>
        <div className={`${compact ? 'overflow-x-auto pb-1 pl-subtle-scroll flex-1' : ''}`} role="tablist" aria-label="Primary workspaces">
          <div className="pl-scroll-row">
            {[
              ['create', 'Workbench'],
              ['library', 'Library'],
              ['evaluate', 'Evaluate'],
            ].map(([id, label]) => (
              <button key={id} type="button" data-testid={`nav-${id}`} onClick={() => openSection(id)} role="tab" aria-selected={activeSection === id}
                className={`pl-tab-btn ui-control px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap ${activeSection === id ? activeTabClass : inactiveTabClass}`}>
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
                    className={`pl-tab-btn ui-control px-2.5 py-1 text-[11px] font-semibold rounded-lg transition-colors whitespace-nowrap ${runsView === id ? activeTabClass : inactiveTabClass}`}>
                    {label}
                  </button>
                ))}
              </div>
            )}
            {activeSection === 'create' && (
              <>
                {createModeButtons.map(({ id, label, action, active }) => (
                  <button key={id} type="button" onClick={action}
                    className={`pl-tab-btn ui-control px-2.5 py-1 text-[11px] font-semibold rounded-lg transition-colors whitespace-nowrap ${active ? activeTabClass : inactiveTabClass}`}>
                    {label}
                  </button>
                ))}
                {createLayoutOptions.map(([id, label]) => (
                  <button key={id} type="button" onClick={() => setEditorLayout(id)}
                    className={`pl-tab-btn ui-control px-2.5 py-1 text-[11px] font-semibold rounded-lg transition-colors whitespace-nowrap ${effectiveEditorLayout === id ? activeTabClass : inactiveTabClass}`}>
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
