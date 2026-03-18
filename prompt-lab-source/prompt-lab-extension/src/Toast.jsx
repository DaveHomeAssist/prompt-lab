import { useEffect, useState } from 'react';

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

  return (
    <div className={`pl-toast fixed bottom-6 left-1/2 -translate-x-1/2 bg-violet-700 text-white px-4 py-2 rounded-lg shadow-2xl z-50 text-sm font-medium ${leaving ? 'is-leaving' : ''}`}>
      {message}
    </div>
  );
}
