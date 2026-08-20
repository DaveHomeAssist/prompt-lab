import { useRef, useState } from 'react';
import { callModel } from '../api';
import {
  extractTextFromAnthropic,
  parseEnhancedPayload,
  suggestTitleFromText,
  isTransientError,
  ngramSimilarity,
  checkTraits,
} from '../promptUtils';
import { ALL_TAGS, buildSystemPrompt, DEFAULT_ENHANCE_MODEL, DEFAULT_ENHANCE_MAX_TOKENS, DEFAULT_ENHANCE_TEMPERATURE } from '../constants';
import { saveEvalRun } from '../experimentStore';
import { scanSensitiveData, redactPayload } from '../piiScanner';
import { openSettings } from '../lib/platform.js';
import { logWarn } from '../lib/logger.js';
import { ensureString } from '../lib/utils.js';
import { AppError, ErrorCategory, normalizeError } from '../lib/errorTaxonomy.js';
import { normalizeResultMeta } from '../lib/enhancementResult.js';
import {
  assessEnhancementQuality,
  buildEnhancementCorrectionPayload,
  combineTokenUsage,
} from '../lib/enhancementQuality.js';
import useEvalRuns from './useEvalRuns.js';
import useTestCases from './useTestCases.js';

const nowMs = () =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

/**
 * Execution controller for enhance + evaluate flows.
 */
