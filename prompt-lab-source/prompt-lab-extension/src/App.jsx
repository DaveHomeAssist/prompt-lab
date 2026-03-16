import { useEffect, useState } from 'react';
import Ic from './icons';
import {
  wordDiff, scorePrompt,
  isGhostVar, ngramSimilarity,
} from './promptUtils';
import { ALL_TAGS, T, APP_VERSION } from './constants';
import useLibrary from './hooks/usePromptLibrary.js';
import useUiState from './hooks/useUiState.js';
import useEditorState from './hooks/useEditorState.js';
import useExecutionFlow from './hooks/useExecutionFlow.js';
import usePersistenceFlow from './hooks/usePersistenceFlow.js';
import Toast from './Toast';
import TagChip from './TagChip';
import PadTab from './PadTab';
import ComposerTab from './ComposerTab';
import ABTestTab from './ABTestTab';
import LibraryPanel from './LibraryPanel';
import DesktopSettingsModal from './DesktopSettingsModal';
import VersionDiffModal from './VersionDiffModal';
import RunTimelinePanel from './RunTimelinePanel';
import { isExtension } from './lib/platform.js';
import MainWorkspace from './MainWorkspace';
import EditorActions from './EditorActions';
import { ThemeProvider } from './theme/ThemeProvider.jsx';
import MarkdownPreview from './MarkdownPreview';

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const ui = useUiState();
  const [showDesktopSettings, setShowDesktopSettings] = useState(false);
  const [showGoldenComparison, setShowGoldenComparison] = useState(true);
  const [mdPreview, setMdPreview] = useState(false);
  const [enhMdPreview, setEnhMdPreview] = useState(false);
  const isWeb = !isExtension && import.meta.env?.VITE_WEB_MODE === 'true';
  const {
    viewportWidth,
    viewportHeight,
    colorMode,
    setColorMode,
    density,
    setDensity,
    tab,
    setTab,
    toast,
    setToast,
    notify,
    showSettings,
    setShowSettings,
    showCmdPalette,
    setShowCmdPalette,
    showShortcuts,
    setShowShortcuts,
    cmdQuery,
    setCmdQuery,
  } = ui;
  const m = T[colorMode];

  // ── Library hook ──
  const lib = useLibrary(notify);

  // ── Editor controllers (state + execution + persistence) ──
  const editorState = useEditorState();
  const persistenceFlow = usePersistenceFlow({ ui, lib, editor: editorState });
  const executionFlow = useExecutionFlow({ ui, lib, editor: editorState, persistence: persistenceFlow });
  const ed = {
    ...editorState,
    ...persistenceFlow,
    ...executionFlow,
    doSave: () => persistenceFlow.doSave(executionFlow.refreshEvalRuns),
    clearEditor: () => {
      executionFlow.clearExecutionState();
      persistenceFlow.clearPersistenceState();
      editorState.clearEditorState();
    },
  };
  const {
    raw, setRaw, enhanced, setEnhanced, variants, notes, loading, error,
    enhMode, setEnhMode, showNotes, setShowNotes,
    lintIssues, lintOpen, setLintOpen, handleLintFix,
    piiWarning, piiSendAnyway, piiRedactAndSend, piiCancel,
    showSave, setShowSave, editingId, setEditingId, saveTitle, setSaveTitle,
    saveTags, setSaveTags, saveCollection, setSaveCollection,
    changeNote, setChangeNote,
    showDiff, setShowDiff,
    evalRuns, showEvalHistory, setShowEvalHistory,
    testCasesByPrompt, caseFormPromptId, editingCaseId,
    caseTitle, setCaseTitle, caseInput, setCaseInput,
    caseTraits, setCaseTraits, caseExclusions, setCaseExclusions,
    caseNotes, setCaseNotes, runningCases,
    openCaseForm, resetCaseForm, saveCaseForPrompt, removeCase,
    loadCaseIntoEditor, runSingleCase, runAllCases,
    showNewColl, setShowNewColl, newCollName, setNewCollName,
    varVals, setVarVals, showVarForm, setShowVarForm, pendingTemplate, applyTemplate,
    editorLayout, setEditorLayout,
    composerBlocks, setComposerBlocks,
    enhance, doSave, clearEditor, openSavePanel, openOptions, copy,
    loadEntry, addToComposer,
    hasSavablePrompt, currentTestCases,
  } = ed;

  // ── Derived (view-only) ──
  const score = scorePrompt(raw);
  const wc = typeof raw === 'string' && raw.trim() ? raw.trim().split(/\s+/).length : 0;
  const compact = viewportWidth < 720 || viewportHeight < 560;
  const effectiveEditorLayout = compact && editorLayout === 'split' ? 'editor' : editorLayout;
  const inp = `w-full ${m.input} border rounded-lg p-3 text-sm resize-none focus:outline-none focus:border-violet-500 transition-colors placeholder-gray-400 ${m.text}`;
  const copyBtn = colorMode === 'dark'
    ? 'border border-violet-400/30 bg-violet-500/15 text-violet-200 hover:border-violet-300 hover:bg-violet-500/25'
    : 'border border-violet-300 bg-violet-50 text-violet-700 hover:border-violet-400 hover:bg-violet-100';
  const showEditorPane = tab !== 'editor' || effectiveEditorLayout !== 'library';
  const showLibraryPane = tab !== 'editor' || effectiveEditorLayout !== 'editor';
  const primaryModKey = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
    ? 'Cmd'
    : 'Ctrl';
  const currentEntry = editingId ? lib.library.find((entry) => entry.id === editingId) || null : null;
  const versionHistoryEntry = lib.expandedVersionId
    ? lib.library.find((entry) => entry.id === lib.expandedVersionId) || null
    : null;
  const goldenResponse = currentEntry?.goldenResponse || null;
  const latestEvalRun = evalRuns[0] || null;
  const comparisonText = typeof enhanced === 'string' && enhanced.trim()
    ? enhanced
    : (typeof latestEvalRun?.output === 'string' ? latestEvalRun.output : '');
  const comparisonSourceLabel = typeof enhanced === 'string' && enhanced.trim() ? 'Current enhanced output' : 'Latest eval run';
  const goldenSimilarity = goldenResponse?.text && comparisonText
    ? ngramSimilarity(goldenResponse.text, comparisonText)
    : 0;
  const goldenThreshold = currentEntry?.goldenThreshold ?? 0.7;
  const goldenVerdict = goldenResponse?.text && comparisonText
    ? (goldenSimilarity >= goldenThreshold ? 'pass' : 'fail')
    : null;

  const loadTemplateWithoutVars = () => {
    if (!pendingTemplate) return;
    setEditingId(pendingTemplate.id);
    setRaw(pendingTemplate.original || '');
    setEnhanced(pendingTemplate.enhanced || '');
    setVariants(pendingTemplate.variants || []);
    setNotes(pendingTemplate.notes || '');
    setSaveTags(pendingTemplate.tags || []);
    setSaveTitle(pendingTemplate.title || '');
    setSaveCollection(pendingTemplate.collection || '');
    setShowSave(false);
    setShowDiff(false);
    setVarVals({});
    setShowVarForm(false);
    lib.bumpUse(pendingTemplate.id);
    setTab('editor');
    notify('Loaded into editor!');
  };

  // ── Keyboard shortcuts ──
  useEffect(() => {
    const h = e => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === 'Enter') { e.preventDefault(); if (!loading && raw.trim()) enhance(); }
      if (mod && e.key === 's') {
        e.preventDefault();
        if (hasSavablePrompt && !showSave) openSavePanel();
        else if (hasSavablePrompt && showSave) doSave();
      }
      if (mod && e.key === 'k') { e.preventDefault(); setShowCmdPalette(p => !p); setCmdQuery(''); }
      if (e.key === '?' && !['INPUT', 'TEXTAREA'].includes(e.target.tagName)) setShowShortcuts(p => !p);
      if (e.key === 'Escape') {
        setShowCmdPalette(false);
        setShowShortcuts(false);
        setShowSettings(false);
        lib.setShareId(null);
        lib.closeVersionHistory();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [loading, raw, showSave, hasSavablePrompt]);

  useEffect(() => {
    if (isExtension) return;
    const handler = () => setShowDesktopSettings(true);
    window.addEventListener('pl:open-settings', handler);
    return () => window.removeEventListener('pl:open-settings', handler);
  }, []);

  // ── Command palette ──
  const CMD_ACTIONS = [
    { label: 'Enhance Prompt', hint: '⌘↵', action: () => { if (!loading && raw.trim()) enhance(); setShowCmdPalette(false); } },
    { label: 'Save Prompt', hint: '⌘S', action: () => { if (hasSavablePrompt) openSavePanel(); setShowCmdPalette(false); } },
    { label: 'Clear Editor', hint: '', action: () => { clearEditor(); setShowCmdPalette(false); } },
    { label: 'Go to Editor', hint: '', action: () => { setTab('editor'); setShowCmdPalette(false); } },
    { label: 'Go to Composer', hint: '', action: () => { setTab('composer'); setShowCmdPalette(false); } },
    { label: 'Go to A/B Test', hint: '', action: () => { setTab('abtest'); setShowCmdPalette(false); } },
    { label: 'Go to Pad', hint: '', action: () => { setTab('pad'); setShowCmdPalette(false); } },
    { label: 'Toggle Light / Dark', hint: '', action: () => { setColorMode(p => p === 'dark' ? 'light' : 'dark'); setShowCmdPalette(false); } },
    { label: 'Export Library', hint: '', action: () => { lib.exportLib(); setShowCmdPalette(false); } },
    { label: 'Open Settings', hint: '', action: () => { setShowSettings(true); setShowCmdPalette(false); } },
    { label: 'Extension Options (API Key)', hint: '', action: () => { openOptions(); setShowCmdPalette(false); } },
    { label: 'Show Keyboard Shortcuts', hint: '?', action: () => { setShowShortcuts(true); setShowCmdPalette(false); } },
  ];
  const filteredCmds = CMD_ACTIONS.filter(a => !cmdQuery || a.label.toLowerCase().includes(cmdQuery.toLowerCase()));

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <ThemeProvider mode={colorMode}>
      <div data-theme={colorMode} className={`min-h-screen ${m.bg} ${m.text} flex flex-col pl-density-${density}`} style={{ fontFamily: 'system-ui,sans-serif' }}>
      <h1 className="sr-only">Prompt Lab</h1>

      {/* Header */}
      <header className={`px-4 py-2 ${m.header} border-b shrink-0`}>
        <div className={`flex ${compact ? 'flex-col gap-2' : 'items-center justify-between gap-3'}`}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5">
                <Ic n="Wand2" size={15} className="text-violet-500" />
                <span className="font-bold text-sm">Prompt Lab</span>
                <span className={`text-[10px] font-mono ${m.textMuted}`}>v{APP_VERSION}</span>
              </div>
              <span className={`text-[11px] ${m.textMuted}`}>{lib.library.length} saved</span>
            </div>
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => { setShowCmdPalette(true); setCmdQuery(''); }} className={`ui-control px-2 py-1 rounded-lg ${m.btn} ${m.textAlt} text-[11px] font-mono hover:text-violet-400 transition-colors`}>⌘K</button>
              <button type="button" onClick={() => setColorMode(p => p === 'dark' ? 'light' : 'dark')} className={`ui-control p-1.5 rounded-lg ${m.btn} ${m.textAlt} hover:text-violet-400 transition-colors`}>
                {colorMode === 'dark' ? <Ic n="Sun" size={13} /> : <Ic n="Moon" size={13} />}
              </button>
              <button type="button" onClick={() => setShowShortcuts(true)} className={`ui-control p-1.5 rounded-lg ${m.btn} ${m.textAlt} hover:text-violet-400 transition-colors`}><Ic n="Keyboard" size={13} /></button>
              <button type="button" onClick={() => setShowSettings(true)} className={`ui-control p-1.5 rounded-lg ${m.btn} ${m.textAlt} hover:text-violet-400 transition-colors`}><Ic n="Settings" size={13} /></button>
            </div>
          </div>
          <div className={`flex items-center gap-1 ${compact ? 'overflow-x-auto pb-1' : ''}`} role="tablist" aria-label="Prompt Lab views">
            {[['editor', 'Prompt Editor'], ['composer', 'Compose'], ['abtest', 'A/B Test'], ['pad', 'Scratchpad'], ['history', 'History']].map(([id, label]) => (
              <button key={id} type="button" onClick={() => setTab(id)} role="tab" aria-selected={tab === id}
                className={`ui-control px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap ${tab === id ? 'bg-violet-600 text-white' : `${m.btn} ${m.textAlt}`}`}>
                {label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main role="tabpanel" aria-label={tab} className="flex-1 flex flex-col overflow-hidden">
      {/* ══ EDITOR TAB ══ */}
      {tab === 'editor' && (
        <MainWorkspace
          m={m}
          compact={compact}
          isWeb={isWeb}
          showEditorPane={showEditorPane}
          showLibraryPane={showLibraryPane}
          editorPane={(
            <div className="h-full min-h-0 flex flex-col overflow-hidden">
              <div className="p-4 flex flex-col gap-3 h-full min-h-0 overflow-hidden">
              <div className="flex gap-1">
                {[
                  ['editor', 'Editor'],
                  ['library', 'Prompt Library'],
                  ...(!compact ? [['split', 'Split']] : []),
                ].map(([id, label]) => (
                  <button key={id} type="button" onClick={() => setEditorLayout(id)}
                    className={`ui-control text-xs px-2.5 py-1 rounded-lg transition-colors ${effectiveEditorLayout === id ? 'bg-violet-600 text-white' : `${m.btn} ${m.textAlt}`}`}>
                    {label}
                  </button>
                ))}
              </div>
              {/* Input */}
              <div>
                <div className={`flex justify-between items-center mb-1.5 ${compact ? 'gap-2 flex-wrap' : ''}`}>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs ${m.textSub} uppercase tracking-widest font-semibold`}>Input</span>
                    <div className="flex rounded-md overflow-hidden border" style={{ borderColor: 'rgba(255,255,255,0.1)' }}>
                      <button type="button" onClick={() => setMdPreview(false)} aria-pressed={!mdPreview}
                        className={`text-[10px] px-2 py-0.5 transition-colors ${!mdPreview ? 'bg-violet-600 text-white' : `${m.btn} ${m.textAlt}`}`}>Write</button>
                      <button type="button" onClick={() => setMdPreview(true)} aria-pressed={mdPreview}
                        className={`text-[10px] px-2 py-0.5 transition-colors ${mdPreview ? 'bg-violet-600 text-white' : `${m.btn} ${m.textAlt}`}`}>Preview</button>
                    </div>
                  </div>
                  <span className={`text-xs ${m.textMuted}`}>{wc}w · {raw.length}c{score ? ` · ~${score.tokens} tok` : ''}</span>
                </div>
                {mdPreview ? (
                  <div className={`${inp} overflow-y-auto`} style={{ minHeight: '12rem', maxHeight: '24rem' }}>
                    {raw.trim() ? <MarkdownPreview text={raw} /> : <span className={`text-sm ${m.textSub}`}>Nothing to preview</span>}
                  </div>
                ) : (
                  <textarea rows={8} className={inp} placeholder="Paste or write your prompt here…" value={raw} onChange={e => setRaw(e.target.value)} />
                )}
              </div>
              {/* Scoring */}
              {score && (() => {
                const checks = [['Role', score.role], ['Task', score.task], ['Format', score.format], ['Constraints', score.constraints], ['Context', score.context]];
                const cnt = checks.filter(c => c[1]).length;
                return (
                  <div className={`${m.surface} border ${m.border} rounded-lg p-3`}>
                    <div className="flex justify-between items-center mb-2">
                      <span className={`text-xs font-semibold ${m.textSub} uppercase tracking-wider`}>Prompt Quality</span>
                      <span className={`text-xs font-bold ${cnt >= 4 ? 'text-green-500' : cnt >= 2 ? 'text-yellow-500' : 'text-red-500'}`}>{cnt}/5</span>
                    </div>
                    <div className="flex gap-3 flex-wrap">
                      {checks.map(([lbl, ok]) => (
                        <span key={lbl} className={`flex items-center gap-1 text-xs ${ok ? m.scoreGood : m.scoreBad}`}>
                          {ok ? <Ic n="Check" size={9} /> : <Ic n="X" size={9} />}{lbl}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })()}
              {/* Lint Issues */}
              {lintIssues.length > 0 && (
                <div className={`${m.surface} border ${m.border} rounded-lg`}>
                  <button onClick={() => setLintOpen(p => !p)}
                    className={`w-full flex justify-between items-center px-3 py-2 text-xs font-semibold ${m.textSub} uppercase tracking-wider`}>
                    <span>Lint ({lintIssues.length} {lintIssues.length === 1 ? 'issue' : 'issues'})</span>
                    <Ic n={lintOpen ? 'ChevronUp' : 'ChevronDown'} size={10} />
                  </button>
                  {lintOpen && (
                    <div className="px-3 pb-3 flex flex-col gap-1.5">
                      {lintIssues.map(issue => (
                        <div key={issue.id} className={`flex items-start justify-between gap-2 text-xs ${
                          issue.severity === 'warning' ? 'text-yellow-400' : m.textAlt
                        }`}>
                          <span className="flex-1">{issue.message}</span>
                          <button onClick={() => handleLintFix(issue.id)}
                            className="shrink-0 text-violet-400 hover:text-violet-300 text-xs underline">Fix</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {/* Mode + Enhance */}
              <span className={`text-xs ${m.textSub} uppercase tracking-widest font-semibold`}>Enhance Lab</span>
              <EditorActions
                m={m}
                compact={compact}
                enhMode={enhMode}
                onEnhanceModeChange={setEnhMode}
                onEnhance={enhance}
                onRunCases={runAllCases}
                onSave={() => openSavePanel()}
                onClear={clearEditor}
                loading={loading}
                hasInput={Boolean(raw.trim())}
                runningCases={runningCases}
                testCaseCount={currentTestCases.length}
                hasSavablePrompt={hasSavablePrompt}
                enhanceShortcutLabel={`${primaryModKey}+Enter`}
              />
              {editingId && currentTestCases.length > 0 && (
                <div className={`flex items-center justify-between ${m.surface} border ${m.border} rounded-lg px-3 py-2`}>
                  <span className={`text-xs ${m.textSub} flex items-center gap-1.5`}>
                    <Ic n="FlaskConical" size={10} />
                    {currentTestCases.length} test {currentTestCases.length === 1 ? 'case' : 'cases'}
                  </span>
                  <button onClick={runAllCases} disabled={loading || runningCases}
                    className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 disabled:opacity-40 font-semibold transition-colors">
                    {runningCases ? <span className="w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" /> : <Ic n="FlaskConical" size={10} />}
                    Run All
                  </button>
                </div>
              )}
              {error && (
                <div className="text-red-400 text-xs bg-red-950/40 border border-red-900 rounded-lg p-2.5">
                  <p className="font-semibold mb-1">{error.userMessage}</p>
                  {error.suggestions?.length > 0 && (
                    <ul className="list-disc list-inside mb-2 text-red-300/80">
                      {error.suggestions.map((s, i) => <li key={i}>{s}</li>)}
                    </ul>
                  )}
                  <div className="flex gap-2">
                    {error.actions?.includes('retry') && (
                      <button onClick={() => enhance()} className="text-xs text-violet-400 hover:text-violet-300 underline">Retry</button>
                    )}
                    {error.actions?.includes('open_provider_settings') && (
                      <button onClick={openOptions} className="text-xs text-violet-400 hover:text-violet-300 underline">Open Settings</button>
                    )}
                  </div>
                </div>
              )}
              <div className="min-h-0 flex-1 overflow-y-auto pr-1 space-y-3">
              {/* Enhanced */}
              {enhanced && <>
                <div>
                  <div className="flex justify-between items-center mb-1.5">
                    <span className="flex items-center gap-2">
                      <span className="text-xs text-violet-400 uppercase tracking-widest font-semibold">Enhanced</span>
                      {goldenVerdict && (
                        <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${goldenVerdict === 'pass' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
                          {goldenVerdict === 'pass' ? '✓' : '✗'} {Math.round(goldenSimilarity * 100)}%
                        </span>
                      )}
                    </span>
                    <div className={`flex items-center gap-3 ${compact ? 'flex-wrap justify-end' : ''}`}>
                      <button onClick={() => { setShowDiff(p => !p); setEnhMdPreview(false); }} className={`flex items-center gap-1 text-xs transition-colors ${showDiff ? 'text-violet-400' : `${m.textSub} hover:text-white`}`}>
                        <Ic n="GitBranch" size={10} />{showDiff ? 'Hide Diff' : 'Show Diff'}
                      </button>
                      <button onClick={() => { setEnhMdPreview(p => !p); setShowDiff(false); }} className={`flex items-center gap-1 text-xs transition-colors ${enhMdPreview ? 'text-violet-400' : `${m.textSub} hover:text-white`}`}>
                        <Ic n="Eye" size={10} />{enhMdPreview ? 'Edit' : 'Preview'}
                      </button>
                      {editingId && (
                        <button
                          onClick={() => lib.pinGoldenResponse(editingId, {
                            text: enhanced,
                            runId: latestEvalRun?.id,
                            provider: latestEvalRun?.provider,
                            model: latestEvalRun?.model,
                          })}
                          disabled={!enhanced.trim()}
                          className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded transition-colors ${
                            enhanced.trim() ? 'bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25' : `${m.btn} ${m.textMuted} opacity-40 cursor-not-allowed`
                          }`}
                        >
                          <Ic n="Save" size={12} />Pin Golden
                        </button>
                      )}
                      <button
                        onClick={() => copy(enhanced)}
                        className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md font-semibold transition-colors ${copyBtn}`}
                      ><Ic n="Copy" size={12} />Copy</button>
                    </div>
                  </div>
                  {showDiff ? (
                    <div className={`${m.codeBlock} border ${m.border} rounded-lg p-3 text-sm leading-loose`}>
                      {wordDiff(raw, enhanced).map((d, i) => (
                        <span key={i} className={`${d.t === 'add' ? m.diffAdd : d.t === 'del' ? m.diffDel : m.diffEq} px-0.5 rounded mr-0.5`}>{d.v}</span>
                      ))}
                    </div>
                  ) : enhMdPreview ? (
                    <div className={`${inp} border-violet-500/40 overflow-y-auto`} style={{ minHeight: '8rem', maxHeight: '24rem' }}>
                      <MarkdownPreview text={enhanced} />
                    </div>
                  ) : (
                    <textarea rows={5} className={`${inp} border-violet-500/40`} value={enhanced} onChange={e => setEnhanced(e.target.value)} />
                  )}
                </div>
                {/* Variants */}
                {variants.length > 0 && (
                  <div>
                    <span className={`text-xs ${m.textSub} uppercase tracking-widest font-semibold block mb-2`}>Variants</span>
                    <div className="flex flex-col gap-2">
                      {variants.map((v, i) => (
                        <div key={i} className={`${m.surface} border ${m.border} ${m.borderHov} rounded-lg p-3 transition-colors`}>
                          <div className="flex justify-between items-center mb-1">
                            <span className="text-xs font-bold text-violet-400">{v.label}</span>
                            <div className="flex gap-3">
                              <button onClick={() => setEnhanced(v.content)} className={`text-xs ${m.textAlt} hover:text-violet-400 transition-colors`}>Use</button>
                              <button onClick={() => copy(v.content)} className={`${m.textAlt} hover:text-white transition-colors`}><Ic n="Copy" size={10} /></button>
                            </div>
                          </div>
                          <p className={`text-xs ${m.textAlt} leading-relaxed line-clamp-2`}>{v.content}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {showNotes && notes && (
                  <div className={`${m.notesBg} border rounded-lg p-3`}>
                    <p className={`text-xs font-bold ${m.notesText} mb-1`}>Enhancement Notes</p>
                    <p className={`text-xs ${m.textBody} leading-relaxed`}>{notes}</p>
                  </div>
                )}
                <div className={`${m.surface} border ${m.border} rounded-lg`}>
                  <button type="button" onClick={() => setShowEvalHistory(p => !p)}
                    className={`w-full flex justify-between items-center px-3 py-2 text-xs font-semibold ${m.textSub} uppercase tracking-wider`}>
                    <span>{editingId ? `Run History (${evalRuns.length})` : `Recent Runs (${evalRuns.length})`}</span>
                    <Ic n={showEvalHistory ? 'ChevronUp' : 'ChevronDown'} size={10} />
                  </button>
                  {showEvalHistory && evalRuns.length > 0 && (
                    <div className="px-3 pb-3 flex flex-col gap-2 max-h-56 overflow-y-auto">
                      {evalRuns.map((run) => (
                        <div key={run.id} className={`${m.codeBlock} border ${m.border} rounded-lg p-2.5 text-xs`}>
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <span className="font-semibold text-violet-400 truncate">{run.variantLabel || run.promptTitle}</span>
                            <span className={m.textMuted}>{new Date(run.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                          </div>
                          <div className={`flex flex-wrap gap-2 mb-1 ${m.textMuted}`}>
                            <span className="uppercase">{run.mode}</span>
                            <span>{run.provider}</span>
                            <span>{run.model}</span>
                            <span>{run.latencyMs}ms</span>
                            {run.goldenScore != null && (
                              <span className={`font-semibold ${run.goldenScore >= goldenThreshold ? 'text-emerald-400' : 'text-red-400'}`}>
                                golden {Math.round(run.goldenScore * 100)}%
                              </span>
                            )}
                          </div>
                          <p className={`${m.textBody} leading-relaxed whitespace-pre-wrap`}>{(run.output || '').slice(0, 220)}{run.output && run.output.length > 220 ? '…' : ''}</p>
                          {run.output && (
                            <div className="mt-1 flex flex-wrap gap-3">
                              <button onClick={() => copy(run.output, 'Run output copied')}
                                className={`flex items-center gap-1 text-xs px-2 py-1 rounded-md font-semibold transition-colors ${copyBtn}`}>
                                <Ic n="Copy" size={10} />Copy output
                              </button>
                              {editingId && (
                                <button
                                  onClick={() => lib.pinGoldenResponse(editingId, {
                                    text: run.output,
                                    runId: run.id,
                                    provider: run.provider,
                                    model: run.model,
                                  })}
                                  className="flex items-center gap-1 text-emerald-400 hover:text-emerald-300 transition-colors font-semibold"
                                >
                                  <Ic n="Save" size={10} />Pin as Golden
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {showEvalHistory && evalRuns.length === 0 && (
                    <div className={`ui-empty-state px-3 pb-3 text-xs ${m.textMuted}`}>No saved runs yet.</div>
                  )}
                </div>
                {editingId && goldenResponse && (
                  <div className={`${m.surface} border ${m.border} rounded-lg`}>
                    <button
                      type="button"
                      onClick={() => setShowGoldenComparison((p) => !p)}
                      className={`w-full flex justify-between items-center px-3 py-2 text-xs font-semibold ${m.textSub} uppercase tracking-wider`}
                    >
                      <span>Golden Benchmark</span>
                      <Ic n={showGoldenComparison ? 'ChevronUp' : 'ChevronDown'} size={10} />
                    </button>
                    {showGoldenComparison && (
                      <div className="px-3 pb-3 flex flex-col gap-3">
                        <div className={`${m.codeBlock} border ${m.border} rounded-lg p-3`}>
                          <div className="flex items-start justify-between gap-3 mb-2">
                            <div>
                              <p className="text-xs font-semibold text-emerald-400 uppercase tracking-wider">Pinned Golden</p>
                              <p className={`text-xs ${m.textMuted} mt-1`}>
                                {goldenResponse.provider || 'Unknown provider'}
                                {goldenResponse.model ? ` · ${goldenResponse.model}` : ''}
                                {goldenResponse.pinnedAt ? ` · ${new Date(goldenResponse.pinnedAt).toLocaleString()}` : ''}
                              </p>
                            </div>
                            <button
                              onClick={() => lib.clearGoldenResponse(editingId)}
                              className="flex items-center gap-1 text-xs text-red-400 hover:text-red-300 transition-colors font-semibold"
                            >
                              <Ic n="Trash2" size={10} />Clear Golden
                            </button>
                          </div>
                          <div className="flex items-center justify-between gap-3 mb-1">
                            <span className={`text-xs ${m.textSub}`}>Similarity vs {comparisonSourceLabel.toLowerCase()}</span>
                            <span className={`text-xs font-semibold ${goldenVerdict === 'fail' ? 'text-red-400' : 'text-emerald-400'}`}>
                              {Math.round(goldenSimilarity * 100)}%
                              {goldenVerdict && <span className="ml-1">({goldenVerdict})</span>}
                            </span>
                          </div>
                          <div className={`relative w-full h-2 rounded-full overflow-hidden ${m.input} border ${m.border}`}>
                            <div className={`h-full transition-all ${goldenVerdict === 'fail' ? 'bg-red-500' : 'bg-emerald-500'}`} style={{ width: `${Math.max(0, Math.min(100, goldenSimilarity * 100))}%` }} />
                            <div className="absolute top-0 bottom-0 w-px bg-white/50" style={{ left: `${goldenThreshold * 100}%` }} title={`Threshold: ${Math.round(goldenThreshold * 100)}%`} />
                          </div>
                          <div className="flex items-center justify-between gap-2 mt-2">
                            <label className={`text-xs ${m.textMuted}`}>Pass threshold</label>
                            <div className="flex items-center gap-2">
                              <input
                                type="range" min="0" max="100" step="5"
                                value={Math.round(goldenThreshold * 100)}
                                onChange={(e) => lib.setGoldenThreshold(editingId, Number(e.target.value) / 100)}
                                className="w-20 h-1 accent-emerald-500"
                              />
                              <span className={`text-xs font-mono ${m.textSub} w-8 text-right`}>{Math.round(goldenThreshold * 100)}%</span>
                            </div>
                          </div>
                        </div>
                        {comparisonText ? (
                          <div>
                            <p className={`text-xs ${m.textSub} font-semibold mb-1 uppercase tracking-wider`}>
                              Word Diff: Golden vs {comparisonSourceLabel}
                            </p>
                            <div className={`${m.codeBlock} border ${m.border} rounded-lg p-3 text-sm leading-loose`}>
                              {wordDiff(goldenResponse.text, comparisonText).map((d, i) => (
                                <span key={i} className={`${d.t === 'add' ? m.diffAdd : d.t === 'del' ? m.diffDel : m.diffEq} px-0.5 rounded mr-0.5`}>
                                  {d.v}
                                </span>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <p className={`text-xs ${m.textMuted}`}>No enhanced output or eval run output is available to compare yet.</p>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </>}
              {/* Quick Inject */}
              {lib.quickInject.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 mb-2"><Ic n="Zap" size={10} className="text-yellow-500" /><span className={`text-xs ${m.textSub} uppercase tracking-widest font-semibold`}>Frequently Used</span></div>
                  {lib.quickInject.map(e => (
                    <div key={e.id} className={`flex items-center justify-between ${m.surface} border ${m.border} ${m.borderHov} rounded-lg px-3 py-2 gap-2 mb-1 transition-colors`}>
                      <span className={`text-xs ${m.textBody} truncate flex-1`}>{e.title}</span>
                      <div className="flex gap-2 shrink-0">
                        <button onClick={() => { copy(e.enhanced, `Copied: ${e.title}`); lib.bumpUse(e.id); }} className={`${m.textSub} hover:text-violet-400 transition-colors`}><Ic n="Copy" size={11} /></button>
                        <button onClick={() => loadEntry(e)} className="text-xs text-violet-400 hover:text-violet-300 font-semibold transition-colors">Load</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              </div>
            </div>
            {/* Save panel — pinned outside scroll container */}
            {showSave && (
              <div className={`shrink-0 ${m.surface} border-t ${m.border} p-3 flex flex-col gap-2`}>
                <span className={`text-xs ${m.textAlt} font-semibold uppercase tracking-wider`}>{editingId ? 'Update Prompt' : 'Save to Library'}</span>
                <input autoFocus className={`${m.input} border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-violet-500 ${m.text}`}
                  placeholder="Prompt title…" value={saveTitle} onChange={e => setSaveTitle(e.target.value)} />
                <div className="flex gap-2">
                  <select value={saveCollection} onChange={e => setSaveCollection(e.target.value)}
                    className={`flex-1 ${m.input} border rounded-lg px-2 py-1.5 text-xs ${m.text} focus:outline-none`}>
                    <option value="">No Collection</option>
                    {lib.collections.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                  {showNewColl ? (
                    <div className="flex gap-1">
                      <input autoFocus className={`w-28 ${m.input} border rounded-lg px-2 py-1.5 text-xs ${m.text} focus:outline-none focus:border-violet-500`}
                        placeholder="Name…" value={newCollName} onChange={e => setNewCollName(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') { const n = newCollName.trim(); if (n && !lib.collections.includes(n)) { lib.setCollections(p => [...p, n]); setSaveCollection(n); } setNewCollName(''); setShowNewColl(false); }
                          if (e.key === 'Escape') setShowNewColl(false);
                        }} />
                      <button onClick={() => { const n = newCollName.trim(); if (n && !lib.collections.includes(n)) { lib.setCollections(p => [...p, n]); setSaveCollection(n); } setNewCollName(''); setShowNewColl(false); }}
                        className="px-2 py-1.5 bg-violet-600 hover:bg-violet-500 text-white rounded-lg text-xs transition-colors"><Ic n="Check" size={11} /></button>
                    </div>
                  ) : (
                    <button onClick={() => setShowNewColl(true)} className={`px-2.5 ${m.btn} rounded-lg ${m.textAlt} text-xs transition-colors flex items-center gap-1`}><Ic n="Plus" size={11} /></button>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {ALL_TAGS.map(t => <TagChip key={t} tag={t} selected={saveTags.includes(t)} onClick={() => setSaveTags(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t])} />)}
                </div>
                {editingId && (
                  <input className={`${m.input} border rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-blue-500 ${m.text}`}
                    placeholder="What changed? (optional)" value={changeNote} onChange={e => setChangeNote(e.target.value)} />
                )}
                <div className="flex gap-2 pt-1">
                  <button onClick={() => doSave()} disabled={!hasSavablePrompt} className="flex-1 flex items-center justify-center gap-1.5 bg-green-600 hover:bg-green-500 disabled:opacity-40 text-white rounded-lg py-1.5 text-sm font-semibold transition-colors"><Ic n="Save" size={12} />Save ⌘S</button>
                  <button onClick={() => { setShowSave(false); setEditingId(null); }} className={`px-4 ${m.btn} rounded-lg text-sm ${m.textBody} transition-colors`}>Cancel</button>
                </div>
              </div>
            )}
            </div>
          )}
          libraryPane={(
            <LibraryPanel
              m={m} lib={lib} compact={compact} isWeb={isWeb}
              showEditorPane={showEditorPane}
              effectiveEditorLayout={effectiveEditorLayout} setEditorLayout={setEditorLayout}
              editingId={editingId} setSaveTitle={setSaveTitle}
              testCasesByPrompt={testCasesByPrompt} evalRuns={evalRuns}
              editingCaseId={editingCaseId} caseFormPromptId={caseFormPromptId}
              caseTitle={caseTitle} setCaseTitle={setCaseTitle}
              caseInput={caseInput} setCaseInput={setCaseInput}
              caseTraits={caseTraits} setCaseTraits={setCaseTraits}
              caseExclusions={caseExclusions} setCaseExclusions={setCaseExclusions}
              caseNotes={caseNotes} setCaseNotes={setCaseNotes}
              openCaseForm={openCaseForm} resetCaseForm={resetCaseForm}
              saveCaseForPrompt={saveCaseForPrompt}
              loadCaseIntoEditor={loadCaseIntoEditor}
              runSingleCase={runSingleCase} removeCase={removeCase}
              loadEntry={loadEntry} addToComposer={addToComposer}
              openSavePanel={openSavePanel} copy={copy}
            />
          )}
        />
      )}

      {/* ══ COMPOSER TAB ══ */}
      {tab === 'composer' && (
        <ComposerTab m={m} library={lib.library} composerBlocks={composerBlocks} setComposerBlocks={setComposerBlocks}
          addToComposer={addToComposer} notify={notify} copy={copy} setRaw={setRaw} setTab={setTab} compact={compact} pageScroll={isWeb} />
      )}

      {/* ══ A/B TEST TAB ══ */}
      {tab === 'abtest' && <ABTestTab m={m} copy={copy} notify={notify} compact={compact} pageScroll={isWeb} />}

      {/* ══ PAD TAB ══ */}
      {tab === 'pad' && <PadTab m={m} notify={notify} pageScroll={isWeb} onPromoteToLibrary={(title, content) => {
        setRaw(content);
        setEnhanced(content);
        setSaveTitle(title);
        setShowSave(true);
        setTab('editor');
        notify('Loaded into editor — save to library when ready.');
      }} />}

      {/* ══ HISTORY TAB ══ */}
      {tab === 'history' && <RunTimelinePanel m={m} prompt={currentEntry} copy={copy} compact={compact} pageScroll={isWeb} />}
      </main>

      {/* ══ MODALS ══ */}
      {showVarForm && pendingTemplate && (
        <div className={`fixed inset-0 ${m.modalBg} flex items-center justify-center z-40 p-4`}>
          <div className={`${m.modal} border rounded-xl p-5 w-full max-w-md flex flex-col gap-4`} role="dialog" aria-modal="true" aria-labelledby="modal-vars">
            <div className="flex justify-between items-center">
              <h2 id="modal-vars" className={`font-bold text-sm ${m.text}`}>Fill Template Variables</h2>
              <button type="button" onClick={() => setShowVarForm(false)} className={`${m.textSub} hover:text-white`}><Ic n="X" size={15} /></button>
            </div>
            <p className={`text-xs ${m.textAlt}`}>"{pendingTemplate.title}" contains template variables:</p>
            <div className="flex flex-col gap-2">
              {Object.keys(varVals).map(k => (
                <div key={k}>
                  <label className="text-xs font-mono font-semibold text-violet-400 block mb-1">
                    {`{{${k}}}`}
                    {isGhostVar(k) && (
                      <span className="ml-2 inline-flex items-center rounded-full border border-emerald-500/30 bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-sans font-semibold uppercase tracking-wide text-emerald-300">
                        auto
                      </span>
                    )}
                  </label>
                  <input className={`w-full ${m.input} border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-violet-500 ${m.text}`}
                    placeholder={isGhostVar(k) ? 'Auto-filled · editable' : `Value for ${k}…`}
                    value={varVals[k]} onChange={e => setVarVals(p => ({ ...p, [k]: e.target.value }))} />
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <button onClick={applyTemplate} className="flex-1 bg-violet-600 hover:bg-violet-500 text-white rounded-lg py-2 text-sm font-semibold transition-colors">Apply Template</button>
              <button onClick={loadTemplateWithoutVars} className={`px-4 ${m.btn} rounded-lg text-sm ${m.textBody} transition-colors`}>Skip</button>
            </div>
          </div>
        </div>
      )}

      {showSettings && (
        <div className={`fixed inset-0 ${m.modalBg} flex items-center justify-center z-40 p-4`}>
          <div className={`${m.modal} border rounded-xl p-5 w-full max-w-sm flex flex-col gap-4`} role="dialog" aria-modal="true" aria-labelledby="modal-settings">
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
            {lib.collections.length > 0 && (
              <div>
                <p className={`text-xs font-semibold ${m.textSub} uppercase tracking-wider mb-2`}>Collections</p>
                <div className="flex flex-col gap-1 max-h-36 overflow-y-auto">
                  {lib.collections.map(c => (
                    <div key={c} className="flex items-center justify-between">
                      <span className={`text-xs ${m.textAlt} flex items-center gap-1`}><Ic n="FolderOpen" size={9} />{c}</span>
                      <button onClick={() => lib.setCollections(p => p.filter(x => x !== c))} className={`text-xs ${m.textMuted} hover:text-red-400 transition-colors`}><Ic n="Trash2" size={11} /></button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <button onClick={openOptions} className={`flex items-center gap-2 text-sm ${m.btn} rounded-lg px-3 py-2 text-violet-400 font-semibold transition-colors`}>
              🔑 Manage API Key (Options)
            </button>
            <div className={`border-t ${m.border} pt-3 flex flex-col gap-2`}>
              <button onClick={lib.exportLib} className={`flex items-center gap-2 text-sm ${m.btn} rounded-lg px-3 py-2 ${m.textBody} transition-colors`}><Ic n="Download" size={12} />Export Library</button>
              <label className={`flex items-center gap-2 text-sm ${m.btn} rounded-lg px-3 py-2 ${m.textBody} cursor-pointer transition-colors`}><Ic n="Upload" size={12} />Import Library<input type="file" accept=".json" onChange={lib.importLib} className="hidden" /></label>
              <button onClick={() => { if (window.confirm('Clear all prompts from the library?')) { lib.setLibrary([]); notify('Library cleared.'); } }} className="flex items-center gap-2 text-sm bg-red-600 hover:bg-red-500 text-white rounded-lg px-3 py-2 transition-colors"><Ic n="Trash2" size={12} />Clear All Prompts</button>
            </div>
          </div>
        </div>
      )}

      {showCmdPalette && (
        <div className={`fixed inset-0 ${m.modalBg} flex items-start justify-center z-50 pt-20 p-4`} onClick={() => setShowCmdPalette(false)}>
          <div className={`${m.modal} border rounded-xl w-full max-w-md overflow-hidden shadow-2xl`} onClick={e => e.stopPropagation()}>
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
          <div className={`${m.modal} border rounded-xl p-5 w-full max-w-sm`} role="dialog" aria-modal="true" aria-labelledby="modal-shortcuts" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4">
              <h2 id="modal-shortcuts" className={`font-bold text-sm ${m.text}`}>Keyboard Shortcuts</h2>
              <button type="button" onClick={() => setShowShortcuts(false)} className={m.textSub}><Ic n="X" size={14} /></button>
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

      <VersionDiffModal
        entry={versionHistoryEntry}
        selectedIndex={lib.diffVersionIdx}
        onSelectIndex={lib.setDiffVersionIdx}
        onClose={lib.closeVersionHistory}
        onRestore={(version) => lib.restoreVersion(versionHistoryEntry?.id, version)}
        m={m}
      />

      {/* ══ PII WARNING MODAL ══ */}
      {piiWarning && (
        <div className={`fixed inset-0 ${m.modalBg} flex items-center justify-center z-50 p-4`}>
          <div className={`${m.modal} border rounded-xl p-5 w-full max-w-md flex flex-col gap-4`} role="dialog" aria-modal="true" aria-labelledby="modal-pii">
            <div className="flex justify-between items-center">
              <h2 id="modal-pii" className={`font-bold text-sm ${m.text}`}>Sensitive Data Detected</h2>
              <button type="button" onClick={piiCancel} className={`${m.textSub} hover:text-white`}><Ic n="X" size={15} /></button>
            </div>
            <p className={`text-xs ${m.textAlt}`}>The following potentially sensitive items were found in your prompt:</p>
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
          show={showDesktopSettings}
          onClose={() => setShowDesktopSettings(false)}
          m={m}
          notify={notify}
        />
      )}
      </div>
    </ThemeProvider>
  );
}
