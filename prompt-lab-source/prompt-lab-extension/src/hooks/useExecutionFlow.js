import { useEffect, useRef, useState } from 'react';
import { callModel } from '../api';
import {
  extractTextFromAnthropic, parseEnhancedPayload, suggestTitleFromText,
  isTransientError, ngramSimilarity, checkTraits, stitchContinuation, testCaseOutcome,
} from '../promptUtils';
import { ALL_TAGS, DEFAULT_ENHANCE_MODEL, DEFAULT_ENHANCE_TEMPERATURE } from '../constants';
import { isGoldenRegression, resolveGoldenThreshold } from '../lib/goldenVerdict.js';
import { saveEvalRun } from '../experimentStore';
import { scanSensitiveData } from '../piiScanner';
import useSensitivePreflight from './useSensitivePreflight.js';
import { openSettings, getActiveProviderRoute, getConfiguredProviders } from '../lib/platform.js';
import { activeProviderRoute } from '../lib/providerRegistry.js';
import { logWarn } from '../lib/logger.js';
import { ensureString } from '../lib/utils.js';
import { AppError, ErrorCategory, normalizeError, truncationError } from '../lib/errorTaxonomy.js';
import { normalizeResultMeta } from '../lib/enhancementResult.js';
import {
  assessEnhancementQuality, buildEnhancementCorrectionPayload, combineTokenUsage,
} from '../lib/enhancementQuality.js';
import useGenerationOptions from './useGenerationOptions.js';
import {
  resolveGenerationOptions, generationOutputBudget, buildGenerationSystemPrompt,
} from '../lib/generationOptions.js';
import { nextOutputBudget, responseWasTruncated } from '../../../shared/outputLimits.js';
import useEvalRuns from './useEvalRuns.js';
import useTestCases from './useTestCases.js';
import { applyProfilePreamble } from '../lib/projectProfiles.js';

const nowMs = () => typeof performance !== 'undefined' && typeof performance.now === 'function'
  ? performance.now() : Date.now();

function readStoredRoute() {
  try {
    const settings = JSON.parse(globalThis.localStorage?.getItem('pl2-provider-settings') || 'null') || {};
    const hosted = typeof import.meta !== 'undefined' && import.meta.env?.VITE_WEB_MODE === 'true';
    return activeProviderRoute(hosted ? { ...settings, provider: 'anthropic' } : settings);
  } catch {
    return activeProviderRoute({});
  }
}

const extensionRuntime = () => typeof chrome !== 'undefined' && typeof chrome.runtime?.sendMessage === 'function';

function resolveRoute() {
  if (extensionRuntime() && typeof getActiveProviderRoute === 'function') {
    return Promise.resolve(getActiveProviderRoute())
      .then((active) => (active?.provider && active?.model ? active : readStoredRoute()))
      .catch(() => readStoredRoute());
  }
  return readStoredRoute();
}

const CONTINUATION_INSTRUCTION = 'The JSON object above was cut off by the output limit. Continue from the exact cutoff. Output only the missing tail so concatenating it with the previous output yields one JSON object. Do not repeat earlier text and do not add a Markdown fence.';

export { CONTINUATION_INSTRUCTION };

