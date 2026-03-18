import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import Ic from './icons';
import { computeDiff, isIdentical, deltaToMarkdown, EQUAL, INSERT, DELETE } from './DiffEngine';

function DiffTokens({ delta, side, m }) {
  return (
    <div className={`text-xs leading-relaxed ${m.codeBlock} rounded-lg p-3 whitespace-pre-wrap break-words`}>
      {delta.map((d, i) => {
        if (side === 'A') {
          if (d.type === INSERT) return null;
          const cls = d.type === DELETE ? m.diffDel : m.diffEq;
          return <span key={i} className={`${cls} px-0.5 rounded`}>{d.text}</span>;
        }
        if (d.type === DELETE) return null;
        const cls = d.type === INSERT ? m.diffAdd : m.diffEq;
        return <span key={i} className={`${cls} px-0.5 rounded`}>{d.text}</span>;
      })}
    </div>
  );
}

export default function DiffPane({ textA, textB, onClose, copy, m }) {
  const leftRef = useRef(null);
  const rightRef = useRef(null);
  const [scrollLock, setScrollLock] = useState(true);
  const syncing = useRef(false);

  const delta = useMemo(() => computeDiff(textA, textB), [textA, textB]);
  const identical = useMemo(() => isIdentical(textA, textB), [textA, textB]);

  const handleScroll = useCallback((source, target) => {
    if (!scrollLock || syncing.current) return;
    syncing.current = true;
    const el = source.current;
    const other = target.current;
    if (el && other) {
      other.scrollTop = el.scrollTop;
    }
    requestAnimationFrame(() => { syncing.current = false; });
  }, [scrollLock]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleCopyMarkdown = useCallback(() => {
    const md = deltaToMarkdown(delta);
    copy?.(md);
  }, [delta, copy]);

  return (
    <div className={`fixed inset-0 ${m.modalBg} z-50 flex items-center justify-center p-4`} onClick={onClose}>
      <div
        className={`${m.modal} border rounded-2xl w-full max-w-6xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="diff-pane-title"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className={`px-5 py-4 border-b ${m.border} flex items-center justify-between gap-4`}>
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-[0.18em] font-semibold text-violet-400 mb-1">Prompt Diff</p>
            <h2 id="diff-pane-title" className={`text-base font-semibold ${m.text}`}>A/B Output Comparison</h2>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setScrollLock((p) => !p)}
              className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors ${scrollLock ? 'bg-violet-600 text-white' : `${m.btn} ${m.textAlt}`}`}
              title={scrollLock ? 'Scroll lock: ON' : 'Scroll lock: OFF'}
            >
              <Ic n="Layers" size={11} />
              {scrollLock ? 'Locked' : 'Unlocked'}
            </button>
            <button
              type="button"
              onClick={handleCopyMarkdown}
              className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold ${m.btn} ${m.textAlt} transition-colors`}
              title="Copy diff as Markdown"
            >
              <Ic n="Copy" size={11} />
              Markdown
            </button>
            <button type="button" onClick={onClose} className={`rounded-lg p-2 ${m.btn} ${m.textAlt}`} aria-label="Close diff view">
              <Ic n="X" size={14} />
            </button>
          </div>
        </div>

        {/* Body */}
        {identical ? (
          <div className="flex-1 flex items-center justify-center p-8">
            <div className="text-center">
              <Ic n="Check" size={32} className="text-green-400 mx-auto mb-3" />
              <p className={`text-sm font-semibold ${m.text}`}>No differences found</p>
              <p className={`text-xs ${m.textMuted} mt-1`}>Both variant outputs are identical.</p>
            </div>
          </div>
        ) : (
          <div className="flex-1 grid grid-cols-2 min-h-0">
            {/* Variant A */}
            <div className={`flex flex-col border-r ${m.border} min-h-0`}>
              <div className={`px-3 py-2 border-b ${m.border} shrink-0`}>
                <span className="text-xs font-bold text-violet-400 uppercase">Variant A</span>
              </div>
              <div
                ref={leftRef}
                className="flex-1 overflow-y-auto p-3"
                onScroll={() => handleScroll(leftRef, rightRef)}
              >
                <DiffTokens delta={delta} side="A" m={m} />
              </div>
            </div>
            {/* Variant B */}
            <div className="flex flex-col min-h-0">
              <div className={`px-3 py-2 border-b ${m.border} shrink-0`}>
                <span className="text-xs font-bold text-violet-400 uppercase">Variant B</span>
              </div>
              <div
                ref={rightRef}
                className="flex-1 overflow-y-auto p-3"
                onScroll={() => handleScroll(rightRef, leftRef)}
              >
                <DiffTokens delta={delta} side="B" m={m} />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
