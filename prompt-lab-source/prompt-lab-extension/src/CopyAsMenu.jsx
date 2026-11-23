import { useState } from 'react';
import { COPY_AS_FORMATS, buildCopyAs, copyAsMessage } from './lib/copyAs.js';
import { readActiveModel } from './RunCostEstimate.jsx';

// An in-flow list, not the absolute More menu. That panel painted over the
// result controls in the bounded 768px Create layout.
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
  const [open, setOpen] = useState(false);

  const choose = async (format) => {
    setOpen(false);
    const source = typeof text === 'string' ? text : '';
    const prepared = typeof preparePromptText === 'function'
      ? await preparePromptText(source, promptKey)
      : { cancelled: false, text: source };
    if (!prepared || prepared.cancelled) return;
    const active = await readActiveModel();
    const snippet = buildCopyAs(format, prepared.text, {
      title,
      model: model || active.model,
      provider: provider || active.provider,
    });
    await onCopy?.(snippet, copyAsMessage(format));
  };

  return (
    <div className={`relative inline-flex ${className}`} data-testid="copy-as">
      <button
        type="button"
        className="ui-control inline-flex items-center rounded-lg px-2.5 py-1 text-xs font-semibold"
        aria-expanded={open}
        aria-controls="copy-as-formats"
        onClick={() => setOpen((value) => !value)}
      >
        Copy as…
        <span className="sr-only"> plain text, Markdown, JSON messages, or a curl command that uses $API_KEY</span>
      </button>
      {open && (
        <div id="copy-as-formats" role="menu" aria-label="Copy as" className="absolute left-0 top-full z-20 mt-1 flex min-w-[10rem] flex-col rounded-lg border bg-[var(--pl-brand-ink)] p-1 shadow-lg">
          {COPY_AS_FORMATS.map((format) => (
            <button
              key={format.id}
              type="button"
              role="menuitem"
              className="min-h-11 px-3 py-2 text-left text-xs font-semibold"
              onClick={() => choose(format.id)}
            >
              {format.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
