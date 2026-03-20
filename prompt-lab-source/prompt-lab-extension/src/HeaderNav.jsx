import Ic from './icons';
import { APP_VERSION } from './constants';
import { SUBVIEWS } from './lib/navigationRegistry.js';

export default function HeaderNav({
  m,
  compact,
  colorMode,
  setColorMode,
  primaryView,
  setPrimaryView,
  workspaceView,
  runsView,
  tab,
  libraryCount,
  setShowCmdPalette,
  setCmdQuery,
  setShowBugReport,
  setShowShortcuts,
  setShowSettings,
  openSection,
  openCreateView,
  openRunsView,
  activeSection,
  primaryTabs,
  effectiveEditorLayout,
  setEditorLayout,
  createLayoutOptions,
  handleTabListKeyDown,
}) {
  return (
      <header className={`px-4 py-2 ${m.header} border-b shrink-0`}>
        <div className={`flex ${compact ? 'flex-col gap-2' : 'items-center justify-between gap-3'}`}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5">
                <Ic n="Wand2" size={15} className="text-violet-500" />
                <span className="font-bold text-sm">Prompt Lab</span>
                <span className={`text-[10px] font-mono ${m.textMuted}`}>v{APP_VERSION}</span>
              </div>
              <span className={`text-xs ${m.textMuted}`}>{libraryCount} saved</span>
            </div>
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => { setShowCmdPalette(true); setCmdQuery(''); }} className={`ui-control px-2 py-1 rounded-lg ${m.btn} ${m.textAlt} text-xs font-mono hover:text-violet-400 transition-colors`}>⌘K</button>
              <button type="button" onClick={() => setShowBugReport(true)} className={`ui-control px-2.5 py-1.5 rounded-lg ${m.btn} ${m.textAlt} text-sm font-semibold hover:text-violet-400 transition-colors flex items-center gap-1.5`}>
                <Ic n="FileText" size={12} />
                {!compact && <span>Report Bug</span>}
              </button>
              <button type="button" aria-label={colorMode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} onClick={() => setColorMode(p => p === 'dark' ? 'light' : 'dark')} className={`ui-control p-1.5 rounded-lg ${m.btn} ${m.textAlt} hover:text-violet-400 transition-colors`}>
                {colorMode === 'dark' ? <Ic n="Sun" size={13} /> : <Ic n="Moon" size={13} />}
              </button>
              <button type="button" aria-label="Keyboard shortcuts" onClick={() => setShowShortcuts(true)} className={`ui-control p-1.5 rounded-lg ${m.btn} ${m.textAlt} hover:text-violet-400 transition-colors`}><Ic n="Keyboard" size={13} /></button>
              <button type="button" aria-label="Settings" onClick={() => setShowSettings(true)} className={`ui-control p-1.5 rounded-lg ${m.btn} ${m.textAlt} hover:text-violet-400 transition-colors`}><Ic n="Settings" size={13} /></button>
            </div>
          </div>
        </div>
        <div className={`flex items-center justify-between gap-2 mt-2 ${compact ? 'flex-col items-stretch' : ''}`}>
          <div
            className={`${compact ? 'overflow-x-auto pb-1 pl-subtle-scroll' : ''}`}
            role="tablist"
            aria-label="Primary workspaces"
            onKeyDown={(event) => handleTabListKeyDown(event, primaryTabs, activeSection, openSection)}
          >
            <div className="pl-scroll-row">
            {primaryTabs.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                onClick={() => openSection(id)}
                role="tab"
                tabIndex={activeSection === id ? 0 : -1}
                aria-selected={activeSection === id}
                className={`pl-tab-btn ui-control px-3 py-1.5 text-sm font-semibold rounded-lg transition-colors duration-150 whitespace-nowrap ${
                  activeSection === id
                    ? 'border-b-2 border-violet-500 bg-violet-500/10 text-violet-400'
                    : `bg-transparent ${m.textAlt} hover:bg-gray-800/50 hover:text-gray-300`
                }`}>
                {label}
              </button>
            ))}
            </div>
          </div>
          <div className={`${compact ? 'overflow-x-auto pb-1 pl-subtle-scroll' : ''}`} aria-label="Prompt Lab utilities">
            <div className="pl-scroll-row">
            <button type="button" onClick={() => openCreateView('composer')}
              className={`pl-tab-btn ui-control px-2.5 py-1 text-sm font-semibold rounded-lg transition-colors duration-150 whitespace-nowrap ${
                workspaceView === 'composer'
                  ? 'border-b-2 border-violet-500 bg-violet-500/10 text-violet-400'
                  : `bg-transparent ${m.btn} ${m.textAlt} hover:bg-gray-800/50 hover:text-gray-300`
              }`}>
              Build
            </button>
            <button type="button" onClick={() => setPrimaryView('notebook')}
              className={`pl-tab-btn ui-control px-2.5 py-1 text-sm font-semibold rounded-lg transition-colors duration-150 whitespace-nowrap ${
                primaryView === 'notebook'
                  ? 'border-b-2 border-violet-500 bg-violet-500/10 text-violet-400'
                  : `bg-transparent ${m.btn} ${m.textAlt} hover:bg-gray-800/50 hover:text-gray-300`
              }`}>
              Notebook
            </button>
            </div>
          </div>
        </div>
        <div
          className={`mt-2 ${compact ? 'overflow-x-auto pb-1 pl-subtle-scroll' : ''}`}
          role="tablist"
          aria-label={activeSection === 'runs' ? 'Run views' : primaryView === 'notebook' ? 'Notebook status' : 'Create workspace controls'}
          onKeyDown={(event) => {
            if (activeSection === 'runs') handleTabListKeyDown(event, SUBVIEWS.runs, runsView, openRunsView);
            if (activeSection === 'create' && createLayoutOptions.length > 0) {
              handleTabListKeyDown(
                event,
                createLayoutOptions.map(([id, label]) => ({ id, label })),
                effectiveEditorLayout,
                setEditorLayout,
              );
            }
          }}
        >
          <div className="pl-scroll-row">
          {activeSection === 'runs' && (
            <>
              {SUBVIEWS.runs.map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => openRunsView(id)}
                  role="tab"
                  tabIndex={runsView === id ? 0 : -1}
                  aria-selected={runsView === id}
                  className={`pl-tab-btn ui-control px-2.5 py-1 text-sm font-semibold rounded-lg transition-colors duration-150 whitespace-nowrap ${
                    runsView === id
                      ? 'border-b-2 border-violet-500 bg-violet-500/10 text-violet-400'
                      : `bg-transparent ${m.btn} ${m.textAlt} hover:bg-gray-800/50 hover:text-gray-300`
                  }`}>
                  {label}
                </button>
              ))}
            </>
          )}
          {primaryView === 'notebook' && (
            <span className={`text-sm ${m.textMuted}`}>Structured prompt notes with direct Prompt Lab handoff</span>
          )}
          {activeSection === 'create' && createLayoutOptions.length > 0 && (
            <>
              {createLayoutOptions.map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setEditorLayout(id)}
                  role="tab"
                  tabIndex={effectiveEditorLayout === id ? 0 : -1}
                  aria-selected={effectiveEditorLayout === id}
                  className={`pl-tab-btn ui-control px-2.5 py-1 text-sm font-semibold rounded-lg transition-colors duration-150 whitespace-nowrap ${
                    effectiveEditorLayout === id
                      ? 'border-b-2 border-violet-500 bg-violet-500/10 text-violet-400'
                      : `bg-transparent ${m.btn} ${m.textAlt} hover:bg-gray-800/50 hover:text-gray-300`
                  }`}>
                  {label}
                </button>
              ))}
            </>
          )}
          {activeSection === 'saved' && (
            <span className={`text-sm ${m.textMuted}`}>Browse, filter, and reuse saved prompts</span>
          )}
          </div>
        </div>
      </header>
  );
}
