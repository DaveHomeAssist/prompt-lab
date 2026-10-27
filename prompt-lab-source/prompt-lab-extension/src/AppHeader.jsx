import Ic from './icons';
import { APP_VERSION } from './constants';
import { BUILD_IDENTITY } from './buildIdentity.js';
import { PALETTES, useThemeTokens } from './theme/ThemeProvider.jsx';
import { isPrelaunchOpenAccess } from './lib/billing.js';
import { SUBVIEWS } from './lib/navigationRegistry.js';
import { handleTabArrowKeys } from './hooks/useDialogA11y.js';
import MobileNavigation from './MobileNavigation.jsx';
import { openProblemReport } from './lib/diagnostics.js';

export default function AppHeader({
  m, compact, libraryCount, colorMode, setColorMode,
  activeSection, openSection, openCreateView, openRunsView,
  primaryView, setPrimaryView, workspaceView, runsView,
  effectiveEditorLayout, setEditorLayout, createLayoutOptions,
  setShowCmdPalette, setCmdQuery, setShowShortcuts, setShowSettings,
  billingPlan, billingLabel, billingDisabled, openBilling, billingUiEnabled = true,
  clerkUserButton,
  settingsButtonRef,
  renderMobileNavigation = true,
  onNewPrompt, newPromptDisabled = false,
}) {
  const { palette, setPalette } = useThemeTokens();
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


  return (
    <>
      <header className={`pl-app-header px-4 py-2 ${m.header} border-b shrink-0`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="pl-header-identity flex min-w-0 items-center gap-2.5">
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 shrink-0">
              <Ic n="Wand2" size={15} className="text-orange-400" />
              <span className="pl-brand-title font-bold text-sm">Prompt Lab</span>
              <span className={`text-[10px] font-mono ${m.textMuted}`}>v{APP_VERSION}{BUILD_IDENTITY}</span>
            </div>
            <span className={`text-[10px] font-semibold uppercase tracking-[0.22em] ${m.textMuted}`}>
              {utilityCopy}
            </span>
          </div>
          <span data-testid="library-count" className={`text-[11px] ${m.textMuted}`}>{libraryCount} saved</span>
          {billingUiEnabled && <span data-testid="billing-plan-chip" className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${billingPlan === 'pro' ? 'pl-brand-chip' : `${m.btn} ${m.textAlt}`}`}>
            {billingLabel}
          </span>}
          {billingUiEnabled && billingPlan !== 'pro' && (
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
          <button type="button" data-testid="global-new-prompt" onClick={onNewPrompt}
            disabled={newPromptDisabled} title="Start a separate prompt. Current work can be restored with Undo."
            className="pl-primary-button ui-control px-2.5 py-1.5 text-xs whitespace-nowrap disabled:opacity-40">
            <Ic n="Plus" size={13} /> New Prompt
          </button>
          <button type="button" aria-label="Command palette ⌘K" title="Command palette (⌘K)" onClick={() => { setShowCmdPalette(true); setCmdQuery(''); }} className={`ui-control px-2 py-1 rounded-lg ${m.btn} ${m.textAlt} text-[11px] font-mono hover:text-orange-300 transition-colors`}>⌘K</button>
          <button type="button" aria-label={colorMode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} title={colorMode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} onClick={() => setColorMode(p => p === 'dark' ? 'light' : 'dark')} className={`ui-control p-1.5 rounded-lg ${m.btn} ${m.textAlt} hover:text-orange-300 transition-colors`}>
            {colorMode === 'dark' ? <Ic n="Sun" size={13} /> : <Ic n="Moon" size={13} />}
          </button>
          <label className="pl-palette-control"><span className="sr-only">Color palette</span><select aria-label="Color palette" value={palette} onChange={event => setPalette(event.target.value)}>{PALETTES.map(name => <option key={name} value={name}>{name[0].toUpperCase() + name.slice(1)}</option>)}</select></label>
          <button type="button" aria-label="Keyboard shortcuts" title="Keyboard shortcuts" onClick={() => setShowShortcuts(true)} className={`ui-control p-1.5 rounded-lg ${m.btn} ${m.textAlt} hover:text-orange-300 transition-colors`}><Ic n="Keyboard" size={13} /></button>
          <button ref={settingsButtonRef} type="button" aria-label="Settings" title="Settings" onClick={() => setShowSettings(true)} className={`ui-control p-1.5 rounded-lg ${m.btn} ${m.textAlt} hover:text-orange-300 transition-colors`}><Ic n="Settings" size={13} /></button>
          <button type="button" onClick={openProblemReport} aria-label="Report a problem" title="Report a problem" className={`ui-control px-2 py-1.5 rounded-lg ${m.btn} ${m.textAlt} text-xs`}>Report</button>
          {clerkUserButton && <div className="ml-1">{clerkUserButton}</div>}
        </div>
      </div>
      {!compact && <div className="pl-unified-navigation">
        <div role="tablist" aria-label="Workspaces" className="pl-workspace-tabs" onKeyDown={event => handleTabArrowKeys(event, primaryView === 'create' ? workspaceView : primaryView, id => id === 'runs' ? openSection('evaluate') : id === 'notebook' ? setPrimaryView('notebook') : openCreateView(id))}>
          {[...createModeButtons, { id: 'runs', label: 'Evaluate', action: () => openSection('evaluate'), active: primaryView === 'runs' }, { id: 'notebook', label: 'Scratch', action: () => setPrimaryView('notebook'), active: primaryView === 'notebook' }].map(({ id, label, action, active }) => <button key={id} type="button" data-tab-id={id} data-testid={`nav-${id === 'editor' ? 'create' : id === 'runs' ? 'evaluate' : id === 'notebook' ? 'scratch' : id}`} tabIndex={active ? 0 : -1} role="tab" aria-selected={active} onClick={action} className={`pl-tab-btn ui-control px-3 py-1.5 text-xs font-semibold rounded-lg ${active ? activeTabClass : inactiveTabClass}`}>{label}</button>)}
        </div>
        {primaryView === 'runs' && <div role="tablist" aria-label="Evaluate views" className="pl-scroll-row" onKeyDown={event => handleTabArrowKeys(event, runsView, openRunsView)}>{SUBVIEWS.runs.map(({ id, label }) => <button key={id} type="button" data-tab-id={id} tabIndex={runsView === id ? 0 : -1} role="tab" aria-selected={runsView === id} onClick={() => openRunsView(id)} className={`pl-tab-btn ui-control px-2.5 py-1 text-xs rounded-lg ${runsView === id ? activeTabClass : inactiveTabClass}`}>{label}</button>)}</div>}
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
