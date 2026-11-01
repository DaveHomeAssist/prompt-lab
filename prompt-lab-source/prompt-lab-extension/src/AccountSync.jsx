// Account sync UI (docs/ACCOUNT_SYNC_DESIGN.md): a one-line status bar under
// the header and a details dialog with conflict copies, the "different
// account on this device" block, the sign-in prompt and sign-out. Renders
// nothing unless the build turns sync on (VITE_PL_ACCOUNT_SYNC=on).
import { useEffect, useRef, useState } from 'react';
import { describeConflictCopy } from './lib/sync/syncConflicts.js';

export const SIGN_IN_URL = 'https://promptlab.tools/app/';

const ago = (at, now = Date.now()) => {
  if (!at) return '';
  const minutes = Math.floor((now - at) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours} h ago` : `${Math.floor(hours / 24)} d ago`;
};

/** User-facing wording for a sync state. tone: ok | busy | warn | blocked | idle */
export function describeSyncStatus(sync, now = Date.now()) {
  const pending = Number(sync?.pending) || 0;
  const queued = pending ? ` ${pending} ${pending === 1 ? 'change' : 'changes'} waiting.` : '';
  switch (sync?.status) {
    case 'signed-out':
      return sync.needsReopen
        ? { tone: 'idle', label: 'Signed in on promptlab.tools?', detail: 'Close and reopen this panel to start syncing.' }
        : { tone: 'idle', label: 'Sync is off on this device', detail: 'Sign in to keep your Library on every device.' };
    case 'syncing': return { tone: 'busy', label: 'Syncing…', detail: 'Your Library stays usable while it syncs.' };
    case 'synced': return { tone: 'ok', label: `Synced${sync.at ? ` ${ago(sync.at, now)}` : ''}`, detail: pending ? queued.trim() : 'Your Library is up to date on this account.' };
    case 'offline': return { tone: 'warn', label: 'Offline', detail: `Changes are saved on this device and sync when you are back online.${queued}` };
    case 'throttled': return { tone: 'warn', label: 'Sync is busy', detail: `Retrying shortly.${queued}` };
    case 'paused': return { tone: 'warn', label: 'Sync is paused', detail: `Prompt Lab paused sync for everyone. Your Library is safe on this device.${queued}` };
    case 'quota': return { tone: 'blocked', label: 'Synced Library is full', detail: 'New changes stay on this device. Delete prompts or conflict copies to free space.' };
    case 'auth': return { tone: 'blocked', label: 'Sign in again to sync', detail: `Your session ended. Nothing on this device was removed.${queued}` };
    case 'owner-mismatch': return { tone: 'blocked', label: 'Different account on this device', detail: 'This Library is linked to another Prompt Lab account, so sync is off here.' };
    case 'error': return { tone: 'warn', label: 'Sync hit a problem', detail: `It will try again.${queued}` };
    default: return { tone: 'idle', label: 'Sync is off', detail: '' };
  }
}

const DOT = { ok: 'bg-emerald-500', busy: 'bg-sky-400 animate-pulse', warn: 'bg-amber-400', blocked: 'bg-red-500', idle: 'bg-slate-400' };

function openSignIn(onSignIn) {
  if (onSignIn) { onSignIn(); return; }
  try { window.open(SIGN_IN_URL, '_blank', 'noopener'); } catch { /* popup blocked: the link is in the dialog too */ }
}

export function AccountSyncBar({ sync, m, onOpen, onSignIn }) {
  if (!sync?.enabled) return null;
  const view = describeSyncStatus(sync);
  const signedOut = sync.status === 'signed-out';
  return (
    <div data-testid="account-sync-bar" data-sync-status={sync.status} className={`flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-1.5 text-xs ${m.surface} ${m.border}`} role="status" aria-live="polite">
      <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${DOT[view.tone]}`} aria-hidden="true" />
      <span className="font-medium">{view.label}</span>
      {['warn', 'blocked'].includes(view.tone) && view.detail && <span className={`hidden sm:inline ${m.textSub}`}>{view.detail}</span>}
      {sync.conflicts > 0 && sync.status === 'synced' && <span className={m.textSub}>{sync.conflicts} conflict {sync.conflicts === 1 ? 'copy' : 'copies'} kept</span>}
      {sync.tooLarge > 0 && <span className={m.textSub}>{sync.tooLarge} too large to sync, kept on this device</span>}
      <span className="ml-auto flex items-center gap-2">
        {signedOut && !sync.needsReopen && (
          <button type="button" className="ui-control rounded-md bg-orange-600 px-2.5 py-1 font-medium text-white hover:bg-orange-500" onClick={() => openSignIn(onSignIn)}>Sign in to sync</button>
        )}
        <button type="button" className={`ui-control rounded-md border px-2.5 py-1 ${m.border} ${m.btn}`} onClick={onOpen} aria-haspopup="dialog">Sync details</button>
      </span>
    </div>
  );
}

