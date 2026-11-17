import { useEffect, useState } from 'react';
import { describeRunEstimate, estimateRunCost } from '../../shared/modelPriceEstimates.js';
import { PROVIDER_SETTINGS_CHANGED } from './lib/providerSettingsEvents.js';

const FALLBACK = Object.freeze({ provider: 'anthropic', model: 'claude-sonnet-4-6' });

async function loadSelection() {
  try {
    const platform = await import('./lib/platform.js');
    if (typeof platform.getActiveProvider === 'function') {
      const next = await platform.getActiveProvider();
      if (next?.provider && next?.model) return { provider: next.provider, model: next.model };
    }
  } catch {
    // A test double or a closed worker falls through to the labelled default.
  }
  return FALLBACK;
}

export function readActiveModel() {
  return loadSelection();
}

export default function RunCostEstimate({ text }) {
  const [selection, setSelection] = useState(FALLBACK);
  useEffect(() => {
    let current = true;
    let stopPlatform = () => {};
    const load = () => {
      loadSelection().then((next) => {
        if (current) setSelection(next);
      });
    };
    load();
    const onWindow = () => load();
    window.addEventListener(PROVIDER_SETTINGS_CHANGED, onWindow);
    window.addEventListener('storage', onWindow);
    import('./lib/platform.js').then((platform) => {
      if (!current || typeof platform.watchActiveProvider !== 'function') return;
      stopPlatform = platform.watchActiveProvider(load);
    }).catch(() => {});
    return () => {
      current = false;
      stopPlatform();
      window.removeEventListener(PROVIDER_SETTINGS_CHANGED, onWindow);
      window.removeEventListener('storage', onWindow);
    };
  }, []);
  const estimate = estimateRunCost({ text, model: selection.model });
  return (
    <p data-testid="run-cost-estimate" className="text-xs leading-relaxed" role="note">
      {describeRunEstimate(estimate)}
    </p>
  );
}
