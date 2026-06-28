import { useEffect, useRef, useState } from 'react';
import { callModel } from '../api.js';
import { extractTextFromAnthropic, isTransientError } from '../promptUtils.js';
import { listEvalRuns, listExperiments, saveEvalRun, saveExperiment } from '../experimentStore.js';
import { logWarn } from '../lib/logger.js';
import { hashText } from '../lib/utils.js';
import { DEFAULT_ENHANCE_MODEL } from '../constants.js';

const EMPTY_VARIANT = { status: 'idle', prompt: '' };

export default function useABTest({ notify, telemetry }) {
  const [abA, setAbA] = useState(EMPTY_VARIANT);
  const [abB, setAbB] = useState(EMPTY_VARIANT);
  const [abWinner, setAbWinner] = useState(null);
  const [history, setHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [evalRuns, setEvalRuns] = useState([]);
  const [showRuns, setShowRuns] = useState(false);
  const [activeSide, setActiveSide] = useState('A');
  const abReqRef = useRef({ a: 0, b: 0 });
  const completedComparisonRef = useRef('');

  useEffect(() => {
    listExperiments().then(setHistory).catch((e) => logWarn('load experiments', e));
  }, []);

  useEffect(() => {
    listEvalRuns({ mode: 'ab', limit: 12 }).then(setEvalRuns).catch((e) => logWarn('load eval runs', e));
  }, []);

  useEffect(() => {
    if (abA.status !== 'success' || abB.status !== 'success') return;
    if (!abA.response || !abB.response) return;
    const comparisonKey = [
      hashText(abA.prompt || ''),
      hashText(abB.prompt || ''),
      hashText(abA.response || ''),
      hashText(abB.response || ''),
    ].join(':');
    if (completedComparisonRef.current === comparisonKey) return;
    completedComparisonRef.current = comparisonKey;
    void telemetry?.track?.('activation.comparison_completed', {
      source: 'ab-test',
      sideCount: 2,
      hasWinner: Boolean(abWinner),
    });
  }, [abA, abB, abWinner, telemetry]);

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
    setter({ status: 'loading', prompt: state.prompt });
    try {
      const data = await callWithRetry({
        model: DEFAULT_ENHANCE_MODEL,
        max_tokens: 800,
        messages: [{ role: 'user', content: state.prompt }],
      });
      if (abReqRef.current[side] !== reqId) return;
      const responseText = extractTextFromAnthropic(data);
      setter({ status: 'success', prompt: state.prompt, response: responseText });
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
      setter({ status: 'error', prompt: state.prompt, response: '', error: error.message || 'Request failed.' });
    }
  };

  const resetAB = () => {
    abReqRef.current = { a: abReqRef.current.a + 1, b: abReqRef.current.b + 1 };
    completedComparisonRef.current = '';
    setAbA(EMPTY_VARIANT);
    setAbB(EMPTY_VARIANT);
    setAbWinner(null);
  };

  const loadVariant = (side, prompt) => {
    const setter = side === 'a' ? setAbA : setAbB;
    const nextPrompt = typeof prompt === 'string' ? prompt : '';
    abReqRef.current = { ...abReqRef.current, [side]: abReqRef.current[side] + 1 };
    setter({ status: 'idle', prompt: nextPrompt });
    setAbWinner(null);
    setActiveSide(side.toUpperCase());
  };

  const pickWinner = async (side) => {
    const winnerLabel = `Variant ${side}`;
    setAbWinner(winnerLabel);
    const abAResponse = abA.response ?? '';
    const abBResponse = abB.response ?? '';
    try {
      const record = {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        label: `A/B: ${abA.prompt.slice(0, 40) || 'Untitled'}`,
        variants: [
          { id: 'A', promptHash: hashText(abA.prompt), prompt: abA.prompt, response: abAResponse },
          { id: 'B', promptHash: hashText(abB.prompt), prompt: abB.prompt, response: abBResponse },
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

  // Consumers keep the raw setters for prompt edits; status transitions belong to the hook actions.
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
    runAB,
    resetAB,
    pickWinner,
  };
}
