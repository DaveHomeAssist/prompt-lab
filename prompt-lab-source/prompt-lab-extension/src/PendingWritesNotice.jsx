import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  getPendingWriteCount,
  retryPendingWrites,
  subscribeToPendingWrites,
} from './lib/writeRecovery.js';

export default function PendingWritesNotice({ m }) {
  const count = useSyncExternalStore(subscribeToPendingWrites, getPendingWriteCount, () => 0);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    if (!count) return undefined;
    const warnBeforeLeaving = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeLeaving);
    return () => window.removeEventListener('beforeunload', warnBeforeLeaving);
  }, [count]);

  if (!count) return null;
  return (
    <aside role="alert" className={`flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 ${m.surface} ${m.border}`}>
      <p className="min-w-0 text-sm">
        {count} local {count === 1 ? 'record has' : 'records have'} not been saved. Keep this tab open and retry saving after freeing browser storage.
      </p>
      <button
        type="button"
        disabled={retrying}
        className={`ui-control rounded-lg border px-3 py-2 text-sm ${m.border} ${m.btn} disabled:opacity-50`}
        onClick={async () => {
          setRetrying(true);
          try {
            await retryPendingWrites();
          } finally {
            setRetrying(false);
          }
        }}
      >
        {retrying ? 'Saving…' : 'Retry saving records'}
      </button>
    </aside>
  );
}
