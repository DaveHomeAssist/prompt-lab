import { useEffect, useRef, useState } from 'react';
import { callModel } from '../api.js';
import { extractTextFromAnthropic, isTransientError } from '../promptUtils.js';
import { listEvalRuns, listExperiments, saveEvalRun, saveExperiment } from '../experimentStore.js';
import { logWarn } from '../lib/logger.js';
import { hashText } from '../lib/utils.js';

const EMPTY_VARIANT = {
  prompt: '',
  response: '',
  loading: false,
  error: false,
  provider: '',
  model: '',
};

export default function useABTest({ notify }) {
  const [abA, setAbA] = useState(EMPTY_VARIANT);
  const [abB, setAbB] = useState(EMPTY_VARIANT);
  const [abWinner, setAbWinner] = useState(null);
  const [history, setHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [evalRuns, setEvalRuns] = useState([]);
  const [showRuns, setShowRuns] = useState(false);
  const [activeSide, setActiveSide] = useState('A');
  const abReqRef = useRef({ a: 0, b: 0 });

  useEffect(() => {
    listExperiments().then(setHistory).catch((e) => logWarn('load experiments', e));
  }, []);

  useEffect(() => {
    listEvalRuns({ mode: 'ab', limit: 12 }).then(setEvalRuns).catch((e) => logWarn('load eval runs', e));
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
    const state = side === 'a' ? abA : abB;
    const setter = side === 'a' ? setAbA : setAbB;
    const reqId = abReqRef.current[side] + 1;
    abReqRef.current = { ...abReqRef.current, [side]: reqId };
    if (!state.prompt.trim()) return;
    const startedAt = nowMs();
    setter(prev => ({ ...prev, loading: true, response: '', error: false, provider: '', model: '' }));
    try {
      const data = await callWithRetry({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 800,
        messages: [{ role: 'user', content: state.prompt }],
      });
      if (abReqRef.current[side] !== reqId) return;
      const responseText = extractTextFromAnthropic(data);
      setter(prev => ({
        ...prev,
        response: responseText,
        loading: false,
        error: false,
        provider: data?.provider || 'unknown',
        model: data?.model || 'unknown',
      }));
      await saveEvalRun({
        promptTitle: `A/B Variant ${side.toUpperCase()}`,
        mode: 'ab',
        provider: data?.provider || 'unknown',
        model: data?.model || 'unknown',
        variantLabel: `Variant ${side.toUpperCase()}`,
        input: state.prompt,
        output: responseText,
        latencyMs: nowMs() - startedAt,
      });
      refreshEvalRuns();
    } catch (error) {
      if (abReqRef.current[side] !== reqId) return;
      setter(prev => ({
        ...prev,
        response: error.message || 'Request failed.',
        loading: false,
        error: true,
        provider: '',
        model: '',
      }));
    }
  };

  const resetAB = () => {
    abReqRef.current = { a: abReqRef.current.a + 1, b: abReqRef.current.b + 1 };
    setAbA(EMPTY_VARIANT);
    setAbB(EMPTY_VARIANT);
    setAbWinner(null);
  };

  const loadVariant = (side, prompt) => {
    const setter = side === 'a' ? setAbA : setAbB;
    const nextPrompt = typeof prompt === 'string' ? prompt : '';
    abReqRef.current = { ...abReqRef.current, [side]: abReqRef.current[side] + 1 };
    setter((prev) => ({
      ...prev,
      prompt: nextPrompt,
      response: '',
      loading: false,
      error: false,
      provider: '',
      model: '',
    }));
    setAbWinner(null);
    setActiveSide(side.toUpperCase());
  };

  const pickWinner = async (side) => {
    const winnerLabel = `Variant ${side}`;
    setAbWinner(winnerLabel);
    try {
      const record = {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        label: `A/B: ${abA.prompt.slice(0, 40) || 'Untitled'}`,
        variants: [
          {
            id: 'A',
            promptHash: hashText(abA.prompt),
            prompt: abA.prompt,
            response: abA.response,
            provider: abA.provider || 'unknown',
            model: abA.model || 'unknown',
          },
          {
            id: 'B',
            promptHash: hashText(abB.prompt),
            prompt: abB.prompt,
            response: abB.response,
            provider: abB.provider || 'unknown',
            model: abB.model || 'unknown',
          },
        ],
        keyInputSnapshot: JSON.stringify({ aPrompt: abA.prompt.slice(0, 280), bPrompt: abB.prompt.slice(0, 280) }),
        outcome: { winnerVariantId: side },
        notes: '',
      };
      await saveExperiment(record);
      setHistory(await listExperiments());
      notify('Experiment saved');
    } catch (e) {
      logWarn('save experiment', e);
    }
  };

  const loadHistoryEntry = (entry) => {
    const variants = Array.isArray(entry?.variants) ? entry.variants : [];
    const variantA = variants.find((variant) => variant.id === 'A') || {};
    const variantB = variants.find((variant) => variant.id === 'B') || {};

    setAbA({
      prompt: variantA.prompt || '',
      response: variantA.response || '',
      loading: false,
      error: false,
      provider: variantA.provider || '',
      model: variantA.model || '',
    });
    setAbB({
      prompt: variantB.prompt || '',
      response: variantB.response || '',
      loading: false,
      error: false,
      provider: variantB.provider || '',
      model: variantB.model || '',
    });
    setAbWinner(entry?.outcome?.winnerVariantId ? `Variant ${entry.outcome.winnerVariantId}` : null);
    setActiveSide('A');
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
    loadVariant,
    loadHistoryEntry,
    runAB,
    resetAB,
    pickWinner,
  };
}
