import { useEffect, useState } from 'react';
import { describeRunEstimate, estimateRunCost } from '../../shared/modelPriceEstimates.js';
import { getActiveProvider, watchActiveProvider } from './lib/platform.js';

const FALLBACK = Object.freeze({ provider: 'anthropic', model: 'claude-sonnet-4-6' });

// Extension settings live in chrome.storage.local (extension/options.js) and are
// read by the background worker. Desktop and web go through the same helper.
export async function readActiveModel() {
  try {
    const next = await getActiveProvider();
    if (next?.provider && next?.model) return { provider: next.provider, model: next.model };
  } catch {
    // A closed worker still leaves a labelled estimate.
  }
  return FALLBACK;
}

export default function RunCostEstimate({ text }) {
  const [selection, setSelection] = useState(FALLBACK);
  useEffect(() => {
    let current = true;
    const load = () => {
      readActiveModel().then((next) => {
        if (current) setSelection(next);
      });
    };
    load();
    const stop = watchActiveProvider(load);
    return () => {
      current = false;
      stop();
    };
  }, []);
  const estimate = estimateRunCost({ text, model: selection.model });
  return (
    <p data-testid="run-cost-estimate" className="m-0 max-w-full text-[11px] leading-4" role="note">
      {describeRunEstimate(estimate)}
    </p>
  );
}
