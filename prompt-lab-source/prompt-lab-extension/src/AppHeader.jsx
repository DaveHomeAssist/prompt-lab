import { useEffect, useRef, useState } from 'react';
import Ic from './icons';
import { PALETTES, useThemeTokens } from './theme/ThemeProvider.jsx';
import { DESKTOP_PLAN_LINK_TEXT, DESKTOP_PLAN_URL, isPrelaunchOpenAccess } from './lib/billing.js';
import { SUBVIEWS } from './lib/navigationRegistry.js';
import { handleTabArrowKeys } from './hooks/useDialogA11y.js';
import MobileNavigation from './MobileNavigation.jsx';
import { openProblemReport } from './lib/diagnostics.js';
import ProjectProfileBar from './ProjectProfileBar.jsx';

export default function AppHeader({
  m, compact, libraryCount, colorMode, setColorMode,
  activeSection, openSection, openCreateView,
  primaryView, setPrimaryView, workspaceView,
  effectiveEditorLayout, setEditorLayout, createLayoutOptions,
  setShowCmdPalette, setCmdQuery, setShowShortcuts, setShowSettings,
  billingPlan, billingLabel, billingDisabled, openBilling, billingUiEnabled = true,
  // Desktop: plan chip plus a link to the web app instead of Upgrade.
  desktopPlanLink = false,
  clerkUserButton,
  accountActions = null,
  settingsButtonRef,
  renderMobileNavigation = true,
  onNewPrompt, newPromptDisabled = false,
  projectProfiles = null,
  profileSuggestion = null,
}) {
  const { palette, setPalette } = useThemeTokens();
  // Theme, palette, shortcuts and Report live in More so the logo, workspace
  // tabs and primary actions can share one row at 1024 and 1440.
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef(null);
  const moreButtonRef = useRef(null);
  useEffect(() => {
    if (!moreOpen) return undefined;
    const onPointer = (event) => { if (moreRef.current && !moreRef.current.contains(event.target)) setMoreOpen(false); };
    const onKey = (event) => { if (event.key === 'Escape') { setMoreOpen(false); moreButtonRef.current?.focus(); } };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('touchstart', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('touchstart', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [moreOpen]);
  // Publish the live header height so fixed drawers (the Library inspector at
  // <=700 px) start below it instead of under a wrapped two- or three-row header.
  const headerRef = useRef(null);
  useEffect(() => {
    const node = headerRef.current;
    if (!node || typeof document === 'undefined') return undefined;
    const root = document.documentElement;
    const publish = () => root.style.setProperty('--pl-app-header-h', `${Math.round(node.getBoundingClientRect().height)}px`);
    publish();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', publish);
      return () => window.removeEventListener('resize', publish);
    }
    const observer = new ResizeObserver(publish);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const runMore = (action) => () => {
    // Return focus to More before the action opens another dialog, so Escape
    // restores this button after the menu item has unmounted.
    moreButtonRef.current?.focus();
    setMoreOpen(false);
    action();
  };
  const moreItemClass = `pl-header-more-item ui-control flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm ${m.textAlt} hover:text-orange-300`;
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
      <header ref={headerRef} className={`pl-app-header px-4 py-2 ${m.header} border-b shrink-0`}>
      <div className="pl-header-bar">
        <div className="pl-header-identity flex min-w-0 items-center gap-2">
            <div className="flex items-center gap-1.5 shrink-0">
              <Ic n="Wand2" size={15} className="text-orange-400" />
              <span className="pl-brand-title font-bold text-sm">Prompt Lab</span>
            </div>
            <span className={`pl-header-utility text-[10px] font-semibold uppercase tracking-[0.22em] ${m.textMuted}`}>
              {utilityCopy}
            </span>
          <span data-testid="library-count" className={`pl-header-count text-[11px] whitespace-nowrap ${m.textMuted}`}>{libraryCount} saved</span>
          {billingUiEnabled && <span data-testid="billing-plan-chip" className={`pl-header-plan rounded-full px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap ${billingPlan === 'pro' ? 'pl-brand-chip' : `${m.btn} ${m.textAlt}`}`}>
            {billingLabel}
          </span>}
          {billingUiEnabled && desktopPlanLink && (
            <a
              data-testid="desktop-plan-link"
              href={DESKTOP_PLAN_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={`text-[10px] font-semibold underline underline-offset-2 ${m.textAlt}`}
            >
              {DESKTOP_PLAN_LINK_TEXT}
            </a>
          )}
          {billingUiEnabled && !desktopPlanLink && billingPlan !== 'pro' && (
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
        {!compact && <nav className="pl-unified-navigation" aria-label="Primary navigation">
          <div role="tablist" aria-label="Workspaces" className="pl-workspace-tabs" onKeyDown={event => handleTabArrowKeys(event, primaryView === 'create' ? workspaceView : primaryView, id => id === 'runs' ? openSection('evaluate') : id === 'notebook' ? setPrimaryView('notebook') : openCreateView(id))}>
            {[...createModeButtons, { id: 'runs', label: 'Evaluate', action: () => openSection('evaluate'), active: primaryView === 'runs' }, { id: 'notebook', label: 'Scratch', action: () => setPrimaryView('notebook'), active: primaryView === 'notebook' }].map(({ id, label, action, active }) => <button key={id} type="button" data-tab-id={id} data-testid={`nav-${id === 'editor' ? 'create' : id === 'runs' ? 'evaluate' : id === 'notebook' ? 'scratch' : id}`} tabIndex={active ? 0 : -1} role="tab" aria-selected={active} aria-current={active ? 'page' : undefined} onClick={action} className={`pl-tab-btn ui-control px-3 py-1.5 text-xs font-semibold rounded-lg whitespace-nowrap ${active ? activeTabClass : inactiveTabClass}`}>{label}</button>)}
          </div>
        </nav>}
        <div className="pl-header-actions ml-auto flex items-center gap-1" data-header-actions>
          {projectProfiles && (
            <ProjectProfileBar
              state={projectProfiles}
              suggestion={profileSuggestion}
              onUseSuggestion={(id) => projectProfiles.select(id)}
            />
          )}
          <button type="button" data-testid="global-new-prompt" onClick={onNewPrompt}
            disabled={newPromptDisabled} title="Start a separate prompt. Current work can be restored with Undo."
            className="pl-secondary-button pl-header-new-prompt ui-control px-2.5 py-1.5 text-xs whitespace-nowrap disabled:opacity-40">
            <Ic n="Plus" size={13} /> New Prompt
          </button>
          <button type="button" aria-label="Command palette ⌘K" title="Command palette (⌘K)" onClick={() => { setShowCmdPalette(true); setCmdQuery(''); }} className={`pl-header-command ui-control px-2 py-1 rounded-lg ${m.btn} ${m.textAlt} text-[11px] font-mono hover:text-orange-300 transition-colors`}>⌘K</button>
          <button ref={settingsButtonRef} type="button" aria-label="Settings" title="Settings" onClick={() => setShowSettings(true)} className={`ui-control p-1.5 rounded-lg ${m.btn} ${m.textAlt} hover:text-orange-300 transition-colors`}><Ic n="Settings" size={13} /></button>
          <div ref={moreRef} className="pl-header-more relative">
            <button ref={moreButtonRef} type="button" aria-label="More actions" title="More actions" aria-expanded={moreOpen} aria-controls="pl-header-more-panel" onClick={() => setMoreOpen(open => !open)} className={`ui-control p-1.5 rounded-lg ${m.btn} ${m.textAlt} hover:text-orange-300 transition-colors`}><Ic n="MoreHorizontal" size={15} /></button>
            {moreOpen && (
              <div id="pl-header-more-panel" role="group" aria-label="More actions" className={`pl-header-more-panel ${m.modal} border rounded-xl p-1.5 shadow-2xl`}>
                <button type="button" className={moreItemClass} onClick={runMore(() => { setShowCmdPalette(true); setCmdQuery(''); })}><span className="font-mono text-[11px]">⌘K</span> Command palette</button>
                <button type="button" className={moreItemClass} onClick={runMore(() => setColorMode(p => p === 'dark' ? 'light' : 'dark'))}>{colorMode === 'dark' ? <Ic n="Sun" size={13} /> : <Ic n="Moon" size={13} />} {colorMode === 'dark' ? 'Light mode' : 'Dark mode'}</button>
                <label className={`pl-palette-control flex items-center justify-between gap-2 px-3 py-1 text-sm ${m.textAlt}`}><span>Color palette</span><select aria-label="Color palette" value={palette} onChange={event => setPalette(event.target.value)}>{PALETTES.map(name => <option key={name} value={name}>{name[0].toUpperCase() + name.slice(1)}</option>)}</select></label>
                <button type="button" aria-label="Keyboard shortcuts" className={moreItemClass} onClick={runMore(() => setShowShortcuts(true))}><Ic n="Keyboard" size={13} /> Keyboard shortcuts</button>
                <button type="button" aria-label="Report a problem" className={moreItemClass} onClick={runMore(openProblemReport)}><Ic n="AlertTriangle" size={13} /> Report a problem</button>
                {accountActions?.manageAccount && <button type="button" className={moreItemClass} onClick={runMore(accountActions.manageAccount)}><Ic n="User" size={13} /> Manage account</button>}
                {accountActions?.signOut && <button type="button" className={moreItemClass} onClick={runMore(accountActions.signOut)}><Ic n="LogOut" size={13} /> Sign out</button>}
              </div>
            )}
          </div>
          {clerkUserButton && <div className="ml-1 shrink-0" data-account-slot>{clerkUserButton}</div>}
        </div>
      </div>
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
