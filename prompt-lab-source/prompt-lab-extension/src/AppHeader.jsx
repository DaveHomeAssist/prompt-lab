import Ic from './icons';
import { APP_VERSION } from './constants';
import { isPrelaunchOpenAccess } from './lib/billing.js';
import { SUBVIEWS } from './lib/navigationRegistry.js';
import { handleTabArrowKeys } from './hooks/useDialogA11y.js';
import MobileNavigation from './MobileNavigation.jsx';

export default function AppHeader({
  m, compact, libraryCount, colorMode, setColorMode,
  activeSection, openSection, openCreateView, openRunsView,
  primaryView, setPrimaryView, workspaceView, runsView,
  effectiveEditorLayout, setEditorLayout, createLayoutOptions,
  setShowCmdPalette, setCmdQuery, setShowShortcuts, setShowSettings,
  billingPlan, billingLabel, billingDisabled, openBilling,
  clerkUserButton,
  settingsButtonRef,
  renderMobileNavigation = true,
}) {
  const prelaunchOpenAccess = isPrelaunchOpenAccess({
    plan: billingPlan,
    billingDisabled,
  });
  const createModeButtons = SUBVIEWS.create.map(({ id, label }) => ({
    id,
    label,
    action: () => openCreateView(id),
    active: primaryView === 'create' && workspaceView === id,
  }));
  const activeTabClass = colorMode === 'dark'
    ? 'border border-orange-300/55 bg-orange-400/15 text-orange-100 shadow-[0_0_0_1px_rgba(251,146,60,0.12)]'
    : 'border border-orange-800/45 bg-orange-100 text-orange-950 shadow-[0_0_0_1px_rgba(154,52,18,0.10)]';
  const inactiveTabClass = `${m.btn} ${m.textAlt}`;
  const utilityCopy = primaryView === 'notebook'
    ? 'Scratch notes + prompt handoff'
    : activeSection === 'create'
      ? 'Prompt engineering workbench'
      : activeSection === 'evaluate'
        ? 'Compare + run history'
        : 'Reusable library';
  const selectPrimaryTab = (id) => {
    if (id === 'runs') openSection('evaluate');
    else if (id === 'notebook') setPrimaryView('notebook');
    else openCreateView(workspaceView === 'library' || workspaceView === 'composer' || workspaceView === 'split' ? workspaceView : 'editor');
  };

  return (
    <>
      <header className={`pl-app-header px-4 py-2 ${m.header} border-b shrink-0`}>
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
              data-testid="billing-trigger"
              onClick={() => openBilling()}
              className={`ui-control rounded-full px-2.5 py-1 text-[10px] font-semibold text-white transition-colors ${prelaunchOpenAccess ? 'bg-emerald-600/90 hover:bg-emerald-500' : 'bg-orange-500/90 hover:bg-orange-400'}`}
            >
              {prelaunchOpenAccess ? 'All Features Open' : 'Upgrade'}
            </button>
          )}
        </div>
        <div className="ml-auto flex items-center gap-1">
          <button type="button" onClick={() => { setShowCmdPalette(true); setCmdQuery(''); }} className={`ui-control px-2 py-1 rounded-lg ${m.btn} ${m.textAlt} text-[11px] font-mono hover:text-orange-300 transition-colors`}>⌘K</button>
          <button type="button" aria-label={colorMode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} onClick={() => setColorMode(p => p === 'dark' ? 'light' : 'dark')} className={`ui-control p-1.5 rounded-lg ${m.btn} ${m.textAlt} hover:text-orange-300 transition-colors`}>
            {colorMode === 'dark' ? <Ic n="Sun" size={13} /> : <Ic n="Moon" size={13} />}
          </button>
          <button type="button" aria-label="Keyboard shortcuts" onClick={() => setShowShortcuts(true)} className={`ui-control p-1.5 rounded-lg ${m.btn} ${m.textAlt} hover:text-orange-300 transition-colors`}><Ic n="Keyboard" size={13} /></button>
          <button ref={settingsButtonRef} type="button" aria-label="Settings" onClick={() => setShowSettings(true)} className={`ui-control p-1.5 rounded-lg ${m.btn} ${m.textAlt} hover:text-orange-300 transition-colors`}><Ic n="Settings" size={13} /></button>
          {clerkUserButton && <div className="ml-1">{clerkUserButton}</div>}
        </div>
      </div>
      {!compact && <div className="mt-2 flex items-center gap-2">
        <div role="tablist" aria-label="Primary workspaces" onKeyDown={(event) => handleTabArrowKeys(event, primaryView, selectPrimaryTab)}>
          <div className="pl-scroll-row">
            <button type="button" data-tab-id="create" tabIndex={primaryView === 'create' ? 0 : -1} data-testid="nav-create" onClick={() => openCreateView('editor')} role="tab" aria-selected={primaryView === 'create'} className={`pl-tab-btn ui-control px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap ${primaryView === 'create' ? activeTabClass : inactiveTabClass}`}>Create</button>
            <button type="button" data-tab-id="runs" tabIndex={primaryView === 'runs' ? 0 : -1} data-testid="nav-evaluate" onClick={() => openSection('evaluate')} role="tab" aria-selected={primaryView === 'runs'} className={`pl-tab-btn ui-control px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap ${primaryView === 'runs' ? activeTabClass : inactiveTabClass}`}>Evaluate</button>
            <button type="button" data-tab-id="notebook" tabIndex={primaryView === 'notebook' ? 0 : -1} data-testid="nav-scratch" onClick={() => setPrimaryView('notebook')} role="tab" aria-selected={primaryView === 'notebook'} className={`pl-tab-btn ui-control px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap ${primaryView === 'notebook' ? activeTabClass : inactiveTabClass}`}>Scratch</button>
          </div>
        </div>
        <div className="ml-auto min-w-0" aria-label="Prompt Lab context controls">
          <div className="pl-scroll-row">
            {activeSection === 'evaluate' && (
              <div role="tablist" aria-label="Evaluate views" className="pl-scroll-row" onKeyDown={(event) => handleTabArrowKeys(event, runsView, openRunsView)}>
                {SUBVIEWS.runs.map(({ id, label }) => (
                  <button key={id} type="button" data-tab-id={id} tabIndex={runsView === id ? 0 : -1} onClick={() => openRunsView(id)} role="tab" aria-selected={runsView === id}
                    className={`pl-tab-btn ui-control px-2.5 py-1 text-[11px] font-semibold rounded-lg transition-colors whitespace-nowrap ${runsView === id ? activeTabClass : inactiveTabClass}`}>
                    {label}
                  </button>
                ))}
              </div>
            )}
            {primaryView === 'create' && (
              <div role="tablist" aria-label="Create views" className="pl-scroll-row" onKeyDown={(event) => handleTabArrowKeys(event, workspaceView, openCreateView)}>
                {createModeButtons.map(({ id, label, action, active }) => (
                  <button key={id} type="button" data-testid={id === 'library' && !compact ? 'nav-library' : undefined} onClick={action}
                    data-tab-id={id} tabIndex={active ? 0 : -1} role="tab" aria-selected={active}
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
              </div>
            )}
            {primaryView === 'notebook' && (
              <span className={`text-[11px] ${m.textMuted}`}>Markdown notes with linked prompt promotion</span>
            )}
          </div>
        </div>
      </div>}
      </header>
      {compact && renderMobileNavigation && (
        <MobileNavigation
          primaryView={primaryView}
          workspaceView={workspaceView}
          openCreateView={openCreateView}
          openSection={openSection}
          setPrimaryView={setPrimaryView}
        />
      )}
    </>
  );
}