/** Execution controller for enhance and evaluate flows. */
export default function useExecutionFlow({ ui, lib, editor, persistence, profileSendRef }) {
  const { notify, setTab, tab } = ui;
  const { options: generationOptions } = useGenerationOptions();
  const {
    raw, enhanced, variants, notes, enhMode,
    setRaw, setEnhanced, setVariants, setNotes, setResultMeta,
  } = editor;
  const { editingId, saveTitle, setSaveTitle, setSaveTags, setShowSave, setShowDiff } = persistence;

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const preflight = useSensitivePreflight();
  const [streamPreview, setStreamPreview] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [optimisticSaveVisible, setOptimisticSaveVisible] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ active: false, completed: 0, total: 0, currentLabel: '' });
  const batchAbortRef = useRef(null);
  const currentEditingIdRef = useRef(editingId);
  currentEditingIdRef.current = editingId;
  useEffect(() => () => batchAbortRef.current?.abort(), []);
  const enhanceReqRef = useRef(0);
  const enhanceAbortRef = useRef(null);
  const continuationRef = useRef(null);
  // Synchronous guard prevents duplicate sends before React updates loading.
  const enhanceInFlightRef = useRef(false);
  // REVIEW-2026-11-25 High: typing during generation must not cancel it, so
  // the editor text is not part of the owner. A run belongs to the prompt,
  // mode and options it started with; switching any of those still aborts.
  // When the draft changes mid-run, the result is applied and marked stale.
  const ownerKey = JSON.stringify([editingId, enhMode, generationOptions]);
  const ownerRef = useRef(ownerKey);
  ownerRef.current = ownerKey;
  // A sensitive-data approval covers the exact draft it reviewed, so an edit
  // still revokes a pending approval.
  const draftKey = JSON.stringify([raw, ownerKey]);
  const draftRef = useRef(draftKey);
  draftRef.current = draftKey;
  const rawRef = useRef(raw);
  rawRef.current = raw;
  const [resultStale, setResultStale] = useState(false);

  useEffect(() => {
    preflight.invalidate();
  }, [draftKey]);

  useEffect(() => {
    return () => {
      enhanceReqRef.current += 1;
      enhanceInFlightRef.current = false;
      enhanceAbortRef.current?.abort();
      enhanceAbortRef.current = null;
    };
  }, [ownerKey]);

  useEffect(() => {
    setLoading(false);
    setStreaming(false);
    setStreamPreview('');
    setOptimisticSaveVisible(false);
  }, [ownerKey]);

  const evalRunsHook = useEvalRuns({ editingId, tab, defaultMode: 'enhance' });
  const testCasesHook = useTestCases({ notify });

  const callWithRetry = async (payload, retries = 1, options = {}) => {
    let attempt = 0;
    let lastError = null;
    while (attempt <= retries) {
      try {
        return await callModel(payload, options);
      } catch (caught) {
        if (options?.signal?.aborted || caught?.name === 'AbortError') throw caught;
        // Partial output is already billable; never silently retry it.
        if (caught?.partialText) throw caught;
        lastError = caught;
        if (attempt >= retries || !isTransientError(caught)) break;
        await new Promise(resolve => setTimeout(resolve, 350 * (attempt + 1)));
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

  const buildEnhancePayloadFor = (inputText, modeId = enhMode, overrides = {}, route = {}) => {
    const options = resolveGenerationOptions(modeId, { ...generationOptions, ...overrides });
    return {
      model: DEFAULT_ENHANCE_MODEL,
      max_tokens: generationOutputBudget(inputText, options, {
        provider: route.provider || 'anthropic',
        model: route.model || DEFAULT_ENHANCE_MODEL,
      }),
      temperature: DEFAULT_ENHANCE_TEMPERATURE,
      system: buildGenerationSystemPrompt(options, ALL_TAGS),
      messages: [{ role: 'user', content: inputText }],
      responseFormat: 'json',
    };
  };
  const buildEnhancePayload = (modeId = enhMode) => buildEnhancePayloadFor(raw, modeId);
  const withProfile = (payload) => applyProfilePreamble(payload, profileSendRef?.current?.profile, {
    disabled: Boolean(profileSendRef?.current?.disabled),
  }).payload;

  const runTestCaseJob = async (testCase, promptTitle, signal) => {
    const inputText = ensureString(testCase?.input);
    const pendingRoute = resolveRoute();
    const route = pendingRoute && typeof pendingRoute.then === 'function' ? await pendingRoute : pendingRoute;
    const payload = withProfile(buildEnhancePayloadFor(inputText, enhMode, {}, route));
    const startedAt = nowMs();
    const { matches } = scanSensitiveData({ payload });
    if (matches.length > 0) {
      const message = `PII gate blocked test case: ${testCase.title}`;
      await saveEvalRun({
        promptId: testCase.promptId, promptTitle, mode: 'test-case', provider: 'blocked',
        model: payload.model || 'unknown', variantLabel: testCase.title, input: inputText,
        output: message, latencyMs: nowMs() - startedAt, status: 'blocked',
        notes: 'Sensitive data detected before send.', testCaseId: testCase.id,
      }).catch(error => logWarn('save blocked test case run', error));
      throw normalizeError(new Error(message), 'execution');
    }
    let data;
    let configured = null;
    try {
      try { [configured] = await getConfiguredProviders(); } catch { /* Unknown routing is recorded honestly. */ }
      signal?.throwIfAborted();
      data = await callWithRetry(payload, 1, { signal });
      signal?.throwIfAborted();
    } catch (caught) {
      const cancelled = signal?.aborted || caught?.name === 'AbortError';
      await saveEvalRun({
        promptId: testCase.promptId, promptTitle, mode: 'test-case',
        provider: data?.provider || configured?.provider || 'unknown', model: data?.model || configured?.model || 'unknown',
        variantLabel: testCase.title, input: inputText, testCaseId: testCase.id,
        output: cancelled ? 'Test case cancelled.' : 'Test case request failed.',
        status: cancelled ? 'canceled' : 'error', latencyMs: nowMs() - startedAt,
        notes: 'Incomplete attempt; excluded from completed suite results.',
      }).catch(error => logWarn('save incomplete test case run', error));
      throw caught;
    }
    const text = extractTextFromAnthropic(data);
    const parsed = parseEnhancedPayload(text, { modern: true, truncated: responseWasTruncated(data) });
    const outcome = testCaseOutcome(parsed);
    if (!outcome.complete) {
      await saveEvalRun({
        promptId: testCase.promptId, promptTitle, mode: 'test-case',
        provider: data?.provider || 'unknown', model: data?.model || payload.model || 'unknown',
        variantLabel: testCase.title, input: inputText, output: outcome.output,
        latencyMs: nowMs() - startedAt, status: 'error', notes: outcome.notes, testCaseId: testCase.id,
        requestedOutputTokens: payload.max_tokens,
      }).catch(error => logWarn('save partial test case run', error));
      return { parsed, traitResults: outcome.traitResults };
    }
    const traitResults = checkTraits(outcome.output, testCase.expectedTraits, testCase.expectedExclusions);
    await saveEvalRun({
      promptId: testCase.promptId, promptTitle, mode: 'test-case',
      provider: data?.provider || 'unknown', model: data?.model || payload.model || 'unknown',
      variantLabel: testCase.title, input: inputText, output: outcome.output,
      latencyMs: nowMs() - startedAt, notes: parsed.notes || '', testCaseId: testCase.id,
      traitResults, verdict: traitResults.verdict, requestedOutputTokens: payload.max_tokens,
    }).catch(error => logWarn('save test case run', error));
    return { parsed, traitResults };
  };

  const enhance = async (overridePayload, meta) => {
    if (!raw.trim() || enhanceInFlightRef.current) return;
    const safeOverridePayload = overridePayload && typeof overridePayload === 'object' && 'nativeEvent' in overridePayload
      ? null : overridePayload;
    const enhanceModeId = meta?.modeId || enhMode;
    const options = resolveGenerationOptions(enhanceModeId, { ...generationOptions, ...meta?.options });
    const pendingRoute = resolveRoute();
    const route = pendingRoute && typeof pendingRoute.then === 'function' ? await pendingRoute : pendingRoute;
    let payload = withProfile(safeOverridePayload || buildEnhancePayloadFor(raw, enhanceModeId, meta?.options, route));
    if (meta?.retryLarger || meta?.continue) {
      const basis = continuationRef.current?.maxTokens || payload.max_tokens;
      payload = { ...payload, max_tokens: nextOutputBudget(basis, route.provider, route.model) };
    }
    if (meta?.continue && continuationRef.current?.prefix) {
      payload = {
        ...payload,
        continuationPrefix: continuationRef.current.prefix,
        messages: [
          { role: 'user', content: raw },
          { role: 'assistant', content: continuationRef.current.prefix },
          { role: 'user', content: CONTINUATION_INSTRUCTION },
        ],
      };
    }
    const payloadSource = payload?.messages?.find(message => message?.role === 'user')?.content;
    const sentSource = ensureString(meta?.evaluatedSource) || ensureString(payloadSource) || ensureString(raw);
    const reviewed = preflight.review({
      payload, scope: 'enhance', label: `Enhance (${enhanceModeId})`,
      isCurrent: () => draftRef.current === draftKey,
      resume: approvedPayload => executeEnhance(approvedPayload, enhanceModeId, options, sentSource),
    });
    if (!reviewed.payload) {
      await saveEvalRun({
        promptId: editingId,
        promptTitle: (saveTitle || suggestTitleFromText(raw)).trim() || suggestTitleFromText(raw),
        mode: 'enhance', enhanceMode: enhanceModeId, provider: 'blocked',
        model: payload?.model || 'unknown', input: sentSource,
        output: 'Prompt blocked before send due to sensitive data detection.',
        latencyMs: 0, status: 'blocked', notes: 'Sensitive data detected before send.',
      }).then(() => evalRunsHook.refreshEvalRuns(editingId)).catch(caught => logWarn('save blocked eval run', caught));
      return;
    }
    return executeEnhance(reviewed.payload, enhanceModeId, options, sentSource);
  };

  // Only review() and its private one-use continuation enter this function.
  const executeEnhance = async (payload, enhanceModeId, options, sentSource) => {
    if (enhanceInFlightRef.current || ownerRef.current !== ownerKey) return;
    const recordedInput = ensureString(sentSource)
      || ensureString(payload?.messages?.find(message => message?.role === 'user')?.content)
      || ensureString(raw);
    enhanceInFlightRef.current = true;
    const draftAtSend = raw;
    setResultStale(false);
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
    // Keep the last complete result while a retry runs. Replace atomically on success.
    setOptimisticSaveVisible(true);
    setShowSave(false);
    setShowDiff(false);
    let qualityGateFailure = null;
    let executionProvider = 'unknown';
    let executionModel = payload?.model || 'unknown';
    let accumulatedUsage = null;
    try {
      if (import.meta.env?.VITE_WEB_MODE === 'true') {
        const [configured] = await getConfiguredProviders();
        executionProvider = configured?.provider || executionProvider;
        executionModel = configured?.model || executionModel;
      }
      const streamOptions = {
        signal: abortController?.signal,
        onChunk: (chunk, fullText) => {
          if (reqId !== enhanceReqRef.current) return;
          setStreaming(true);
          setStreamPreview(fullText || chunk || '');
        },
      };
      const continuationPrefix = ensureString(payload?.continuationPrefix);
      const wirePayload = { ...payload };
      delete wirePayload.continuationPrefix;
      let data = await callWithRetry(wirePayload, 1, streamOptions);
      if (reqId !== enhanceReqRef.current) return;
      executionProvider = data?.provider || executionProvider;
      executionModel = data?.model || executionModel;
      accumulatedUsage = combineTokenUsage(data?.usage);
      const streamedText = data?.content?.[0]?.text;
      const rawPiece = typeof streamedText === 'string' ? streamedText : extractTextFromAnthropic(data);
      let txt = continuationPrefix ? stitchContinuation(continuationPrefix, rawPiece) : extractTextFromAnthropic(data);
      const acceptPartial = (parsedResult, sourceText, response) => {
        const usage = accumulatedUsage;
        const partialMeta = normalizeResultMeta({
          ...parsedResult,
          schema_version: 2,
          primary_id: parsedResult.primary_id || options.strategy,
          requestedOutputTokens: payload.max_tokens,
          partial: true,
          metadataIncomplete: true,
          provider: response?.provider || executionProvider,
          model: response?.model || executionModel,
          latencyMs: nowMs() - startedAt,
          usage,
        }, { enhanced: parsedResult.enhanced, variants: parsedResult.variants });
        setEnhanced(parsedResult.enhanced || '');
        setVariants(parsedResult.variants || []);
        setResultMeta?.(partialMeta);
        setNotes(parsedResult.notes || 'Partial result. The response was cut off at the output limit.');
        setSaveTags(parsedResult.tags || []);
        const partialTitle = suggestTitleFromText(parsedResult.enhanced || raw);
        setSaveTitle(current => ensureString(current).trim() ? current : partialTitle);
        setStreamPreview('');
        setStreaming(false);
        continuationRef.current = { prefix: sourceText, maxTokens: payload.max_tokens };
        const cutOffError = truncationError('Structured output ended inside a string at the output limit.');
        cutOffError.salvagedText = parsedResult.enhanced;
        throw cutOffError;
      };
      let parsed;
      try {
        parsed = parseEnhancedPayload(txt, { modern: true, truncated: responseWasTruncated(data) });
      } catch (parseErr) {
        continuationRef.current = { prefix: txt, maxTokens: payload.max_tokens };
        const err = responseWasTruncated(data) ? truncationError(parseErr?.message) : parseErr;
        err.partialText = txt;
        throw err;
      }
      if (parsed.partial === true) acceptPartial(parsed, txt, data);
      let correctionUsed = false;
      let qualityAssessment = assessEnhancementQuality(recordedInput, parsed);
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
        let corrected;
        try {
          corrected = parseEnhancedPayload(correctionText, { modern: true, truncated: responseWasTruncated(correctionData) });
        } catch (parseErr) {
          const err = responseWasTruncated(correctionData) ? truncationError(parseErr?.message) : parseErr;
          err.partialText = correctionText;
          throw err;
        }
        if (corrected.partial === true) acceptPartial(corrected, correctionText, correctionData);
        qualityAssessment = assessEnhancementQuality(recordedInput, corrected);
        if (!qualityAssessment.passed) {
          qualityGateFailure = qualityAssessment;
          throw new AppError({
            category: ErrorCategory.PROVIDER,
            userMessage: 'The model could not produce a meaningful improvement after one corrective pass. Your draft and previous result are still here. Try another mode or run again.',
            debugMessage: `Enhancement quality gate failed: ${qualityAssessment.failures.join(', ')}`,
            retryable: true, source: 'enhancement-quality',
          });
        }
        data = correctionData;
        txt = correctionText;
        parsed = corrected;
        qualityGateFailure = null;
      }
      continuationRef.current = null;
      const latencyMs = nowMs() - startedAt;
      const runId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID() : `enhance-${Date.now()}`;
      const nextResultMeta = normalizeResultMeta({
        ...parsed,
        schema_version: 2,
        primary_id: options.strategy,
        requestedOutputTokens: payload.max_tokens,
        assumptions: parsed.assumptionDetails || parsed.assumptions,
        reversibleEdits: parsed.reversibleEdits,
        provider: executionProvider, model: executionModel, latencyMs, usage: accumulatedUsage, runId,
      }, { enhanced: parsed.enhanced, variants: parsed.variants });
      setEnhanced(parsed.enhanced || '');
      setVariants(parsed.variants || []);
      setResultMeta?.(nextResultMeta);
      const assumptions = parsed.assumptions || [];
      const qualityNote = correctionUsed
        ? 'Quality check: Prompt Lab rejected the first result as a no-op or unsupported near-no-op and used one corrective pass.' : '';
      const notesText = [parsed.notes || '', qualityNote].filter(Boolean).join('\n\n');
      const assumptionBlock = assumptions.length > 0
        ? `\n\nAssumptions added:\n${assumptions.map(a => `• ${a.text || a}`).join('\n')}` : '';
      setNotes(notesText + assumptionBlock);
      setSaveTags(parsed.tags || []);
      const nextTitle = suggestTitleFromText(parsed.enhanced || raw);
      setSaveTitle(current => ensureString(current).trim() ? current : nextTitle);
      const goldenEntry = editingId ? lib.library.find(entry => entry.id === editingId) : null;
      const goldenText = goldenEntry?.goldenResponse?.text || '';
      const goldenScore = goldenText && (parsed.enhanced || txt) ? ngramSimilarity(goldenText, parsed.enhanced || txt) : null;
      const goldenThreshold = resolveGoldenThreshold(goldenEntry);
      saveEvalRun({
        id: runId, promptId: editingId, promptTitle: (saveTitle || nextTitle).trim() || nextTitle,
        mode: 'enhance', enhanceMode: enhanceModeId, provider: executionProvider, model: executionModel,
        input: recordedInput, output: parsed.enhanced || txt, latencyMs, notes: notesText,
        schemaVersion: nextResultMeta.schemaVersion, primaryId: nextResultMeta.primaryId,
        requestedOutputTokens: nextResultMeta.requestedOutputTokens,
        metadataIncomplete: nextResultMeta.metadataIncomplete,
        candidates: nextResultMeta.candidates, selectedCandidateId: nextResultMeta.selectedCandidateId,
        changeSummary: nextResultMeta.changeSummary, changes: nextResultMeta.changes,
        assumptions: nextResultMeta.assumptions, reversibleEdits: nextResultMeta.reversibleEdits,
        reasoning: nextResultMeta.reasoning, tags: nextResultMeta.tags, usage: nextResultMeta.usage,
        goldenScore, regression: isGoldenRegression(goldenScore, goldenThreshold),
      }).then(() => evalRunsHook.refreshEvalRuns(editingId)).catch(caught => logWarn('save eval run', caught));
      setShowSave(false);
      setOptimisticSaveVisible(false);
      setStreamPreview('');
      setStreaming(false);
      if (rawRef.current !== draftAtSend) {
        setResultStale(true);
        notify('Draft changed since this run. The result is from the earlier draft; run again to include your edits.');
      }
    } catch (caught) {
      if (caught?.name === 'AbortError' || abortController?.signal?.aborted) {
        saveEvalRun({
          promptId: editingId,
          promptTitle: (saveTitle || suggestTitleFromText(raw)).trim() || suggestTitleFromText(raw),
          mode: 'enhance', enhanceMode: enhanceModeId, provider: executionProvider, model: executionModel,
          input: recordedInput, output: 'Enhance cancelled before completion.', latencyMs: nowMs() - startedAt,
          status: 'canceled', usage: accumulatedUsage,
        }).then(() => evalRunsHook.refreshEvalRuns(editingId)).catch(err => logWarn('save canceled eval run', err));
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
        setStreaming(false);
        const appError = normalizeError(caught, 'execution');
        if (!caught?.salvagedText && caught?.partialText) setStreamPreview(caught.partialText);
        setError(appError);
        saveEvalRun({
          promptId: editingId,
          promptTitle: (saveTitle || suggestTitleFromText(raw)).trim() || suggestTitleFromText(raw),
          mode: 'enhance', enhanceMode: enhanceModeId, provider: executionProvider, model: executionModel,
          input: recordedInput, output: caught?.salvagedText || caught?.partialText || appError.userMessage || appError.message || 'Enhance failed.',
          latencyMs: nowMs() - startedAt, status: 'error', usage: accumulatedUsage,
          notes: [appError.category ? `Error category: ${appError.category}` : '',
            qualityGateFailure?.failures?.length ? `Quality gate: ${qualityGateFailure.failures.join(', ')}` : '',
          ].filter(Boolean).join('\n'),
        }).then(() => evalRunsHook.refreshEvalRuns(editingId)).catch(err => logWarn('save failed eval run', err));
      }
    } finally {
      if (enhanceAbortRef.current === abortController) enhanceAbortRef.current = null;
      if (reqId === enhanceReqRef.current) {
        enhanceInFlightRef.current = false;
        setLoading(false);
      }
    }
  };

  const enhanceWithMode = async modeId => {
    if (!raw.trim()) return;
    return enhance(buildEnhancePayload(modeId), { modeId });
  };
  const cancelEnhance = () => {
    enhanceReqRef.current += 1;
    // Release synchronously so cancel-then-retry does not wait for the old request.
    enhanceInFlightRef.current = false;
    enhanceAbortRef.current?.abort();
    enhanceAbortRef.current = null;
    setLoading(false);
    setStreaming(false);
    setStreamPreview('');
    setError(null);
    notify('Generation cancelled.');
  };
  const loadCaseIntoEditor = testCase => {
    setRaw(testCase.input || '');
    setTab('editor');
    notify(`Loaded test case: ${testCase.title}`);
  };
  const cancelBatch = () => {
    batchAbortRef.current?.abort();
  };
  const executeCases = async (cases, promptId, promptTitle, recordSuite) => {
    if (!cases.length || batchAbortRef.current || testCasesHook.runningCases) return;
    const controller = new AbortController();
    batchAbortRef.current = controller;
    testCasesHook.setRunningCases(true);
    let completed = 0;
    let passed = 0;
    let failed = 0;
    let interrupted = false;
    const progress = (active, currentLabel = '') => ({
      active, completed, failed, total: cases.length, currentLabel,
      status: active ? 'running' : controller.signal.aborted ? 'cancelled' : interrupted ? 'failed' : 'completed',
    });
    try {
      for (const testCase of cases) {
        if (controller.signal.aborted) break;
        setBatchProgress(progress(true, testCase.title));
        try {
          const { traitResults } = await runTestCaseJob(testCase, promptTitle, controller.signal);
          completed += 1;
          if (traitResults?.verdict === 'pass') passed += 1;
          if (traitResults?.verdict === 'fail') failed += 1;
        } catch (caught) {
          if (controller.signal.aborted) break;
          completed += 1;
          failed += 1;
          logWarn('test case batch request failed', caught);
        }
        setBatchProgress(progress(true));
      }
      if (recordSuite) {
        await lib.recordSuiteResult?.(promptId, {
          verdict: controller.signal.aborted ? null : failed > 0 ? 'fail' : passed > 0 ? 'pass' : null,
          status: controller.signal.aborted ? 'canceled' : 'completed',
          passed, failed, completed, total: cases.length, lastRunAt: new Date().toISOString(),
        });
      }
      if (currentEditingIdRef.current === promptId) {
        await evalRunsHook.refreshEvalRuns(promptId);
        evalRunsHook.setShowEvalHistory(true);
      }
    } catch (caught) {
      interrupted = true;
      logWarn('test case batch completion failed', caught);
    } finally {
      if (batchAbortRef.current === controller) batchAbortRef.current = null;
      testCasesHook.setRunningCases(false);
      setBatchProgress(progress(false));
      notify(`${controller.signal.aborted ? 'Batch stopped' : interrupted ? 'Batch interrupted' : 'Batch finished'}: ${completed}/${cases.length} completed, ${failed} failed.`);
    }
  };
  const runSingleCase = (testCase, promptTitle) => executeCases([testCase], testCase.promptId, promptTitle, false);
  const runAllCases = () => {
    if (!editingId) return;
    const cases = [...(testCasesHook.testCasesByPrompt[editingId] || [])];
    return executeCases(cases, editingId, saveTitle || suggestTitleFromText(enhanced || raw), true);
  };
  const clearExecutionState = () => {
    batchAbortRef.current?.abort();
    enhanceReqRef.current += 1;
    enhanceInFlightRef.current = false;
    enhanceAbortRef.current?.abort();
    enhanceAbortRef.current = null;
    setLoading(false);
    setError(null);
    preflight.invalidate();
    setStreamPreview('');
    setStreaming(false);
    setOptimisticSaveVisible(false);
    setBatchProgress({ active: false, completed: 0, total: 0, currentLabel: '' });
    setResultMeta?.(null);
    setResultStale(false);
  };
  const currentTestCases = editingId ? (testCasesHook.testCasesByPrompt[editingId] || []) : [];
  return {
    loading, error, resultStale, piiWarning: preflight.piiWarning, streamPreview, streaming, optimisticSaveVisible, batchProgress,
    piiSendAnyway: preflight.piiSendAnyway, piiRedactAndSend: preflight.piiRedactAndSend, piiCancel: preflight.piiCancel,
    buildEnhancePayloadFor, buildEnhancePayload, enhance, enhanceWithMode,
    evalRuns: evalRunsHook.evalRuns, showEvalHistory: evalRunsHook.showEvalHistory,
    setShowEvalHistory: evalRunsHook.setShowEvalHistory, refreshEvalRuns: evalRunsHook.refreshEvalRuns,
    updateEvalRun: evalRunsHook.updateRun,
    testCasesByPrompt: testCasesHook.testCasesByPrompt, caseFormPromptId: testCasesHook.caseFormPromptId,
    editingCaseId: testCasesHook.editingCaseId, caseTitle: testCasesHook.caseTitle, setCaseTitle: testCasesHook.setCaseTitle,
    caseInput: testCasesHook.caseInput, setCaseInput: testCasesHook.setCaseInput,
    caseTraits: testCasesHook.caseTraits, setCaseTraits: testCasesHook.setCaseTraits,
    caseExclusions: testCasesHook.caseExclusions, setCaseExclusions: testCasesHook.setCaseExclusions,
    caseNotes: testCasesHook.caseNotes, setCaseNotes: testCasesHook.setCaseNotes,
    runningCases: testCasesHook.runningCases, openCaseForm: testCasesHook.openCaseForm,
    resetCaseForm: testCasesHook.resetCaseForm, saveCaseForPrompt: testCasesHook.saveCaseForPrompt,
    removeCase: testCasesHook.removeCase, loadCaseIntoEditor, runSingleCase, runAllCases, cancelBatch, cancelEnhance,
    currentTestCases, openOptions: openSettings, clearExecutionState,
  };
}
