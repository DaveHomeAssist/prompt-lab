import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export default function Toast({ message, onDone }) {
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const exitTimer = setTimeout(() => setLeaving(true), 2100);
    const doneTimer = setTimeout(onDone, 2450);
    return () => {
      clearTimeout(exitTimer);
      clearTimeout(doneTimer);
    };
  }, [onDone]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[120] flex justify-center px-4">
      <div role="status" aria-live="polite" className={`pl-toast max-w-full rounded-lg bg-violet-700 px-4 py-2 text-sm font-medium text-white shadow-2xl ${leaving ? 'is-leaving' : ''}`}>
        {message}
      </div>
    </div>,
    document.body,
  );
}
