import { useEffect, useRef, useState } from 'react';
import useDialogA11y from '../hooks/useDialogA11y.js';
import { T } from '../constants.js';

export default function LibraryRecoveryModal({ m = T.light, lib, onClose }) {
  const [listing, setListing] = useState(null), [selected, setSelected] = useState('');
  const [page, setPage] = useState(0), [review, setReview] = useState(null);
  const [busy, setBusy] = useState('loading'), [error, setError] = useState('');
  const [attempted, setAttempted] = useState(false), [restored, setRestored] = useState(false);
  const flight = useRef(false), heading = useRef(null), alive = useRef(true);
  const close = () => { if (!flight.current) onClose(); };
  const dialog = useDialogA11y({ onClose: close, initialFocusRef: heading });
  const describe = failure => ['SERVICE_UNAVAILABLE', 'DISCONNECTED'].includes(failure?.code)
    ? 'Library service is unavailable. Reconnect and try again.'
    : failure?.code === 'RATE_LIMIT' ? 'Too many Library requests. Wait a minute, then try again.'
      : failure?.message || 'The Library could not confirm this request. Please retry.';
  const load = async (refresh = false) => {
    if (flight.current) return;
    flight.current = true; setBusy('loading'); setError(''); setReview(null);
    try {
      if (refresh) await lib.refresh();
      const result = await lib.readRecoveryCheckpoints();
      if (!alive.current) return;
      const items = [...result.items].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.checkpointId.localeCompare(b.checkpointId));
      setListing({ ...result, items }); setPage(0); setSelected('');
    } catch (failure) { if (alive.current) { setListing(null); setError(describe(failure)); } }
    finally { flight.current = false; if (alive.current) setBusy(''); }
  };
  useEffect(() => {
    alive.current = true; void load();
    return () => { alive.current = false; };
  }, []);
  const preview = async () => {
    if (flight.current || !selected || !listing || attempted) return;
    flight.current = true; setBusy('review'); setError(''); setReview(null);
    try {
      const result = await lib.reviewCheckpointRestore(selected, listing.revision);
      if (alive.current) setReview(result);
    } catch (failure) { if (alive.current) setError(describe(failure)); }
    finally { flight.current = false; if (alive.current) setBusy(''); }
  };
  const restore = async () => {
    if (flight.current || !review?.commitAvailable || restored) return;
    flight.current = true; setBusy('restore'); setError(''); setAttempted(true);
    try {
      const result = await lib.restoreCheckpoint(review);
      if (alive.current) {
        if (result) setRestored(true);
        else setError('Restore was not confirmed. The same review is retained for retry.');
      }
    } catch (failure) { if (alive.current) setError(describe(failure)); }
    finally { flight.current = false; if (alive.current) setBusy(''); }
  };
  const pageSize = 20, items = listing?.items ?? [], pageCount = Math.ceil(items.length / pageSize);
  const groups = review?.restorePlan?.currentViewPlan?.groups ?? [];
  const count = domain => groups.filter(group => group.domain === domain && group.selected !== null).length;
  return <div className={`fixed inset-0 ${m.modalBg} z-[90] flex items-center justify-center p-3`}>
    <section ref={dialog} role="dialog" aria-modal="true" aria-labelledby="library-recovery-title" aria-describedby="library-recovery-description" tabIndex={-1}
      className={`${m.modal} ${m.border} ${m.textBody} border rounded-xl p-4 w-full max-w-2xl max-h-[90dvh] overflow-y-auto flex flex-col gap-4`}>
      <div className="flex items-start justify-between gap-3">
        <h2 ref={heading} tabIndex={-1} id="library-recovery-title" className={`text-base font-bold ${m.text}`}>Library recovery</h2>
        <button type="button" aria-label="Close recovery" disabled={Boolean(busy)} onClick={close} className={`min-h-11 min-w-11 rounded-lg ${m.btn}`}>×</button>
      </div>
      <p id="library-recovery-description" className="text-sm">Restore an earlier saved Library state. Later history and backups stay retained. Deletion markers still apply. Unsaved editor changes are not included.</p>
      <p className={`text-xs ${m.textSub}`}>These checkpoints are in this Library. Download a complete backup to keep an independent copy. Restoring a backup file is not available here yet.</p>
      {busy && <p role="status" className="text-sm">{busy === 'restore' ? 'Restoring the Library…' : busy === 'review' ? 'Reviewing this checkpoint…' : 'Loading recovery checkpoints…'}</p>}
      {error && <div role="alert" className="text-sm break-words"><p>{error}</p>{attempted && lib.saveError && <p>{lib.saveError}</p>}</div>}
      {restored ? <p role="status" className="text-sm font-semibold">Checkpoint restored. Later history and backups are retained.</p> : <>
        {listing && <>
          {items.length ? <label className="text-sm">Recovery checkpoint
            <select aria-label="Recovery checkpoint" value={selected} disabled={Boolean(busy) || attempted} onChange={event => { setSelected(event.target.value); setReview(null); setError(''); }}
              className={`mt-1 block min-h-11 w-full min-w-0 rounded-lg border px-2 ${m.input} ${m.text}`}>
              <option value="">Choose a saved checkpoint</option>
              {items.slice(page * pageSize, (page + 1) * pageSize).map(item => <option key={item.checkpointId} value={item.checkpointId}>{new Date(item.createdAt).toLocaleString()} · {item.checkpointId.slice(-8)}</option>)}
            </select>
          </label> : <p className="text-sm">No earlier checkpoints are available yet.</p>}
          {pageCount > 1 && <div className="flex flex-wrap items-center gap-3 text-sm">
            <button type="button" className="pl-secondary-button" disabled={Boolean(busy) || attempted || page === 0} onClick={() => { setPage(page - 1); setSelected(''); setReview(null); }}>Previous checkpoints</button>
            <span>Page {page + 1} of {pageCount}</span>
            <button type="button" className="pl-secondary-button" disabled={Boolean(busy) || attempted || page + 1 === pageCount} onClick={() => { setPage(page + 1); setSelected(''); setReview(null); }}>Next checkpoints</button>
          </div>}
        </>}
        {!attempted && <div className="flex flex-wrap gap-2">
          <button type="button" className="pl-secondary-button" disabled={Boolean(busy)} onClick={() => load(true)}>Refresh checkpoints</button>
          {listing && <button type="button" className="pl-secondary-button" disabled={Boolean(busy) || !selected} onClick={preview}>Review checkpoint</button>}
        </div>}
        {review && <div className={`border ${m.border} rounded-lg p-3 text-sm flex flex-col gap-2`}>
          <p>{count('prompts')} active prompts after restore</p>
          <p>{count('trash')} Trash records · {count('folders')} folders · {count('evaluations')} evaluations</p>
          <p>The saved selections for Scratch, tests, packs and other Library records are restored together. Records added later leave the current view but remain in retained history.</p>
          <p>{review.restorePlan.counts.suppressed} selections suppressed by retained deletion markers.</p>
          {!review.commitAvailable && <p role="alert">This checkpoint has unresolved data. It cannot be restored.</p>}
          <button type="button" className="pl-primary-button" disabled={Boolean(busy) || !review.commitAvailable} onClick={restore}>{attempted ? 'Retry this restore' : 'Restore this checkpoint'}</button>
        </div>}
      </>}
    </section>
  </div>;
}
