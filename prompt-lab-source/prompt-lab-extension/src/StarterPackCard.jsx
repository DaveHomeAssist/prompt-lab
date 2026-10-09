import { useState } from 'react';

export default function StarterPackCard({ pack, m = {}, onLoad }) {
  const [loading, setLoading] = useState(false);
  const handleClick = async () => {
    if (pack.loaded || loading) return;
    setLoading(true);
    try { onLoad(pack.id); } finally { setLoading(false); }
  };
  return (
    <div className={`${m.surface} border ${m.border} rounded-lg p-3 flex items-start gap-3`}>
      <span className="text-lg shrink-0">{pack.icon}</span>
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-semibold ${m.text}`}>{pack.name}</p>
        <p className={`text-xs ${m.textMuted} mt-0.5 leading-relaxed`}>{pack.description}</p>
        <span className={`text-xs ${m.textSub} mt-1 inline-block`}>{pack.promptCount} prompts</span>
      </div>
      <button type="button" onClick={handleClick} disabled={pack.loaded || loading}
        className={`ui-control shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
          pack.loaded
            ? `${m.btn} text-green-500 cursor-default`
            : loading
              ? `${m.btn} ${m.textMuted} cursor-wait`
              : 'bg-orange-500/90 hover:bg-orange-400 text-white'
        }`}>
        {pack.loaded ? 'Loaded \u2713' : loading ? 'Loading\u2026' : 'Load'}
      </button>
    </div>
  );
}