function ConflictCopies({ sync, m }) {
  const [state, setState] = useState({ loading: true, rows: [], error: '' });
  const [restored, setRestored] = useState(() => new Set());
  useEffect(() => {
    let live = true;
    if (!sync.listConflicts || !sync.signedIn || sync.status === 'owner-mismatch') { setState({ loading: false, rows: [], error: '' }); return undefined; }
    sync.listConflicts()
      .then((rows) => { if (live) setState({ loading: false, rows, error: '' }); })
      .catch(() => { if (live) setState({ loading: false, rows: [], error: 'Could not load conflict copies right now. Try again in a minute.' }); });
    return () => { live = false; };
  }, [sync.listConflicts, sync.signedIn, sync.status]);
  if (state.loading) return <p className={`text-sm ${m.textSub}`}>Loading conflict copies…</p>;
  if (state.error) return <p className={`text-sm ${m.textSub}`}>{state.error}</p>;
  if (!state.rows.length) return <p className={`text-sm ${m.textSub}`}>No conflict copies. When two devices edit the same prompt, the newer edit wins and the other one is kept here.</p>;
  return (
    <ul className="flex max-h-64 flex-col gap-2 overflow-y-auto" data-testid="sync-conflict-list">
      {state.rows.map((row) => {
        const info = describeConflictCopy(row);
        const done = row.restored || restored.has(String(row.id));
        return (
          <li key={row.id} className={`rounded-lg border p-3 ${m.border}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{info.title}</p>
                {info.detail && <p className={`mt-0.5 line-clamp-2 text-xs ${m.textSub}`}>{info.detail}</p>}
                <p className={`mt-1 text-[11px] ${m.textMuted}`}>Kept {row.created_at ? new Date(row.created_at).toLocaleString() : ''}</p>
              </div>
              {info.restorable && (
                <button
                  type="button"
                  disabled={done}
                  className={`ui-control shrink-0 rounded-md border px-2.5 py-1 text-xs ${m.border} ${m.btn} disabled:opacity-60`}
                  onClick={() => { sync.restoreConflict?.(row); setRestored((prev) => new Set(prev).add(String(row.id))); }}
                >{done ? 'Restored' : 'Restore this copy'}</button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function AccountSyncPanel({ sync, m, open, onClose, onSignOut, onSignIn }) {
  const closeRef = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    closeRef.current?.focus();
    const onKey = (event) => { if (event.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open || !sync?.enabled) return null;
  const view = describeSyncStatus(sync);
  const mismatch = sync.status === 'owner-mismatch';
  return (
    <div className={`fixed inset-0 z-[90] flex items-end justify-center p-0 sm:items-center sm:p-4 ${m.modalBg}`} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose?.(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="account-sync-title" data-testid="account-sync-panel" className={`flex max-h-[90vh] w-full max-w-lg flex-col gap-4 overflow-y-auto rounded-t-2xl border p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl sm:rounded-2xl ${m.modal} ${m.text}`}>
        <header className="flex items-start justify-between gap-3">
          <div>
            <h2 id="account-sync-title" className="text-base font-semibold">Library sync</h2>
            <p className={`mt-1 flex items-center gap-2 text-sm ${m.textSub}`}><span className={`inline-block h-2 w-2 rounded-full ${DOT[view.tone]}`} aria-hidden="true" />{view.label}. {view.detail}</p>
          </div>
          <button ref={closeRef} type="button" className={`ui-control rounded-md border px-2.5 py-1 text-sm ${m.border} ${m.btn}`} onClick={onClose}>Close</button>
        </header>

        {mismatch && (
          <div role="alert" data-testid="sync-owner-mismatch" className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm">
            <p className="font-medium">This device's Library belongs to a different account</p>
            <p className="mt-1">It was first synced with another Prompt Lab account. To keep the two accounts' prompts apart, nothing is uploaded or merged while you are signed in as this account. Your prompts on this device are untouched.</p>
            <p className="mt-1">To sync this Library, sign out and sign back in with the account that first synced it.</p>
          </div>
        )}

        {sync.status === 'signed-out' && (
          <div data-testid="sync-sign-in" className={`rounded-lg border p-3 text-sm ${m.border}`}>
            <p className="font-medium">Sign in to sync your Library</p>
            <p className={`mt-1 ${m.textSub}`}>Prompts, collections and folders follow your account to the web app, the extension and the desktop app. Prompts already on this device stay and are merged in the first time you sign in.</p>
            {sync.needsReopen
              ? <p className="mt-2">Signed in on promptlab.tools already? Close and reopen this panel.</p>
              : <button type="button" className="ui-control mt-3 rounded-md bg-orange-600 px-3 py-1.5 font-medium text-white hover:bg-orange-500" onClick={() => openSignIn(onSignIn)}>Sign in</button>}
          </div>
        )}

        {sync.signedIn && !mismatch && (
          <section aria-labelledby="sync-conflicts-title" className="flex flex-col gap-2">
            <h3 id="sync-conflicts-title" className="text-sm font-semibold">Conflict copies</h3>
            <ConflictCopies sync={sync} m={m} />
          </section>
        )}

        <p className={`text-xs ${m.textMuted}`}>Synced: prompts, trash, collections, folders and loaded packs. Not synced: runs, evaluations, Scratch, provider keys and settings.</p>

        {sync.signedIn && (
          <footer className={`flex flex-wrap items-center justify-between gap-3 border-t pt-3 ${m.border}`}>
            <p className={`text-xs ${m.textSub}`}>Signing out stops sync. Everything stays on this device.</p>
            <div className="flex gap-2">
              {!mismatch && <button type="button" className={`ui-control rounded-md border px-2.5 py-1 text-sm ${m.border} ${m.btn}`} onClick={() => sync.syncNow?.()}>Sync now</button>}
              {onSignOut && <button type="button" className={`ui-control rounded-md border px-2.5 py-1 text-sm ${m.border} ${m.btn}`} onClick={onSignOut}>Sign out, keep local data</button>}
            </div>
          </footer>
        )}
      </section>
    </div>
  );
}
