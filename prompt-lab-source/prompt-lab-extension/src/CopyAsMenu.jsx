import { useRef } from 'react';
import { COPY_AS_FORMATS, buildCopyAs, copyAsMessage } from './lib/copyAs.js';
import { readActiveModel } from './RunCostEstimate.jsx';

export default function CopyAsMenu({
  text,
  title = '',
  model = '',
  provider = '',
  promptKey,
  preparePromptText,
  onCopy,
  className = '',
}) {
  const detailsRef = useRef(null);

  const choose = async (format) => {
    const source = typeof text === 'string' ? text : '';
    const prepared = typeof preparePromptText === 'function'
      ? await preparePromptText(source, promptKey)
      : { cancelled: false, text: source };
    if (!prepared || prepared.cancelled) return;
    const active = readActiveModel();
    const snippet = buildCopyAs(format, prepared.text, {
      title,
      model: model || active.model,
      provider: provider || active.provider,
    });
    await onCopy?.(snippet, copyAsMessage(format));
    if (detailsRef.current) detailsRef.current.open = false;
  };

  return (
    <details ref={detailsRef} className={`pl-more-menu ${className}`} data-testid="copy-as">
      <summary className="ui-control inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold">
        Copy as…
        <span className="sr-only"> plain text, Markdown, JSON messages, or a curl command that uses $API_KEY</span>
      </summary>
      <div className="pl-more-menu-panel" role="menu" aria-label="Copy as">
        {COPY_AS_FORMATS.map((format) => (
          <button
            key={format.id}
            type="button"
            role="menuitem"
            className="min-h-11 w-full px-3 py-2 text-left text-xs font-semibold"
            onClick={() => choose(format.id)}
          >
            {format.label}
          </button>
        ))}
      </div>
    </details>
  );
}
