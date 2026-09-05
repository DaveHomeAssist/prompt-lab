import { useEffect, useRef, useState } from 'react';
import { callModel } from '../api.js';
import { extractTextFromAnthropic, isTransientError } from '../promptUtils.js';
import { listEvalRuns, listExperiments, saveEvalRun, saveExperiment } from '../experimentStore.js';
import { logWarn } from '../lib/logger.js';
import { hashText } from '../lib/utils.js';
import { RECORDS_CHANGED_EVENT } from '../lib/writeRecovery.js';

const EMPTY_VARIANT = { prompt: '', response: '', loading: false, error: false };
const EXTRA_LABELS = ['C', 'D', 'E'];

export default function useABTest({ notify }) {
  const [abA, setAbA] = useState(EMPTY_VARIANT);
  const [abB, setAbB] = useState(EMPTY_VARIANT);
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
  const abReqRef = useRef({ a: 0, b: 0 });
  const experimentIdRef = useRef(null);

  const variants = [
    { id: 'a', label: 'A', ...abA },
    { id: 'b', label: 'B', ...abB },
    ...extraVariants,
  ];

  const getVariant = (side) => variants.find((variant) => variant.id === String(side).toLowerCase());

  const setVariant = (side, updater) => {
    const id = String(side).toLowerCase();
    if (id === 'a') return setAbA(updater);
    if (id === 'b') return setAbB(updater);
    setExtraVariants((prev) => prev.map((variant) => {
      if (variant.id !== id) return variant;
      const next = typeof updater === 'function' ? updater(variant) : updater;
      return { ...next, id: variant.id, label: variant.label };
    }));
    return undefined;
  };

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

  const callWithRetry = async (payload, retries = 1) => {
    let attempt = 0;
    let lastError = null;
    while (attempt <= retries) {
      try {
        return await callModel(payload);
      } catch (error) {
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
    const setter = (updater) => setVariant(id, updater);
    if (!state) return;
    if (abReqRef.current[id] == null) abReqRef.current[id] = 0;
    const reqId = abReqRef.current[id] + 1;
    abReqRef.current = { ...abReqRef.current, [id]: reqId };
    if (!state.prompt.trim()) return;
    const startedAt = nowMs();
    setter(prev => ({ ...prev, loading: true, response: '', error: false }));
    const selection = abProviders[id];
    const source = abSource[id];
    try {
      const data = await callWithRetry({
        model: selection?.model || 'claude-sonnet-4-6',
        max_tokens: 800,
        messages: [{ role: 'user', content: state.prompt }],
        ...(selection?.provider ? { provider: selection.provider } : {}),
      });
      if (abReqRef.current[id] !== reqId) return;
      const responseText = extractTextFromAnthropic(data);
      setter(prev => ({ ...prev, response: responseText, loading: false, error: false }));
      await saveEvalRun({
        promptId: source?.entryId || null,
        promptTitle: source?.title || `A/B Variant ${id.toUpperCase()}`,
        mode: 'ab',
        provider: data?.provider || selection?.provider || 'unknown',
        model: data?.model || selection?.model || 'unknown',
        variantLabel: `Variant ${id.toUpperCase()}`,
        input: state.prompt,
        output: responseText,
        latencyMs: nowMs() - startedAt,
      }).catch((error) => {
        logWarn('save arena run', error);
        notify('Response complete, but run history was not saved. Retry saving records.');
      });
      refreshEvalRuns();
    } catch (error) {
      if (abReqRef.current[id] !== reqId) return;
      setter(prev => ({ ...prev, response: error.message || 'Request failed.', loading: false, error: true }));
    }
  };

  const resetAB = () => {
    experimentIdRef.current = null;
    abReqRef.current = Object.fromEntries(Object.entries(abReqRef.current).map(([id, value]) => [id, value + 1]));
    setAbA(EMPTY_VARIANT);
    setAbB(EMPTY_VARIANT);
    setExtraVariants([]);
    setAbProviders({ a: null, b: null });
    setAbSource({ a: null, b: null });
    setAbWinner(null);
  };

  const setSideProvider = (side, descriptor) => {
    setAbProviders(prev => ({ ...prev, [side]: descriptor || null }));
  };

  const loadVariant = (side, prompt, source = null) => {
    const id = String(side).toLowerCase();
    const setter = (updater) => setVariant(id, updater);
    const nextPrompt = typeof prompt === 'string' ? prompt : '';
    abReqRef.current = { ...abReqRef.current, [id]: (abReqRef.current[id] || 0) + 1 };
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
    abReqRef.current = { ...abReqRef.current, [id]: 0 };
    setActiveSide(label);
    return true;
  };

  const removeVariant = (side) => {
    const id = String(side).toLowerCase();
    if (id === 'a' || id === 'b') return false;
    abReqRef.current = { ...abReqRef.current, [id]: (abReqRef.current[id] || 0) + 1 };
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
