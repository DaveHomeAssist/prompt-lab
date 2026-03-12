import { useState, useEffect, useRef } from 'react';
import Ic from './icons';
import { callModel } from './api';
import {
  wordDiff, scorePrompt, extractVars, decodeShare,
  extractTextFromAnthropic, parseEnhancedPayload,
  ensureString, suggestTitleFromText, normalizeEntry,
  looksSensitive, isTransientError,
} from './promptUtils';
import { ALL_TAGS, MODES, T } from './constants';
import usePersistedState from './usePersistedState';
import useLibrary from './useLibrary';
import Toast from './Toast';
import TagChip from './TagChip';
import PadTab from './PadTab';
import ComposerTab from './ComposerTab';
import ABTestTab from './ABTestTab';

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [colorMode, setColorMode] = usePersistedState('pl2-mode', 'dark', {
    validate: v => (v === 'dark' || v === 'light') ? v : 'dark',
  });
  const m = T[colorMode];

  const [tab, setTab] = useState('editor');
  const [toast, setToast] = useState(null);
  const notify = msg => setToast(msg);

  // ── Library hook ──
  const lib = useLibrary(notify);

  // ── Editor state ──
  const [raw, setRaw] = useState('');
  const [enhanced, setEnhanced] = useState('');
  const [variants, setVariants] = useState([]);
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showSave, setShowSave] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [saveTitle, setSaveTitle] = useState('');
  const [saveTags, setSaveTags] = useState([]);
  const [saveCollection, setSaveCollection] = useState('');
  const [showDiff, setShowDiff] = useState(false);
  const [enhMode, setEnhMode] = useState('balanced');
  const [showNotes, setShowNotes] = useState(true);
  const [showNewColl, setShowNewColl] = useState(false);
  const [newCollName, setNewCollName] = useState('');
  const [varVals, setVarVals] = useState({});
  const [showVarForm, setShowVarForm] = useState(false);
  const [pendingTemplate, setPendingTemplate] = useState(null);
  const [editorLayout, setEditorLayout] = useState('split');
  const enhanceReqRef = useRef(0);

  // ── Composer state ──
  const [composerBlocks, setComposerBlocks] = useState([]);

  // ── Modal state ──
  const [showSettings, setShowSettings] = useState(false);
  const [showCmdPalette, setShowCmdPalette] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [cmdQuery, setCmdQuery] = useState('');

  const hasSavablePrompt = raw.trim() || enhanced.trim();

  // ── Share URL init ──
  useEffect(() => {
    const hash = window.location.hash;
    if (hash.startsWith('#share=')) {
      const d = decodeShare(hash.slice(7));
      if (d) {
        const normalized = normalizeEntry({ ...d, id: crypto.randomUUID() });
        if (normalized) {
          setRaw(normalized.original);
          setEnhanced(normalized.enhanced);
          setVariants(normalized.variants || []);
          setNotes(normalized.notes || '');
          setSaveTags(normalized.tags || []);
          setSaveTitle(normalized.title || '');
          setShowSave(true);
          notify('Shared prompt loaded!');
        } else {
          notify('Shared prompt is invalid.');
        }
      }
    }
  }, []);

  // ── Clipboard ──
  const copy = async (text, msg = 'Copied!') => {
    const value = ensureString(text);
    if (!value) { notify('Nothing to copy'); return; }
    try { await navigator.clipboard.writeText(value); }
    catch {
      try {
        const el = document.createElement('textarea'); el.value = value;
        el.style.cssText = 'position:fixed;top:-9999px;opacity:0';
        document.body.appendChild(el); el.focus(); el.select();
        document.execCommand('copy'); document.body.removeChild(el);
      } catch { notify('Copy unavailable'); return; }
    }
    notify(msg);
  };

  // ── API with retry ──
  const callWithRetry = async (payload, retries = 1) => {
    let attempt = 0;
    let lastError = null;
    while (attempt <= retries) {
      try { return await callModel(payload); }
      catch (e) {
        lastError = e;
        if (attempt >= retries || !isTransientError(e)) break;
        await new Promise(r => setTimeout(r, 350 * (attempt + 1)));
      }
      attempt += 1;
    }
    throw lastError || new Error('Request failed.');
  };

  // ── Editor actions ──
  const openSavePanel = (entry = null) => {
    const source = entry?.enhanced || enhanced || raw;
    setSaveTitle(entry?.title || suggestTitleFromText(source));
    if (entry) {
      setEditingId(entry.id);
      setSaveTags(entry.tags || []);
      setSaveCollection(entry.collection || '');
    } else {
      setEditingId(null);
      if (!enhanced.trim()) setSaveTags([]);
    }
    setShowSave(true);
  };

  const clearEditor = () => {
    enhanceReqRef.current += 1;
    setLoading(false); setRaw(''); setEnhanced(''); setVariants([]);
    setNotes(''); setShowSave(false); setEditingId(null); setError('');
  };

  const openOptions = () => {
    if (typeof chrome !== 'undefined' && chrome.runtime?.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    } else {
      notify('Options page is only available in the extension.');
    }
  };

  const enhance = async () => {
    if (!raw.trim()) return;
    const reqId = enhanceReqRef.current + 1;
    enhanceReqRef.current = reqId;
    setLoading(true); setError(''); setEnhanced(''); setVariants([]); setNotes('');
    setShowSave(false); setShowDiff(false); setEditingId(null);
    const modeObj = MODES.find(x => x.id === enhMode) || MODES[0];
    const sys = `You are an expert prompt engineer. ${modeObj.sys}\nReturn ONLY valid JSON, no markdown, no backticks:\n{"enhanced":"...","variants":[{"label":"...","content":"..."}],"notes":"...","tags":["..."]}\nProduce 2 variants. Available tags: ${ALL_TAGS.join(', ')}.`;
    try {
      const data = await callWithRetry({
        model: 'claude-sonnet-4-20250514', max_tokens: 1500,
        system: sys, messages: [{ role: 'user', content: raw }],
      });
      if (reqId !== enhanceReqRef.current) return;
      const txt = extractTextFromAnthropic(data);
      const p = parseEnhancedPayload(txt);
      setEnhanced(p.enhanced || ''); setVariants(p.variants || []); setNotes(p.notes || '');
      setSaveTags(p.tags || []);
      setSaveTitle(suggestTitleFromText(p.enhanced || raw));
      setShowSave(true);
    } catch (e) {
      if (reqId === enhanceReqRef.current) setError(e.message || 'Enhancement failed.');
    }
    if (reqId === enhanceReqRef.current) setLoading(false);
  };

  const doSave = () => {
    lib.doSave({ raw, enhanced, variants, notes, tags: saveTags, title: saveTitle, collection: saveCollection, editingId });
    setShowSave(false); setEditingId(null);
  };

  const loadEntry = entry => {
    const vars = extractVars(entry?.enhanced);
    if (vars.length > 0) { setPendingTemplate(entry); setVarVals(Object.fromEntries(vars.map(v => [v, '']))); setShowVarForm(true); }
    else applyEntry(entry);
  };

  const applyEntry = entry => {
    const normalized = normalizeEntry(entry);
    if (!normalized) return;
    setEditingId(normalized.id); setRaw(normalized.original); setEnhanced(normalized.enhanced);
    setVariants(normalized.variants || []); setNotes(normalized.notes || '');
    setSaveTags(normalized.tags || []); setSaveTitle(normalized.title);
    setSaveCollection(normalized.collection || ''); setShowSave(false); setShowDiff(false);
    lib.bumpUse(normalized.id); setTab('editor'); notify('Loaded into editor!');
  };

  const applyTemplate = () => {
    if (!pendingTemplate) return;
    let text = ensureString(pendingTemplate.enhanced);
    Object.entries(varVals).forEach(([k, v]) => { text = text.replaceAll(`{{${k}}}`, v); });
    applyEntry({ ...pendingTemplate, enhanced: text });
    setShowVarForm(false); setPendingTemplate(null);
  };

  const addToComposer = entry => {
    setComposerBlocks(prev => [...prev, { id: crypto.randomUUID(), label: entry.title, content: entry.enhanced, sourceId: entry.id }]);
    lib.bumpUse(entry.id); notify('Added to Composer!');
  };

  // ── Derived ──
  const score = scorePrompt(raw);
  const wc = typeof raw === 'string' && raw.trim() ? raw.trim().split(/\s+/).length : 0;
  const inp = `w-full ${m.input} border rounded-lg p-3 text-sm resize-none focus:outline-none focus:border-violet-500 transition-colors placeholder-gray-400 ${m.text}`;
  const showEditorPane = tab !== 'editor' || editorLayout !== 'library';
  const showLibraryPane = tab !== 'editor' || editorLayout !== 'editor';

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
      if (e.key === 'Escape') { setShowCmdPalette(false); setShowShortcuts(false); setShowSettings(false); lib.setShareId(null); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [loading, raw, showSave, hasSavablePrompt]);

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
    <div className={`min-h-screen ${m.bg} ${m.text} flex flex-col`} style={{ fontFamily: 'system-ui,sans-serif' }}>

      {/* Header */}
      <header className={`flex items-center justify-between px-4 py-2 ${m.header} border-b shrink-0`}>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <Ic n="Wand2" size={15} className="text-violet-500" />
            <span className="font-bold text-sm">Prompt Lab</span>
          </div>
          <div className="flex items-center gap-1">
            {[['editor', 'Editor'], ['composer', 'Composer'], ['abtest', 'A/B Test'], ['pad', 'Pad']].map(([id, label]) => (
              <button key={id} onClick={() => setTab(id)}
                className={`px-2 py-1.5 font-semibold rounded-lg transition-colors whitespace-nowrap ${tab === id ? 'bg-violet-600 text-white' : `${m.btn} ${m.textAlt}`}`}
                style={{ fontSize: '0.6rem', letterSpacing: '0.03em' }}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <span className={`text-xs ${m.textMuted} mr-1 hidden sm:inline`}>{lib.library.length} saved</span>
          <button onClick={() => { setShowCmdPalette(true); setCmdQuery(''); }} className={`px-1.5 py-1 rounded-lg ${m.btn} ${m.textAlt} text-xs font-mono hover:text-violet-400 transition-colors`}>⌘K</button>
          <button onClick={() => setColorMode(p => p === 'dark' ? 'light' : 'dark')} className={`p-1 rounded-lg ${m.btn} ${m.textAlt} hover:text-violet-400 transition-colors`}>
            {colorMode === 'dark' ? <Ic n="Sun" size={13} /> : <Ic n="Moon" size={13} />}
          </button>
          <button onClick={() => setShowShortcuts(true)} className={`p-1 rounded-lg ${m.btn} ${m.textAlt} hover:text-violet-400 transition-colors`}><Ic n="Keyboard" size={13} /></button>
          <button onClick={() => setShowSettings(true)} className={`p-1 rounded-lg ${m.btn} ${m.textAlt} hover:text-violet-400 transition-colors`}><Ic n="Settings" size={13} /></button>
        </div>
      </header>

      {/* ══ EDITOR TAB ══ */}
      {tab === 'editor' && (
        <div className="flex flex-1 overflow-hidden" style={{ height: 'calc(100vh - 44px)' }}>
          {showEditorPane && (
          <div className={`${showLibraryPane ? `w-1/2 border-r ${m.border}` : 'w-full'} flex flex-col overflow-y-auto`}>
            <div className="p-4 flex flex-col gap-3">
              <div className="flex gap-1">
                {[['split', 'Split'], ['editor', 'Focus Editor'], ['library', 'Focus Library']].map(([id, label]) => (
                  <button key={id} onClick={() => setEditorLayout(id)}
                    className={`text-xs px-2 py-1 rounded-lg transition-colors ${editorLayout === id ? 'bg-violet-600 text-white' : `${m.btn} ${m.textAlt}`}`}>
                    {label}
                  </button>
                ))}
              </div>
              {/* Input */}
              <div>
                <div className="flex justify-between items-center mb-1.5">
                  <span className={`text-xs ${m.textSub} uppercase tracking-widest font-semibold`}>Input</span>
                  <span className={`text-xs ${m.textMuted}`}>{wc}w · {raw.length}c{score ? ` · ~${score.tokens} tok` : ''}</span>
                </div>
                <textarea rows={5} className={inp} placeholder="Paste or write your prompt here…" value={raw} onChange={e => setRaw(e.target.value)} />
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
              {/* Mode + Enhance */}
              <div className="flex gap-2">
                <select value={enhMode} onChange={e => setEnhMode(e.target.value)}
                  className={`${m.input} border rounded-lg px-2 py-1.5 text-xs ${m.text} focus:outline-none shrink-0 max-w-36`}>
                  {MODES.map(md => <option key={md.id} value={md.id}>{md.label}</option>)}
                </select>
                <button onClick={enhance} disabled={loading || !raw.trim()}
                  className="flex-1 flex items-center justify-center gap-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white rounded-lg py-2 text-sm font-semibold transition-colors">
                  {loading ? <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />Enhancing…</> : <><Ic n="Wand2" size={13} />Enhance ⌘↵</>}
                </button>
                <button onClick={() => openSavePanel()} disabled={!hasSavablePrompt}
                  className="px-2.5 bg-green-600 hover:bg-green-500 disabled:opacity-40 text-white rounded-lg text-xs font-semibold transition-colors">Save</button>
                <button onClick={clearEditor} disabled={loading}
                  className="px-2.5 bg-red-600 hover:bg-red-500 disabled:opacity-40 text-white rounded-lg text-xs font-semibold transition-colors">Clear</button>
              </div>
              {error && <div className="text-red-400 text-xs bg-red-950/40 border border-red-900 rounded-lg p-2.5">{error}</div>}
              {/* Enhanced */}
              {enhanced && <>
                <div>
                  <div className="flex justify-between items-center mb-1.5">
                    <span className="text-xs text-violet-400 uppercase tracking-widest font-semibold">Enhanced</span>
                    <div className="flex items-center gap-3">
                      <button onClick={() => setShowDiff(p => !p)} className={`flex items-center gap-1 text-xs transition-colors ${showDiff ? 'text-violet-400' : `${m.textSub} hover:text-white`}`}>
                        <Ic n="GitBranch" size={10} />{showDiff ? 'Hide Diff' : 'Show Diff'}
                      </button>
                      <button onClick={() => copy(enhanced)} className={`flex items-center gap-1 text-xs ${m.textSub} hover:text-white transition-colors`}><Ic n="Copy" size={10} />Copy</button>
                    </div>
                  </div>
                  {showDiff ? (
                    <div className={`${m.codeBlock} border ${m.border} rounded-lg p-3 text-sm leading-loose`}>
                      {wordDiff(raw, enhanced).map((d, i) => (
                        <span key={i} className={`${d.t === 'add' ? m.diffAdd : d.t === 'del' ? m.diffDel : m.diffEq} px-0.5 rounded mr-0.5`}>{d.v}</span>
                      ))}
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
              </>}
              {/* Save panel */}
              {showSave && (
                <div className={`${m.surface} border ${m.border} rounded-lg p-3 flex flex-col gap-2`}>
                  <span className={`text-xs ${m.textAlt} font-semibold uppercase tracking-wider`}>{editingId ? 'Update Prompt' : 'Save to Library'}</span>
                  <input className={`${m.input} border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-violet-500 ${m.text}`}
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
                  <div className="flex gap-2 pt-1">
                    <button onClick={() => doSave()} disabled={!hasSavablePrompt} className="flex-1 flex items-center justify-center gap-1.5 bg-green-600 hover:bg-green-500 disabled:opacity-40 text-white rounded-lg py-1.5 text-sm font-semibold transition-colors"><Ic n="Save" size={12} />Save ⌘S</button>
                    <button onClick={() => { setShowSave(false); setEditingId(null); }} className={`px-4 ${m.btn} rounded-lg text-sm ${m.textBody} transition-colors`}>Cancel</button>
                  </div>
                </div>
              )}
              {/* Quick Inject */}
              {lib.quickInject.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 mb-2"><Ic n="Zap" size={10} className="text-yellow-500" /><span className={`text-xs ${m.textSub} uppercase tracking-widest font-semibold`}>Quick Inject</span></div>
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
          )}

          {/* Right — Library */}
          {showLibraryPane && (
          <div className={`${showEditorPane ? 'w-1/2' : 'w-full'} flex flex-col overflow-hidden`}>
            <div className={`p-3 border-b ${m.border} flex flex-col gap-2 shrink-0`}>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Ic n="Search" size={11} className={`absolute left-2.5 top-1/2 -translate-y-1/2 ${m.textMuted}`} />
                  <input className={`w-full ${m.input} border rounded-lg pl-7 pr-3 py-1.5 text-xs focus:outline-none focus:border-violet-500 ${m.text}`}
                    placeholder="Search…" value={lib.search} onChange={e => lib.setSearch(e.target.value)} />
                </div>
                <select value={lib.sortBy} onChange={e => lib.setSortBy(e.target.value)}
                  className={`${m.input} border rounded-lg px-2 py-1.5 text-xs ${m.textBody} focus:outline-none`}>
                  <option value="newest">Newest</option><option value="oldest">Oldest</option><option value="most-used">Most Used</option><option value="manual">Manual</option>
                </select>
                <button onClick={lib.exportLib} className={`px-2.5 rounded-lg text-xs ${m.btn} ${m.textAlt} transition-colors`}>Export</button>
              </div>
              {lib.collections.length > 0 && (
                <div className="flex gap-1 flex-wrap">
                  <button onClick={() => lib.setActiveCollection(null)} className={`px-2 py-0.5 rounded-full text-xs font-medium transition-colors ${!lib.activeCollection ? 'bg-violet-600 text-white' : `${m.btn} ${m.textAlt}`}`}>All</button>
                  {lib.collections.map(c => (
                    <button key={c} onClick={() => lib.setActiveCollection(p => p === c ? null : c)}
                      className={`px-2 py-0.5 rounded-full text-xs font-medium transition-colors flex items-center gap-1 ${lib.activeCollection === c ? 'bg-violet-600 text-white' : `${m.btn} ${m.textAlt}`}`}>
                      <Ic n="FolderOpen" size={9} />{c}
                    </button>
                  ))}
                </div>
              )}
              {lib.allLibTags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {lib.allLibTags.map(t => <TagChip key={t} tag={t} selected={lib.activeTag === t} onClick={() => lib.setActiveTag(p => p === t ? null : t)} />)}
                </div>
              )}
            </div>
            <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
              {lib.filtered.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full gap-2 text-center">
                  <Ic n="Wand2" size={24} className={m.textMuted} />
                  <p className={`text-sm ${m.textSub}`}>{lib.library.length === 0 ? 'No saved prompts yet.' : 'No results found.'}</p>
                </div>
              )}
              {lib.filtered.map(entry => {
                const manual = lib.sortBy === 'manual';
                const shareUrl = lib.shareId === entry.id ? lib.getShareUrl(entry) : null;
                return (
                  <div key={entry.id}
                    draggable={manual}
                    onDragStart={e => { if (!manual) return; e.dataTransfer.setData('libraryEntryId', entry.id); lib.setDraggingLibraryId(entry.id); }}
                    onDragEnd={() => { lib.setDraggingLibraryId(null); lib.setDragOverLibraryId(null); }}
                    onDragOver={e => { if (!manual) return; e.preventDefault(); lib.setDragOverLibraryId(entry.id); }}
                    onDrop={e => { if (!manual) return; e.preventDefault(); lib.moveLibraryEntry(e.dataTransfer.getData('libraryEntryId'), entry.id); lib.setDragOverLibraryId(null); }}
                    className={`${m.surface} border ${m.border} ${m.borderHov} rounded-lg overflow-hidden transition-colors ${manual ? 'cursor-grab active:cursor-grabbing' : ''} ${lib.dragOverLibraryId === entry.id ? 'border-violet-500' : ''} ${lib.draggingLibraryId === entry.id ? 'opacity-50' : ''}`}>
                    <div className="flex items-start justify-between px-3 py-2.5 gap-2">
                      <div className="flex-1 min-w-0">
                        {lib.renamingId === entry.id ? (
                          <div className="flex gap-1.5">
                            <input autoFocus value={lib.renameValue} onChange={e => lib.setRenameValue(e.target.value)}
                              className={`flex-1 ${m.input} border rounded-lg px-2 py-1 text-xs focus:outline-none focus:border-violet-500 ${m.text}`} />
                            <button onClick={() => lib.renameEntry(entry.id, lib.renameValue, editingId, setSaveTitle)} className="px-2 py-1 text-xs bg-violet-600 hover:bg-violet-500 text-white rounded-lg transition-colors">Save</button>
                            <button onClick={() => { lib.setRenamingId(null); lib.setRenameValue(''); }} className={`px-2 py-1 text-xs ${m.btn} ${m.textAlt} rounded-lg transition-colors`}>Cancel</button>
                          </div>
                        ) : (
                          <p className={`text-sm font-semibold ${m.text} truncate`}>{entry.title}</p>
                        )}
                        <div className={`flex items-center gap-2 text-xs ${m.textMuted} mt-0.5 flex-wrap`}>
                          {entry.collection && <span className="flex items-center gap-1"><Ic n="FolderOpen" size={8} />{entry.collection}</span>}
                          <span>{new Date(entry.createdAt).toLocaleDateString()}</span>
                          {entry.useCount > 0 && <span className="text-violet-400">{entry.useCount}×</span>}
                          {(entry.versions || []).length > 0 && <span className="flex items-center gap-0.5 text-blue-400"><Ic n="Clock" size={8} />{entry.versions.length}v</span>}
                          {extractVars(entry.enhanced).length > 0 && <span className="text-amber-400">{'{{vars}}'}</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-0.5 shrink-0">
                        {manual && <Ic n="GripVertical" size={12} className={m.textMuted} />}
                        <button onClick={() => { copy(entry.enhanced); lib.bumpUse(entry.id); }} className={`p-1.5 rounded ${m.btn} ${m.textSub} hover:text-violet-400 transition-colors`}><Ic n="Copy" size={12} /></button>
                        <button onClick={() => loadEntry(entry)} className={`px-2 py-1 rounded ${m.btn} text-violet-400 text-xs font-semibold transition-colors`}>Load</button>
                        <button onClick={() => addToComposer(entry)} className={`p-1.5 rounded ${m.btn} ${m.textSub} hover:text-violet-400 transition-colors`}><Ic n="Layers" size={12} /></button>
                        <button onClick={() => {
                          if ((looksSensitive(entry.original) || looksSensitive(entry.enhanced) || looksSensitive(entry.notes))
                            && !window.confirm('This shared link may include sensitive content. Continue?')) return;
                          lib.setShareId(p => p === entry.id ? null : entry.id);
                        }} className={`p-1.5 rounded ${m.btn} ${m.textSub} hover:text-violet-400 transition-colors`}><Ic n="Share2" size={12} /></button>
                        <button onClick={() => openSavePanel(entry)} className={`px-2 py-1 rounded ${m.btn} ${m.textAlt} text-xs transition-colors`}>Edit</button>
                        <button onClick={() => { lib.setRenamingId(entry.id); lib.setRenameValue(entry.title); }} className={`px-2 py-1 rounded ${m.btn} ${m.textAlt} text-xs transition-colors`}>Rename</button>
                        <button onClick={() => lib.setExpandedId(p => p === entry.id ? null : entry.id)} className={`p-1.5 rounded ${m.btn} ${m.textSub} transition-colors`}>
                          {lib.expandedId === entry.id ? <Ic n="ChevronUp" size={12} /> : <Ic n="ChevronDown" size={12} />}
                        </button>
                        <button onClick={() => lib.del(entry.id)} className="p-1.5 rounded bg-red-600 hover:bg-red-500 text-white transition-colors"><Ic n="Trash2" size={12} /></button>
                      </div>
                    </div>
                    {(entry.tags || []).length > 0 && <div className="flex flex-wrap gap-1 px-3 pb-2">{entry.tags.map(t => <TagChip key={t} tag={t} />)}</div>}
                    {lib.shareId === entry.id && (
                      <div className={`border-t ${m.border} px-3 py-2 flex gap-2`}>
                        <input readOnly className={`flex-1 ${m.input} border rounded-lg px-2 py-1 text-xs focus:outline-none ${m.text} font-mono`} value={shareUrl || 'Unable to create share URL'} />
                        <button onClick={() => copy(shareUrl || '')} className="px-2 py-1 bg-violet-600 hover:bg-violet-500 text-white rounded-lg text-xs font-medium transition-colors">Copy URL</button>
                      </div>
                    )}
                    {lib.expandedId === entry.id && (
                      <div className={`border-t ${m.border} px-3 py-3 flex flex-col gap-3`}>
                        {[['Original', m.textSub, entry.original], ['Enhanced', 'text-violet-400', entry.enhanced]].map(([lbl, col, txt]) => (
                          <div key={lbl}><p className={`text-xs ${col} font-semibold mb-1 uppercase tracking-wider`}>{lbl}</p><p className={`text-xs ${m.textBody} leading-relaxed ${m.codeBlock} rounded-lg p-2`}>{txt}</p></div>
                        ))}
                        {entry.notes && <div><p className={`text-xs ${m.notesText} font-semibold mb-1 uppercase tracking-wider`}>Notes</p><p className={`text-xs ${m.textAlt} leading-relaxed`}>{entry.notes}</p></div>}
                        {(entry.variants || []).length > 0 && (
                          <div><p className={`text-xs ${m.textSub} font-semibold mb-1.5 uppercase tracking-wider`}>Variants</p>
                            {entry.variants.map((v, i) => <div key={i} className="mb-1.5"><span className="text-xs text-violet-400 font-bold">{v.label}: </span><span className={`text-xs ${m.textAlt}`}>{v.content}</span></div>)}
                          </div>
                        )}
                        {(entry.versions || []).length > 0 && (
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <p className="text-xs text-blue-400 font-semibold uppercase tracking-wider flex items-center gap-1"><Ic n="Clock" size={9} />Version History ({entry.versions.length})</p>
                              <button onClick={() => lib.setExpandedVersionId(p => p === entry.id ? null : entry.id)} className={`text-xs ${m.textSub} hover:text-white transition-colors`}>
                                {lib.expandedVersionId === entry.id ? 'Collapse' : 'Expand'}
                              </button>
                            </div>
                            {lib.expandedVersionId === entry.id && (
                              <div className="flex flex-col gap-2 max-h-48 overflow-y-auto">
                                {[...entry.versions].reverse().map((v, i) => (
                                  <div key={i} className={`${m.codeBlock} border ${m.border} rounded-lg p-2`}>
                                    <div className="flex justify-between items-center mb-1">
                                      <span className={`text-xs ${m.textMuted}`}>{new Date(v.savedAt).toLocaleString()}</span>
                                      <button onClick={() => lib.restoreVersion(entry.id, v)}
                                        className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors"><Ic n="RotateCcw" size={9} />Restore</button>
                                    </div>
                                    <p className={`text-xs ${m.textAlt} line-clamp-2`}>{v.enhanced}</p>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          )}
        </div>
      )}

      {/* ══ COMPOSER TAB ══ */}
      {tab === 'composer' && (
        <ComposerTab m={m} library={lib.library} composerBlocks={composerBlocks} setComposerBlocks={setComposerBlocks}
          addToComposer={addToComposer} notify={notify} copy={copy} setRaw={setRaw} setTab={setTab} />
      )}

      {/* ══ A/B TEST TAB ══ */}
      {tab === 'abtest' && <ABTestTab m={m} copy={copy} notify={notify} />}

      {/* ══ PAD TAB ══ */}
      {tab === 'pad' && <PadTab m={m} notify={notify} />}

      {/* ══ MODALS ══ */}
      {showVarForm && pendingTemplate && (
        <div className={`fixed inset-0 ${m.modalBg} flex items-center justify-center z-40 p-4`}>
          <div className={`${m.modal} border rounded-xl p-5 w-full max-w-md flex flex-col gap-4`}>
            <div className="flex justify-between items-center">
              <h2 className={`font-bold text-sm ${m.text}`}>Fill Template Variables</h2>
              <button onClick={() => setShowVarForm(false)} className={`${m.textSub} hover:text-white`}><Ic n="X" size={15} /></button>
            </div>
            <p className={`text-xs ${m.textAlt}`}>"{pendingTemplate.title}" contains template variables:</p>
            <div className="flex flex-col gap-2">
              {Object.keys(varVals).map(k => (
                <div key={k}>
                  <label className="text-xs font-mono font-semibold text-violet-400 block mb-1">{`{{${k}}}`}</label>
                  <input className={`w-full ${m.input} border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-violet-500 ${m.text}`}
                    placeholder={`Value for ${k}…`} value={varVals[k]} onChange={e => setVarVals(p => ({ ...p, [k]: e.target.value }))} />
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <button onClick={applyTemplate} className="flex-1 bg-violet-600 hover:bg-violet-500 text-white rounded-lg py-2 text-sm font-semibold transition-colors">Apply Template</button>
              <button onClick={() => { applyEntry(pendingTemplate); setShowVarForm(false); setPendingTemplate(null); }} className={`px-4 ${m.btn} rounded-lg text-sm ${m.textBody} transition-colors`}>Skip</button>
            </div>
          </div>
        </div>
      )}

      {showSettings && (
        <div className={`fixed inset-0 ${m.modalBg} flex items-center justify-center z-40 p-4`}>
          <div className={`${m.modal} border rounded-xl p-5 w-full max-w-sm flex flex-col gap-4`}>
            <div className="flex justify-between items-center">
              <h2 className={`font-bold text-base ${m.text}`}>Settings</h2>
              <button onClick={() => setShowSettings(false)} className={`${m.textSub} hover:text-white`}><Ic n="X" size={15} /></button>
            </div>
            <label className={`flex items-center justify-between text-sm ${m.textBody} cursor-pointer`}>
              <span>Show enhancement notes</span>
              <input type="checkbox" checked={showNotes} onChange={e => setShowNotes(e.target.checked)} className="accent-violet-500" />
            </label>
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
              <span className={`text-xs ${m.textMuted} font-mono`}>ESC</span>
            </div>
            <div className="max-h-72 overflow-y-auto">
              {filteredCmds.map((a, i) => (
                <button key={i} onClick={a.action}
                  className={`w-full flex items-center justify-between px-4 py-2.5 text-sm ${m.textBody} hover:bg-violet-600 hover:text-white transition-colors text-left`}>
                  <span>{a.label}</span>
                  {a.hint && <kbd className={`text-xs font-mono px-1.5 py-0.5 ${m.pill} rounded`}>{a.hint}</kbd>}
                </button>
              ))}
              {filteredCmds.length === 0 && <p className={`text-xs ${m.textMuted} p-4 text-center`}>No commands found</p>}
            </div>
          </div>
        </div>
      )}

      {showShortcuts && (
        <div className={`fixed inset-0 ${m.modalBg} flex items-center justify-center z-50 p-4`} onClick={() => setShowShortcuts(false)}>
          <div className={`${m.modal} border rounded-xl p-5 w-full max-w-xs`} onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4">
              <h2 className={`font-bold text-sm ${m.text}`}>Keyboard Shortcuts</h2>
              <button onClick={() => setShowShortcuts(false)} className={m.textSub}><Ic n="X" size={14} /></button>
            </div>
            <div className="flex flex-col gap-2.5">
              {[['⌘ ↵', 'Enhance prompt'], ['⌘ S', 'Save prompt'], ['⌘ K', 'Command palette'], ['?', 'Show shortcuts'], ['Esc', 'Close modals']].map(([key, label]) => (
                <div key={key} className="flex items-center justify-between">
                  <span className={`text-sm ${m.textBody}`}>{label}</span>
                  <kbd className={`text-xs font-mono px-2 py-1 ${m.pill} rounded-md`}>{key}</kbd>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    </div>
  );
}
