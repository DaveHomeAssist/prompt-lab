import { useRef, useState } from 'react';
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
  const anchorRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [dropUp, setDropUp] = useState(false);
  const toggle = () => {
    // The short-window Write footer is clipped by overflow:hidden, so the
    // format list has to open upward or the choices sit outside the column.
    setDropUp(Boolean(anchorRef.current?.closest('.is-pinned-actions')));
    setOpen((value) => !value);
  };

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
    <div ref={anchorRef} className={`relative inline-flex ${className}`} data-testid="copy-as">
      <button
        type="button"
        className="ui-control inline-flex items-center rounded-lg px-2.5 py-1 text-xs font-semibold"
        aria-expanded={open}
        aria-controls="copy-as-formats"
        onClick={toggle}
      >
        Copy as…
        <span className="sr-only"> plain text, Markdown, JSON messages, or a curl command that uses $API_KEY</span>
      </button>
      {open && (
        <div id="copy-as-formats" role="menu" aria-label="Copy as" className={`absolute left-0 z-20 flex min-w-[10rem] flex-col rounded-lg border bg-[var(--pl-brand-ink)] p-1 shadow-lg ${dropUp ? 'bottom-full mb-1' : 'top-full mt-1'}`}>
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
