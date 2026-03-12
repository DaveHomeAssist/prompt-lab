import { useEffect } from 'react';

export default function Toast({ message, onDone }) {
  useEffect(() => { const t = setTimeout(onDone, 2400); return () => clearTimeout(t); }, []);
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-violet-700 text-white px-4 py-2 rounded-lg shadow-2xl z-50 text-sm font-medium">
      {message}
    </div>
  );
}
