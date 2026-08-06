import Ic from './icons';

export default function FollowUpPanel({
  m,
  source,
  canSuggest = false,
  suggestions = [],
  loading = false,
  error = '',
  onFetch,
  onUse,
  onChain,
  onSave,
  onCopy,
}) {
  if (!canSuggest || typeof onFetch !== 'function') return null;

  const actionClass = `inline-flex items-center gap-1 text-xs ${m.textAlt} hover:text-orange-300 transition-colors`;

  return (
    <section data-testid="follow-up-panel" className={`${m.surface} border ${m.border} rounded-lg p-3`} aria-labelledby="follow-up-heading">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id="follow-up-heading" className={`text-xs font-semibold ${m.textSub} uppercase tracking-wider`}>Follow-up Prompts</h3>
          <p data-testid="follow-up-source" className={`mt-1 text-xs ${m.textMuted} truncate`} title={source?.label || ''}>
            Based on: {source?.label || 'current prompt'}
          </p>
        </div>
        <button
          type="button"
          data-testid="suggest-follow-ups"
          onClick={onFetch}
          disabled={loading}
          className={`ui-control inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${m.btn} ${m.textAlt} disabled:opacity-40 shrink-0`}
        >
          <Ic n="RotateCcw" size={11} />
          {loading ? 'Suggesting...' : suggestions.length > 0 ? 'Refresh' : 'Suggest'}
        </button>
      </div>

      {error && <p role="alert" className="mt-2 text-xs text-red-400">{error}</p>}

      {suggestions.length > 0 && (
        <div className="mt-2 flex flex-col gap-2">
          {suggestions.map((suggestion, index) => (
            <article key={`${suggestion.title}-${index}`} className={`${m.codeBlock} border ${m.border} rounded-lg p-2.5`}>
              <div className="flex items-start justify-between gap-3 mb-1">
                <h4 className="text-xs font-bold text-orange-400 min-w-0 break-words">{suggestion.title}</h4>
                <div className="flex flex-wrap justify-end gap-x-2.5 gap-y-1 shrink-0">
                  <button type="button" onClick={() => onUse?.(suggestion)} className={actionClass} title="Start a new draft with this prompt">
                    <Ic n="ArrowRight" size={10} />Use
                  </button>
                  <button type="button" onClick={() => onChain?.(suggestion)} className={actionClass} title="Add this prompt to Composer">
                    <Ic n="GitBranch" size={10} />Chain
                  </button>
                  <button type="button" onClick={() => onSave?.(suggestion)} className={actionClass} title="Save this follow-up as a library record">
                    <Ic n="Save" size={10} />Save
                  </button>
                  <button
                    type="button"
                    onClick={() => onCopy?.(suggestion.prompt)}
                    aria-label={`Copy follow-up: ${suggestion.title}`}
                    className={`${m.textAlt} hover:text-white transition-colors`}
                    title="Copy follow-up prompt"
                  >
                    <Ic n="Copy" size={11} />
                  </button>
                </div>
              </div>
              <p className={`text-xs ${m.textAlt} leading-relaxed whitespace-pre-wrap`}>{suggestion.prompt}</p>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