export default function useExecutionFlow({ ui, lib, editor, persistence }) {
  const { notify, setTab, tab } = ui;
  const {
    raw, enhanced, variants, notes, enhMode,
    setRaw, setEnhanced, setVariants, setNotes, setResultMeta,
  } = editor;
  const {
    editingId, saveTitle, setSaveTitle, setSaveTags, setShowSave, setShowDiff,
  } = persistence;

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [piiWarning, setPiiWarning] = useState(null);
  const [streamPreview, setStreamPreview] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [optimisticSaveVisible, setOptimisticSaveVisible] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ active: false, completed: 0, total: 0, currentLabel: '' });
  const enhanceReqRef = useRef(0);
  const enhanceAbortRef = useRef(null);
  // Synchronous dispatch guard. `loading` only disables the trigger after a
  // render, so two activations inside one tick both reach the provider. This
  // ref flips before the request leaves and is cleared by cancelEnhance or by
  // the owning request's finally block, so cancel-then-retry stays available.
  const enhanceInFlightRef = useRef(false);

  const evalRunsHook = useEvalRuns({ editingId, tab });
  const testCasesHook = useTestCases({ notify });

  const callWithRetry = async (payload, retries = 1, options = {}) => {
    let attempt = 0;
    let lastError = null;
    while (attempt <= retries) {
      try {
        return await callModel(payload, options);
      } catch (caught) {
        if (options?.signal?.aborted || caught?.name === 'AbortError') {
          throw caught;
        }
        lastError = caught;
        if (attempt >= retries || !isTransientError(caught)) break;
        await new Promise((resolve) => setTimeout(resolve, 350 * (attempt + 1)));
        // A cancel during the retry backoff must not launch another attempt.
        if (options?.signal?.aborted) {
          const abortError = new Error('Request cancelled.');
          abortError.name = 'AbortError';
          throw abortError;
        }
      }
      attempt += 1;
    }
    throw normalizeError(lastError || new Error('Request failed.'), 'execution');
  };

  const buildEnhancePayloadFor = (inputText, modeId = enhMode) => {
    return {
      model: DEFAULT_ENHANCE_MODEL,
      max_tokens: DEFAULT_ENHANCE_MAX_TOKENS,
      temperature: DEFAULT_ENHANCE_TEMPERATURE,
      system: buildSystemPrompt(modeId, ALL_TAGS),
      messages: [{ role: 'user', content: inputText }],
      responseFormat: 'json',
    };
  };

  const buildEnhancePayload = (modeId = enhMode) => buildEnhancePayloadFor(raw, modeId);

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
        status: 'blocked',
        notes: 'Sensitive data detected before send.',
        testCaseId: testCase.id,
      });
      throw normalizeError(new Error(message), 'execution');
    }

    const data = await callWithRetry(payload);
    const text = extractTextFromAnthropic(data);
    const parsed = parseEnhancedPayload(text);
    const traitResults = checkTraits(
      parsed.enhanced || text,
      testCase.expectedTraits,
      testCase.expectedExclusions,
    );

    await saveEvalRun({
      promptId: testCase.promptId,
      promptTitle,
      mode: 'test-case',
      provider: data?.provider || 'unknown',
      model: data?.model || payload.model || 'unknown',
      variantLabel: testCase.title,
      input: inputText,
      output: parsed.enhanced || text,
      latencyMs: nowMs() - startedAt,
      notes: parsed.notes || '',
      testCaseId: testCase.id,
      traitResults,
      verdict: traitResults.verdict,
    });

    return { parsed, traitResults };
  };

  const enhance = async (overridePayload, meta) => {
    if (!raw.trim()) return;
    if (enhanceInFlightRef.current) return;
    const safeOverridePayload = overridePayload && typeof overridePayload === 'object' && 'nativeEvent' in overridePayload
      ? null
      : overridePayload;
    const payload = safeOverridePayload || buildEnhancePayload();
    const enhanceModeId = meta?.modeId || enhMode;

    if (!safeOverridePayload) {
      const { matches } = scanSensitiveData({ payload });
      if (matches.length > 0) {
        // Record blocked sends so preflight PII stops are visible in run history instead of disappearing.
        try {
          await saveEvalRun({
            promptId: editingId,
            promptTitle: (saveTitle || suggestTitleFromText(raw)).trim() || suggestTitleFromText(raw),
            mode: 'enhance',
            enhanceMode: enhanceModeId,
            provider: 'blocked',
            model: payload?.model || 'unknown',
            input: raw,
            output: 'Prompt blocked before send due to sensitive data detection.',
            latencyMs: 0,
            status: 'blocked',
            notes: 'Sensitive data detected before send.',
          });
          evalRunsHook.refreshEvalRuns(editingId).catch((caught) => logWarn('refresh blocked eval runs', caught));
        } catch (caught) {
          logWarn('save blocked eval run', caught);
        }
        setPiiWarning({ matches, payload });
        return;
      }
    }

    // Claimed only once the preflight checks have passed, so a PII-blocked
    // attempt never strands the guard and the user can immediately retry.
    enhanceInFlightRef.current = true;
    const reqId = enhanceReqRef.current + 1;
    enhanceReqRef.current = reqId;
    const startedAt = nowMs();
    enhanceAbortRef.current?.abort();
    const abortController = typeof AbortController !== 'undefined' ? new AbortController() : null;
    enhanceAbortRef.current = abortController;

    setLoading(true);
    setStreaming(false);
    setStreamPreview('');
    setError(null);
    // Keep the last complete result visible while a re-run is in flight. A
    // failed or cancelled request must not destroy the candidate the user was
    // reviewing; success replaces it atomically below.
    setOptimisticSaveVisible(true);
    setShowSave(false);
    setShowDiff(false);

    let qualityGateFailure = null;
    let executionProvider = 'unknown';
    let executionModel = payload?.model || 'unknown';
    let accumulatedUsage = null;
    try {
      const streamOptions = {
        signal: abortController?.signal,
        onChunk: (chunk, fullText) => {
          if (reqId !== enhanceReqRef.current) return;
          setStreaming(true);
          setStreamPreview(fullText || chunk || '');
        },
      };
      let data = await callWithRetry(payload, 1, streamOptions);
      if (reqId !== enhanceReqRef.current) return;
      executionProvider = data?.provider || executionProvider;
      executionModel = data?.model || executionModel;
      accumulatedUsage = combineTokenUsage(data?.usage);

      let txt = extractTextFromAnthropic(data);
      let parsed = parseEnhancedPayload(txt);
      const sentSource = ensureString(
        payload?.messages?.find((message) => message?.role === 'user')?.content || raw,
      );
      let correctionUsed = false;
      let qualityAssessment = assessEnhancementQuality(sentSource, parsed);

      if (!qualityAssessment.passed) {
        correctionUsed = true;
        qualityGateFailure = qualityAssessment;
        setStreaming(false);
        setStreamPreview('');

        const correctionPayload = buildEnhancementCorrectionPayload(payload, txt, qualityAssessment);
        const correctionData = await callWithRetry(correctionPayload, 0, streamOptions);
        if (reqId !== enhanceReqRef.current) return;
        executionProvider = correctionData?.provider || executionProvider;
        executionModel = correctionData?.model || executionModel;
        accumulatedUsage = combineTokenUsage(data?.usage, correctionData?.usage);

        const correctionText = extractTextFromAnthropic(correctionData);
        const corrected = parseEnhancedPayload(correctionText);
        qualityAssessment = assessEnhancementQuality(sentSource, corrected);
        if (!qualityAssessment.passed) {
          qualityGateFailure = qualityAssessment;
          throw new AppError({
            category: ErrorCategory.PROVIDER,
            userMessage: 'The model could not produce a meaningful improvement after one corrective pass. Your draft and previous result are still here. Try another mode or run again.',
            debugMessage: `Enhancement quality gate failed: ${qualityAssessment.failures.join(', ')}`,
            retryable: true,
            source: 'enhancement-quality',
          });
        }

        data = correctionData;
        txt = correctionText;
        parsed = corrected;
        qualityGateFailure = null;
      }

      const latencyMs = nowMs() - startedAt;
      const runId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `enhance-${Date.now()}`;
      const nextResultMeta = normalizeResultMeta({
        ...parsed,
        assumptions: parsed.assumptionDetails || parsed.assumptions,
        reversibleEdits: parsed.reversibleEdits,
        provider: executionProvider,
        model: executionModel,
        latencyMs,
        usage: accumulatedUsage,
        runId,
      }, {
        enhanced: parsed.enhanced,
        variants: parsed.variants,
      });

      setEnhanced(parsed.enhanced || '');
      setVariants(parsed.variants || []);
      setResultMeta?.(nextResultMeta);

      // Surface assumptions in notes panel for transparency
      const assumptions = parsed.assumptions || [];
      const qualityNote = correctionUsed
        ? 'Quality check: Prompt Lab rejected the first result as a no-op or unsupported near-no-op and used one corrective pass.'
        : '';
      const notesText = [parsed.notes || '', qualityNote].filter(Boolean).join('\n\n');
      const assumptionBlock = assumptions.length > 0
        ? `\n\nAssumptions added:\n${assumptions.map((a) => `• ${a.text || a}`).join('\n')}`
        : '';
      setNotes(notesText + assumptionBlock);
      setSaveTags(parsed.tags || []);

      const nextTitle = suggestTitleFromText(parsed.enhanced || raw);
      // Suggest a title without clobbering one the user already typed.
      if (!ensureString(saveTitle).trim()) setSaveTitle(nextTitle);

      const goldenEntry = editingId
        ? lib.library.find((entry) => entry.id === editingId)
        : null;
      const goldenText = goldenEntry?.goldenResponse?.text || '';
      const goldenScore = goldenText && (parsed.enhanced || txt)
        ? ngramSimilarity(goldenText, parsed.enhanced || txt)
        : null;
      const goldenThreshold = Number.isFinite(goldenEntry?.goldenThreshold)
        ? goldenEntry.goldenThreshold
        : 0.7;

      saveEvalRun({
        id: runId,
        promptId: editingId,
        promptTitle: (saveTitle || nextTitle).trim() || nextTitle,
        mode: 'enhance',
        enhanceMode: enhanceModeId,
        provider: executionProvider,
        model: executionModel,
        input: raw,
        output: parsed.enhanced || txt,
        latencyMs,
        notes: notesText,
        candidates: nextResultMeta.candidates,
        selectedCandidateId: nextResultMeta.selectedCandidateId,
        changeSummary: nextResultMeta.changeSummary,
        changes: nextResultMeta.changes,
        assumptions: nextResultMeta.assumptions,
        reversibleEdits: nextResultMeta.reversibleEdits,
        reasoning: nextResultMeta.reasoning,
        tags: nextResultMeta.tags,
        usage: nextResultMeta.usage,
        goldenScore,
        regression: goldenScore !== null && goldenScore < goldenThreshold,
      }).then(() => evalRunsHook.refreshEvalRuns(editingId)).catch((caught) => logWarn('save eval run', caught));

      // Results own the post-enhance commit decision. Opening the legacy save
      // drawer here duplicates those actions and makes a fresh result look as
      // though it has already replaced the current library prompt.
      setShowSave(false);
      setOptimisticSaveVisible(false);
      setStreamPreview('');
      setStreaming(false);
    } catch (caught) {
      if (caught?.name === 'AbortError' || abortController?.signal?.aborted) {
        // Cancelled attempts stay in the running record instead of vanishing.
        saveEvalRun({
          promptId: editingId,
          promptTitle: (saveTitle || suggestTitleFromText(raw)).trim() || suggestTitleFromText(raw),
          mode: 'enhance',
          enhanceMode: enhanceModeId,
          provider: executionProvider,
          model: executionModel,
          input: raw,
          output: 'Enhance cancelled before completion.',
          latencyMs: nowMs() - startedAt,
          status: 'canceled',
          usage: accumulatedUsage,
        }).then(() => evalRunsHook.refreshEvalRuns(editingId)).catch((err) => logWarn('save canceled eval run', err));
        if (reqId === enhanceReqRef.current) {
          setLoading(false);
          setStreaming(false);
          setStreamPreview('');
          setOptimisticSaveVisible(false);
        }
        return;
      }
      if (reqId === enhanceReqRef.current) {
        setOptimisticSaveVisible(false);
        const appError = normalizeError(caught, 'execution');
        setError(appError);
        // Failed attempts are part of the running enhancement record too.
        saveEvalRun({
          promptId: editingId,
          promptTitle: (saveTitle || suggestTitleFromText(raw)).trim() || suggestTitleFromText(raw),
          mode: 'enhance',
          enhanceMode: enhanceModeId,
          provider: executionProvider,
          model: executionModel,
          input: raw,
          output: appError.userMessage || appError.message || 'Enhance failed.',
          latencyMs: nowMs() - startedAt,
          status: 'error',
          usage: accumulatedUsage,
          notes: [
            appError.category ? `Error category: ${appError.category}` : '',
            qualityGateFailure?.failures?.length
              ? `Quality gate: ${qualityGateFailure.failures.join(', ')}`
              : '',
          ].filter(Boolean).join('\n'),
        }).then(() => evalRunsHook.refreshEvalRuns(editingId)).catch((err) => logWarn('save failed eval run', err));
      }
    } finally {
      if (enhanceAbortRef.current === abortController) {
        enhanceAbortRef.current = null;
      }
      if (reqId === enhanceReqRef.current) {
        enhanceInFlightRef.current = false;
        setLoading(false);
      }
    }
  };

  const enhanceWithMode = async (modeId) => {
    if (!raw.trim()) return;
    return enhance(buildEnhancePayload(modeId), { modeId });
  };

  const cancelEnhance = () => {
    enhanceReqRef.current += 1;
    // Release the dispatch guard here as well as in the finally block: the
    // in-flight attempt may still be unwinding, and a cancel must leave the
    // user able to retry immediately.
    enhanceInFlightRef.current = false;
    enhanceAbortRef.current?.abort();
    enhanceAbortRef.current = null;
    setLoading(false);
    setStreaming(false);
    setStreamPreview('');
    setError(null);
    notify('Generation cancelled.');
  };

  const piiSendAnyway = () => {
    if (!piiWarning?.payload) return;
    const payload = piiWarning.payload;
    setPiiWarning(null);
    enhance(payload);
  };

  const piiRedactAndSend = () => {
    if (!piiWarning?.payload) return;
    const { matches, payload } = piiWarning;
    setPiiWarning(null);
    enhance(redactPayload(payload, matches));
  };

  const piiCancel = () => setPiiWarning(null);

  const loadCaseIntoEditor = (testCase) => {
    setRaw(testCase.input || '');
    setTab('editor');
    notify(`Loaded test case: ${testCase.title}`);
  };

  const runSingleCase = async (testCase, promptTitle) => {
    testCasesHook.setRunningCases(true);
    setBatchProgress({
      active: true,
      completed: 0,
      total: 1,
      currentLabel: testCase.title,
    });
    try {
      await runTestCaseJob(testCase, promptTitle);
      await evalRunsHook.refreshEvalRuns(testCase.promptId);
      evalRunsHook.setShowEvalHistory(true);
      notify(`Ran test case: ${testCase.title}`);
    } catch (caught) {
      const appError = normalizeError(caught, 'execution');
      notify(appError.userMessage || `Failed test case: ${testCase.title}`);
      await evalRunsHook.refreshEvalRuns(testCase.promptId);
    } finally {
      testCasesHook.setRunningCases(false);
      setBatchProgress({ active: false, completed: 0, total: 0, currentLabel: '' });
    }
  };

  const runAllCases = async () => {
    const cases = testCasesHook.testCasesByPrompt[editingId] || [];
    if (!editingId || cases.length === 0 || testCasesHook.runningCases) return;
    const promptTitle = saveTitle || suggestTitleFromText(enhanced || raw);

    testCasesHook.setRunningCases(true);
    let completed = 0;
    let suitePassed = 0;
    let suiteFailed = 0;
    for (const testCase of cases) {
      setBatchProgress({
        active: true,
        completed,
        total: cases.length,
        currentLabel: testCase.title,
      });
      try {
        const { traitResults } = await runTestCaseJob(testCase, promptTitle);
        completed += 1;
        if (traitResults?.verdict === 'pass') suitePassed += 1;
        if (traitResults?.verdict === 'fail') suiteFailed += 1;
        setBatchProgress({
          active: true,
          completed,
          total: cases.length,
          currentLabel: testCase.title,
        });
      } catch (caught) {
        // Blocked or errored cases count against the suite instead of vanishing.
        suiteFailed += 1;
        logWarn(`test case batch: ${testCase.title}`, caught);
      }
    }

    if (suitePassed > 0 || suiteFailed > 0) {
      lib.recordSuiteResult?.(editingId, {
        verdict: suiteFailed > 0 ? 'fail' : 'pass',
        passed: suitePassed,
        failed: suiteFailed,
        total: cases.length,
        lastRunAt: new Date().toISOString(),
      });
    }

    await evalRunsHook.refreshEvalRuns(editingId);
    evalRunsHook.setShowEvalHistory(true);
    testCasesHook.setRunningCases(false);
    setBatchProgress({ active: false, completed, total: cases.length, currentLabel: '' });
    notify(`Ran ${completed}/${cases.length} test cases`);
  };

  const clearExecutionState = () => {
    enhanceReqRef.current += 1;
    enhanceAbortRef.current?.abort();
    enhanceAbortRef.current = null;
    setLoading(false);
    setError(null);
    setPiiWarning(null);
    setStreamPreview('');
    setStreaming(false);
    setOptimisticSaveVisible(false);
    setBatchProgress({ active: false, completed: 0, total: 0, currentLabel: '' });
    setResultMeta?.(null);
  };

  const currentTestCases = editingId ? (testCasesHook.testCasesByPrompt[editingId] || []) : [];

  return {
    loading,
    error,
    piiWarning,
    streamPreview,
    streaming,
    optimisticSaveVisible,
    batchProgress,
    piiSendAnyway,
    piiRedactAndSend,
    piiCancel,
    buildEnhancePayloadFor,
    buildEnhancePayload,
    enhance,
    enhanceWithMode,
    evalRuns: evalRunsHook.evalRuns,
    showEvalHistory: evalRunsHook.showEvalHistory,
    setShowEvalHistory: evalRunsHook.setShowEvalHistory,
    refreshEvalRuns: evalRunsHook.refreshEvalRuns,
    updateEvalRun: evalRunsHook.updateRun,
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
    cancelEnhance,
    currentTestCases,
    openOptions: openSettings,
    clearExecutionState,
  };
}
