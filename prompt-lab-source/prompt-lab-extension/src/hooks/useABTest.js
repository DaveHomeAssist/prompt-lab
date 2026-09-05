import { useEffect, useRef, useState } from 'react';
import { callModel } from '../api.js';
import { extractTextFromAnthropic, isTransientError } from '../promptUtils.js';
import { listEvalRuns, listExperiments, saveEvalRun, saveExperiment } from '../experimentStore.js';
import { logWarn } from '../lib/logger.js';
import { hashText } from '../lib/utils.js';
import useSensitivePreflight from './useSensitivePreflight.js';
import { RECORDS_CHANGED_EVENT } from '../lib/writeRecovery.js';

const EMPTY_VARIANT = { prompt: '', response: '', loading: false, error: false };
const EXTRA_LABELS = ['C', 'D', 'E'];

export default function useABTest({ notify }) {
  const [abA, updateAbA] = useState(EMPTY_VARIANT);
  const [abB, updateAbB] = useState(EMPTY_VARIANT);
  const [extraVariants, setExtraVariants] = useState([]);
  // Per-side provider/model selection; null = the settings-default provider.
  const [abProviders, setAbProviders] = useState({ a: null, b: null });
  // Library entry each side was loaded from, so arena runs land in prompt-scoped history.
  const [abSource, setAbSource] = useState({ a: null, b: null });
  const [abWinner, setAbWinner] = useState(null);
  const [history, setHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [evalRuns, setEvalRuns] = useState([]);
  const [showRuns, setShowRuns] = useState(false);
  const [activeSide, setActiveSide] = useState('A');
  const attempts = useRef({});
  const preflight = useSensitivePreflight();
  const experimentIdRef = useRef(null);

  const variants = [
    { id: 'a', label: 'A', ...abA },
    { id: 'b', label: 'B', ...abB },
    ...extraVariants,
  ];

  const variantsRef = useRef(variants);
  variantsRef.current = variants;
  const getVariant = (side) => variantsRef.current.find((variant) => variant.id === String(side).toLowerCase());

  const updateVariant = (side, updater) => {
    const id = String(side).toLowerCase();
    if (id === 'a' || id === 'b') {
      const setter = id === 'a' ? updateAbA : updateAbB;
      return setter(prev => {
        const { id: ignoredId, label: ignoredLabel, ...next } = typeof updater === 'function' ? updater(prev) : updater;
        return next;
      });
    }
    setExtraVariants((prev) => prev.map((variant) => {
      if (variant.id !== id) return variant;
      const next = typeof updater === 'function' ? updater(variant) : updater;
      return { ...next, id: variant.id, label: variant.label };
    }));
    return undefined;
  };

  const invalidate = (id) => {
    attempts.current[id]?.controller.abort();
    delete attempts.current[id];
    preflight.invalidate(id);
  };
  const setVariant = (side, updater) => {
    const id = String(side).toLowerCase();
    const prior = getVariant(id);
    if (!prior) return;
    const next = { ...(typeof updater === 'function' ? updater(prior) : updater) };
    if (next.prompt !== prior.prompt) {
      invalidate(id);
      Object.assign(next, { response: next.response === prior.response ? '' : next.response, loading: false, error: false });
      setAbWinner(null);
    }
    variantsRef.current = variantsRef.current.map(variant => variant.id === id ? { ...next, id, label: prior.label } : variant);
    updateVariant(id, next);
  };
  const setAbA = updater => setVariant('a', updater);
  const setAbB = updater => setVariant('b', updater);

  useEffect(() => () => {
    Object.values(attempts.current).forEach(attempt => attempt.controller.abort());
    attempts.current = {};
  }, []);

  useEffect(() => {
    const refresh = () => {
      listExperiments().then(setHistory).catch((e) => logWarn('load experiments', e));
      listEvalRuns({ mode: 'ab', limit: 12 }).then(setEvalRuns).catch((e) => logWarn('load eval runs', e));
    };
    refresh();
    window.addEventListener(RECORDS_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(RECORDS_CHANGED_EVENT, refresh);
  }, []);

  const nowMs = () => (typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now());

  const refreshEvalRuns = async () => {
    try {
      setEvalRuns(await listEvalRuns({ mode: 'ab', limit: 12 }));
    } catch (e) {
      logWarn('refresh eval runs', e);
      setEvalRuns([]);
    }
  };

  const callWithRetry = async (payload, signal, retries = 1) => {
    let attempt = 0;
    let lastError = null;
    while (attempt <= retries) {
      try {
        signal.throwIfAborted();
        return await callModel(payload, { signal });
      } catch (error) {
        if (signal.aborted || error.name === 'AbortError' || error.partialText) throw error;
        lastError = error;
        if (attempt >= retries || !isTransientError(error)) break;
        await new Promise(resolve => setTimeout(resolve, 350 * (attempt + 1)));
      }
      attempt += 1;
    }
    throw lastError || new Error('Request failed.');
  };

  const runAB = async (side) => {
    const id = String(side).toLowerCase();
    const state = getVariant(id);
    if (!state?.prompt.trim() || attempts.current[id]?.running) return;
    invalidate(id);
    const attempt = { controller: new AbortController(), running: false };
    attempts.current[id] = attempt;
    const selection = abProviders[id] ? { ...abProviders[id] } : null;
    const source = abSource[id] ? { ...abSource[id] } : null;
    const payload = {
      model: selection?.model || 'claude-sonnet-4-6', max_tokens: 800,
      messages: [{ role: 'user', content: state.prompt }],
      ...(selection?.provider ? { provider: selection.provider } : {}),
    };
    const isCurrent = () => attempts.current[id] === attempt && !attempt.controller.signal.aborted;
    const execute = async (approvedPayload) => {
      if (!isCurrent() || attempt.running) return;
      attempt.running = true;
      const startedAt = nowMs();
      const setter = updater => updateVariant(id, updater);
      setter(prev => ({ ...prev, loading: true, response: '', error: false }));
      try {
        const data = await callWithRetry(approvedPayload, attempt.controller.signal);
        if (!isCurrent()) return;
        const responseText = extractTextFromAnthropic(data);
        setter(prev => ({ ...prev, response: responseText, loading: false, error: false }));
        await saveEvalRun({
          promptId: source?.entryId || null,
          promptTitle: source?.title || `A/B Variant ${id.toUpperCase()}`,
          mode: 'ab',
          provider: data?.provider || selection?.provider || 'unknown',
          model: data?.model || selection?.model || 'unknown',
          variantLabel: `Variant ${id.toUpperCase()}`,
          input: approvedPayload.messages[0].content,
          output: responseText,
          latencyMs: nowMs() - startedAt,
        }).catch((error) => {
          logWarn('save arena run', error);
          notify('Response complete, but run history was not saved. Retry saving records.');
        });
        refreshEvalRuns();
      } catch (error) {
        if (!isCurrent()) return;
        setter(prev => ({ ...prev, response: error.message || 'Request failed.', loading: false, error: true }));
      } finally {
        if (attempts.current[id] === attempt) delete attempts.current[id];
      }
    };
    const reviewed = preflight.review({ payload, scope: id, label: `Arena Variant ${id.toUpperCase()}`, isCurrent, resume: execute });
    if (reviewed.payload) return execute(reviewed.payload);
  };

  const resetAB = () => {
    experimentIdRef.current = null;
    Object.keys(attempts.current).forEach(invalidate);
    preflight.invalidate();
    updateAbA(EMPTY_VARIANT);
    updateAbB(EMPTY_VARIANT);
    setExtraVariants([]);
    setAbProviders({ a: null, b: null });
    setAbSource({ a: null, b: null });
    setAbWinner(null);
  };

  const setSideProvider = (side, descriptor) => {
    const id = String(side).toLowerCase();
    invalidate(id);
    updateVariant(id, prev => ({ ...prev, response: '', loading: false, error: false }));
    setAbProviders(prev => ({ ...prev, [id]: descriptor || null }));
  };

  const loadVariant = (side, prompt, source = null) => {
    const id = String(side).toLowerCase();
    const setter = (updater) => setVariant(id, updater);
    const nextPrompt = typeof prompt === 'string' ? prompt : '';
    invalidate(id);
    setAbSource(prev => ({ ...prev, [id]: source }));
    setter((prev) => ({
      ...prev,
      prompt: nextPrompt,
      response: '',
      loading: false,
      error: false,
    }));
    setAbWinner(null);
    setActiveSide(id.toUpperCase());
  };

  const addVariant = () => {
    if (variants.length >= 5) return false;
    const label = EXTRA_LABELS.find((candidate) => !extraVariants.some((variant) => variant.label === candidate));
    const id = label.toLowerCase();
    setExtraVariants((prev) => [...prev, { id, label, ...EMPTY_VARIANT }]);
    setAbProviders((prev) => ({ ...prev, [id]: null }));
    setAbSource((prev) => ({ ...prev, [id]: null }));
    invalidate(id);
    setActiveSide(label);
    return true;
  };

  const removeVariant = (side) => {
    const id = String(side).toLowerCase();
    if (id === 'a' || id === 'b') return false;
    invalidate(id);
    setExtraVariants((prev) => prev.filter((variant) => variant.id !== id));
    setAbProviders((prev) => { const next = { ...prev }; delete next[id]; return next; });
    setAbSource((prev) => { const next = { ...prev }; delete next[id]; return next; });
    setActiveSide('A');
    return true;
  };

  const runAll = () => Promise.all(variants.filter((variant) => variant.prompt.trim()).map((variant) => runAB(variant.id)));

  const pickWinner = async (side) => {
    const winnerLabel = `Variant ${side}`;
    setAbWinner(winnerLabel);
    try {
      const snapshotKey = JSON.stringify(variants.map(({ id, prompt, response }) => ({ id, prompt, response })));
      if (experimentIdRef.current?.snapshotKey !== snapshotKey) {
        experimentIdRef.current = { id: crypto.randomUUID(), snapshotKey };
      }
      const record = {
        id: experimentIdRef.current.id,
        createdAt: new Date().toISOString(),
        label: `${variants.length === 2 ? 'A/B' : 'Arena'}: ${variants[0]?.prompt.slice(0, 40) || 'Untitled'}`,
        variants: variants.map((variant) => ({
          id: variant.label,
          promptHash: hashText(variant.prompt),
          prompt: variant.prompt,
          response: variant.response,
        })),
        keyInputSnapshot: JSON.stringify(Object.fromEntries(variants.map((variant) => [`${variant.id}Prompt`, variant.prompt.slice(0, 280)]))),
        outcome: { winnerVariantId: side },
        notes: '',
      };
      await saveExperiment(record);
      setHistory(await listExperiments());
      notify('Experiment saved');
    } catch (e) {
      logWarn('save experiment', e);
      notify('Experiment was not saved. Retry saving records.');
    }
  };

  const promoteToGolden = (side, pinGoldenResponse) => {
    const id = String(side).toLowerCase();
    const variant = getVariant(id);
    const source = abSource[id];
    if (!variant?.response?.trim() || !source?.entryId || typeof pinGoldenResponse !== 'function') return false;
    return pinGoldenResponse(source.entryId, {
      text: variant.response,
      provider: abProviders[id]?.provider,
      model: abProviders[id]?.model,
    });
  };

  return {
    piiWarning: preflight.piiWarning,
    piiSendAnyway: preflight.piiSendAnyway,
    piiRedactAndSend: preflight.piiRedactAndSend,
    piiCancel: preflight.piiCancel,
    abA,
    setAbA,
    abB,
    setAbB,
    abWinner,
    history,
    showHistory,
    setShowHistory,
    evalRuns,
    showRuns,
    setShowRuns,
    activeSide,
    setActiveSide,
    abProviders,
    setSideProvider,
    abSource,
    variants,
    setVariant,
    addVariant,
    removeVariant,
    runAll,
    promoteToGolden,
    loadVariant,
    runAB,
    resetAB,
    pickWinner,
  };
}
