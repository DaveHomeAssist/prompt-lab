import { useEffect, useState } from 'react';
import { describeRunEstimate, estimateRunCost } from '../../shared/modelPriceEstimates.js';
import { PROVIDER_SETTINGS_CHANGED } from './lib/providerSettingsEvents.js';

const MODEL_FIELD = {
  anthropic: 'anthropicModel',
  openai: 'openaiModel',
  gemini: 'geminiModel',
  openrouter: 'openrouterModel',
  ollama: 'ollamaModel',
};

const FALLBACK_MODEL = {
  anthropic: 'claude-sonnet-4-6',
  openai: 'gpt-4o',
  gemini: 'gemini-2.5-flash',
  openrouter: 'anthropic/claude-sonnet-4.6',
  ollama: 'llama3.2:3b',
};

export function readActiveModel() {
  let settings = {};
  try {
    settings = JSON.parse(localStorage.getItem('pl2-provider-settings') || '{}') || {};
  } catch {
    settings = {};
  }
  const web = typeof import.meta !== 'undefined' && import.meta.env?.VITE_WEB_MODE === 'true';
  const provider = web ? 'anthropic' : (settings.provider || 'anthropic');
  const field = MODEL_FIELD[provider] || 'anthropicModel';
  return {
    provider,
    model: settings[field] || FALLBACK_MODEL[provider] || FALLBACK_MODEL.anthropic,
  };
}

export default function RunCostEstimate({ text }) {
  const [selection, setSelection] = useState(readActiveModel);
  useEffect(() => {
    const update = () => setSelection(readActiveModel());
    window.addEventListener(PROVIDER_SETTINGS_CHANGED, update);
    window.addEventListener('storage', update);
    return () => {
      window.removeEventListener(PROVIDER_SETTINGS_CHANGED, update);
      window.removeEventListener('storage', update);
    };
  }, []);
  const estimate = estimateRunCost({ text, model: selection.model });
  return (
    <p data-testid="run-cost-estimate" className="text-xs leading-relaxed" role="note">
      {describeRunEstimate(estimate)}
    </p>
  );
}
