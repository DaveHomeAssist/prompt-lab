import { useState, useEffect, useRef } from 'react';
import { callModel } from '../api';
import {
  extractVars, decodeShare,
  extractTextFromAnthropic, parseEnhancedPayload,
  suggestTitleFromText,
  looksSensitive, isTransientError,
  isGhostVar, resolveGhostVars,
  ngramSimilarity,
} from '../promptUtils';
import { normalizeEntry } from '../lib/promptSchema.js';
import { lintPrompt, applyLintQuickFix } from '../promptLint';
import { normalizeError } from '../errorTaxonomy';
import { scanSensitiveData, redactPayload } from '../piiScanner';
import { ALL_TAGS, MODES } from '../constants';
import { saveEvalRun } from '../experimentStore';
import { useSessionRestore, useSessionSave } from './useSessionState.js';
import { openSettings } from '../lib/platform.js';
import { logWarn } from '../lib/logger.js';
import { ensureString } from '../lib/utils.js';
import useEvalRuns from './useEvalRuns.js';
import useTestCases from './useTestCases.js';

const nowMs = () =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

export default function usePromptEditor(ui, lib) {
  const { notify, setTab } = ui;

  // ── Core editor state ──
  const [raw, setRaw] = useState('');
  const [enhanced, setEnhanced] = useState('');
  const [variants, setVariants] = useState([]);
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [enhMode, setEnhMode] = useState('balanced');
  const [showNotes, setShowNotes] = useState(true);

  // ── Lint ──
  const [lintIssues, setLintIssues] = useState([]);
  const [lintOpen, setLintOpen] = useState(false);
  const lintTimerRef = useRef(null);

  // ── PII ──
  const [piiWarning, setPiiWarning] = useState(null);

  // ── Save panel ──
  const [showSave, setShowSave] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [saveTitle, setSaveTitle] = useState('');
  const [saveTags, setSaveTags] = useState([]);
  const [saveCollection, setSaveCollection] = useState('');
  const [changeNote, setChangeNote] = useState('');

  // ── Diff ──
  const [showDiff, setShowDiff] = useState(false);

  // ── Collection new-item form ──
  const [showNewColl, setShowNewColl] = useState(false);
  const [newCollName, setNewCollName] = useState('');

  // ── Template variables ──
  const [varVals, setVarVals] = useState({});
  const [showVarForm, setShowVarForm] = useState(false);
  const [pendingTemplate, setPendingTemplate] = useState(null);

  // ── Layout ──
  const [editorLayout, setEditorLayout] = useState('editor');

  // ── Composer ──
  const [composerBlocks, setComposerBlocks] = useState([]);

  // ── Refs ──
  const enhanceReqRef = useRef(0);
  const templateLoadReqRef = useRef(0);

  // ── Derived ──
  const hasSavablePrompt = raw.trim() || enhanced.trim();

  // ── Composed hooks ──
  const evalRunsHook = useEvalRuns({ editingId, tab: ui.tab });
  const testCasesHook = useTestCases({ notify });

  // ── Session persistence ──
  useSessionRestore({ setRaw, setEnhanced, setVariants, setNotes, setTab, setEnhMode });
  useSessionSave({ raw, enhanced, variants, notes, tab: ui.tab, enhMode });

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

  // ── Debounced lint ──
  useEffect(() => {
    if (lintTimerRef.current) clearTimeout(lintTimerRef.current);
    if (!raw.trim()) { setLintIssues([]); return; }
    lintTimerRef.current = setTimeout(() => setLintIssues(lintPrompt(raw)), 300);
    return () => clearTimeout(lintTimerRef.current);
  }, [raw]);

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
    setNotes(''); setShowSave(false); setEditingId(null); setError(null);
  };

  const openOptions = () => {
    openSettings();
  };

  const handleLintFix = (ruleId) => setRaw(applyLintQuickFix(raw, ruleId));

  const buildEnhancePayloadFor = (inputText) => {
    const modeObj = MODES.find(x => x.id === enhMode) || MODES[0];
    const sys = `You are an expert prompt engineer. ${modeObj.sys}\nReturn ONLY valid JSON, no markdown, no backticks:\n{"enhanced":"...","variants":[{"label":"...","content":"..."}],"notes":"...","tags":["..."]}\nProduce 2 variants. Available tags: ${ALL_TAGS.join(', ')}.`;
    return { model: 'claude-sonnet-4-20250514', max_tokens: 4096, system: sys, messages: [{ role: 'user', content: inputText }], responseFormat: 'json' };
  };

  const buildEnhancePayload = () => buildEnhancePayloadFor(raw);

  const runTestCaseJob = async (testCase, promptTitle) => {
    const inputText = ensureString(testCase?.input);
    const payload = buildEnhancePayloadFor(inputText);
    const startedAt = nowMs();
    const { matches } = scanSensitiveData({ payload });
    if (matches.length > 0) {
      const message = `PII gate blocked test case: ${testCase.title}`;
      await saveEvalRun({
        promptId: testCase.promptId,
        promptTitle,
        mode: 'test-case',
        provider: 'blocked',
        model: payload.model || 'unknown',
        variantLabel: testCase.title,
        input: inputText,
        output: message,
        latencyMs: nowMs() - startedAt,
        status: 'error',
        notes: 'Sensitive data detected before send.',
        testCaseId: testCase.id,
      });
      throw new Error(message);
    }
    const data = await callWithRetry(payload);
    const txt = extractTextFromAnthropic(data);
    const parsed = parseEnhancedPayload(txt);
    await saveEvalRun({
      promptId: testCase.promptId,
      promptTitle,
      mode: 'test-case',
      provider: data?.provider || 'unknown',
      model: data?.model || payload.model || 'unknown',
      variantLabel: testCase.title,
      input: inputText,
      output: parsed.enhanced || txt,
      latencyMs: nowMs() - startedAt,
      notes: parsed.notes || '',
      testCaseId: testCase.id,
    });
    return parsed;
  };

  const enhance = async (overridePayload) => {
    if (!raw.trim()) return;
    const safeOverridePayload = overridePayload && typeof overridePayload === 'object' && 'nativeEvent' in overridePayload
      ? null
      : overridePayload;
    const payload = safeOverridePayload || buildEnhancePayload();

    if (!safeOverridePayload) {
      const { matches } = scanSensitiveData({ payload });
      if (matches.length > 0) {
        setPiiWarning({ matches, payload });
        return;
      }
    }

    const reqId = enhanceReqRef.current + 1;
    enhanceReqRef.current = reqId;
    const startedAt = nowMs();
    setLoading(true); setError(null); setEnhanced(''); setVariants([]); setNotes('');
    setShowSave(false); setShowDiff(false);
    try {
      const data = await callWithRetry(payload);
      if (reqId !== enhanceReqRef.current) return;
      const txt = extractTextFromAnthropic(data);
      console.log('[enhance] extracted text:', txt);
      let p;
      try { p = parseEnhancedPayload(txt); } catch (parseErr) {
        console.error('[enhance] parse failed:', parseErr.message, '\n[enhance] raw txt:', txt);
        throw parseErr;
      }
      console.log('[enhance] parsed keys:', Object.keys(p), 'enhanced type:', typeof p.enhanced);
      setEnhanced(p.enhanced || ''); setVariants(p.variants || []); setNotes(p.notes || '');
      setSaveTags(p.tags || []);
      const nextTitle = suggestTitleFromText(p.enhanced || raw);
      setSaveTitle(nextTitle);
      saveEvalRun({
        promptId: editingId,
        promptTitle: (saveTitle || nextTitle).trim() || nextTitle,
        mode: 'enhance',
        provider: data?.provider || 'unknown',
        model: data?.model || payload?.model || 'unknown',
        input: raw,
        output: p.enhanced || txt,
        latencyMs: nowMs() - startedAt,
        notes: p.notes || '',
      }).then(() => evalRunsHook.refreshEvalRuns(editingId)).catch((e) => logWarn('save eval run', e));
      setShowSave(true);
    } catch (e) {
      if (reqId === enhanceReqRef.current) setError(normalizeError(e));
    }
    if (reqId === enhanceReqRef.current) setLoading(false);
  };

  const piiSendAnyway = () => { const p = piiWarning.payload; setPiiWarning(null); enhance(p); };
  const piiRedactAndSend = () => { const { matches, payload } = piiWarning; setPiiWarning(null); enhance(redactPayload(payload, matches)); };
  const piiCancel = () => setPiiWarning(null);

  const doSave = () => {
    const saved = lib.doSave({ raw, enhanced, variants, notes, tags: saveTags, title: saveTitle, collection: saveCollection, editingId, changeNote });
    if (saved?.id) {
      setEditingId(saved.id);
      setSaveTitle(saved.title || saveTitle);
      evalRunsHook.refreshEvalRuns(saved.id);
    }
    setChangeNote('');
    setShowSave(false);
  };

  const applyTemplateWithVals = (entry, vals) => {
    let text = ensureString(entry?.enhanced);
    Object.entries(vals || {}).forEach(([k, v]) => { text = text.replaceAll(`{{${k}}}`, ensureString(v)); });
    applyEntry({ ...entry, enhanced: text });
  };

  const loadEntry = async (entry) => {
    const vars = extractVars(entry?.enhanced);
    if (vars.length === 0) {
      applyEntry(entry);
      return;
    }
    const reqId = templateLoadReqRef.current + 1;
    templateLoadReqRef.current = reqId;
    const ghostVars = vars.filter(isGhostVar);
    const manualVars = vars.filter(v => !isGhostVar(v));
    const ghostVals = await resolveGhostVars(ghostVars);
    if (reqId !== templateLoadReqRef.current) return;
    if (manualVars.length === 0) {
      setShowVarForm(false);
      setPendingTemplate(null);
      setVarVals({});
      applyTemplateWithVals(entry, ghostVals);
      return;
    }
    setPendingTemplate(entry);
    setVarVals({
      ...Object.fromEntries(manualVars.map(v => [v, ''])),
      ...ghostVals,
    });
    setShowVarForm(true);
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
    applyTemplateWithVals(pendingTemplate, varVals);
    setShowVarForm(false); setPendingTemplate(null);
  };

  const addToComposer = entry => {
    setComposerBlocks(prev => [...prev, { id: crypto.randomUUID(), label: entry.title, content: entry.enhanced, sourceId: entry.id }]);
    lib.bumpUse(entry.id); notify('Added to Composer!');
  };

  const loadCaseIntoEditor = (testCase) => {
    setRaw(testCase.input || '');
    setTab('editor');
    notify(`Loaded test case: ${testCase.title}`);
  };

  const runSingleCase = async (testCase, promptTitle) => {
    testCasesHook.setRunningCases(true);
    try {
      await runTestCaseJob(testCase, promptTitle);
      await evalRunsHook.refreshEvalRuns(testCase.promptId);
      evalRunsHook.setShowEvalHistory(true);
      notify(`Ran test case: ${testCase.title}`);
    } catch (e) {
      notify(e?.message || `Failed test case: ${testCase.title}`);
      await evalRunsHook.refreshEvalRuns(testCase.promptId);
    } finally {
      testCasesHook.setRunningCases(false);
    }
  };

  const runAllCases = async () => {
    const cases = testCasesHook.testCasesByPrompt[editingId] || [];
    if (!editingId || cases.length === 0 || testCasesHook.runningCases) return;
    const promptTitle = saveTitle || suggestTitleFromText(enhanced || raw);
    testCasesHook.setRunningCases(true);
    let completed = 0;
    for (const testCase of cases) {
      try {
        await runTestCaseJob(testCase, promptTitle);
        completed += 1;
      } catch (e) {
        logWarn(`test case batch: ${testCase.title}`, e);
      }
    }
    await evalRunsHook.refreshEvalRuns(editingId);
    evalRunsHook.setShowEvalHistory(true);
    testCasesHook.setRunningCases(false);
    notify(`Ran ${completed}/${cases.length} test cases`);
  };

  // ── Derived values ──
  const currentTestCases = editingId ? (testCasesHook.testCasesByPrompt[editingId] || []) : [];

  return {
    // Core editor state
    raw, setRaw,
    enhanced, setEnhanced,
    variants, setVariants,
    notes, setNotes,
    loading,
    error,
    enhMode, setEnhMode,
    showNotes, setShowNotes,

    // Lint
    lintIssues, lintOpen, setLintOpen,
    handleLintFix,

    // PII
    piiWarning,
    piiSendAnyway, piiRedactAndSend, piiCancel,

    // Save panel
    showSave, setShowSave,
    editingId, setEditingId,
    saveTitle, setSaveTitle,
    saveTags, setSaveTags,
    saveCollection, setSaveCollection,
    changeNote, setChangeNote,

    // Diff
    showDiff, setShowDiff,

    // Eval history
    evalRuns: evalRunsHook.evalRuns,
    showEvalHistory: evalRunsHook.showEvalHistory,
    setShowEvalHistory: evalRunsHook.setShowEvalHistory,
    refreshEvalRuns: evalRunsHook.refreshEvalRuns,

    // Test cases
    testCasesByPrompt: testCasesHook.testCasesByPrompt,
    caseFormPromptId: testCasesHook.caseFormPromptId,
    editingCaseId: testCasesHook.editingCaseId,
    caseTitle: testCasesHook.caseTitle,
    setCaseTitle: testCasesHook.setCaseTitle,
    caseInput: testCasesHook.caseInput,
    setCaseInput: testCasesHook.setCaseInput,
    caseTraits: testCasesHook.caseTraits,
    setCaseTraits: testCasesHook.setCaseTraits,
    caseExclusions: testCasesHook.caseExclusions,
    setCaseExclusions: testCasesHook.setCaseExclusions,
    caseNotes: testCasesHook.caseNotes,
    setCaseNotes: testCasesHook.setCaseNotes,
    runningCases: testCasesHook.runningCases,
    openCaseForm: testCasesHook.openCaseForm,
    resetCaseForm: testCasesHook.resetCaseForm,
    saveCaseForPrompt: testCasesHook.saveCaseForPrompt,
    removeCase: testCasesHook.removeCase,
    loadCaseIntoEditor,
    runSingleCase,
    runAllCases,

    // Collection form
    showNewColl, setShowNewColl,
    newCollName, setNewCollName,

    // Template variables
    varVals, setVarVals,
    showVarForm, setShowVarForm,
    pendingTemplate,
    applyTemplate,

    // Layout
    editorLayout, setEditorLayout,

    // Composer
    composerBlocks, setComposerBlocks,

    // Actions
    enhance, doSave, clearEditor, openSavePanel,
    openOptions, copy, loadEntry, addToComposer,

    // Derived
    hasSavablePrompt, currentTestCases,
  };
}
