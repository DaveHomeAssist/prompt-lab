import { useCallback, useRef, useState } from 'react';
import useDialogA11y from '../hooks/useDialogA11y.js';

export default function WorkspaceImportModal({ m, preview, applying, onChoice, onApply, onRetry, onClose }) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const close = useCallback(() => closeRef.current(), []);
  const headingRef = useRef(null);
  const dialogRef = useDialogA11y({ open: true, onClose: close, initialFocusRef: headingRef });
  const [page, setPage] = useState(0);
  const pageSize = 20;
  const pageCount = Math.ceil((preview.rows?.length || 0) / pageSize);
  const plan = preview.plan;
  const ready = Boolean(plan && !preview.error && !preview.unresolved);
  const completed = preview.completedStages || [];
  const completedLabels = [...new Set(completed.map(stage => stage.startsWith('Run ') ? 'Run history' : stage.startsWith('Test case ') ? 'Test cases' : stage))];
  const excludedRuns = Math.max(0, (preview.source?.runs?.length || 0) - (plan?.runs.length || 0));
  const excludedCases = Math.max(0, (preview.source?.testCases?.length || 0) - (plan?.testCases.length || 0));

  return (
    <div className={`fixed inset-0 ${m.modalBg} z-[90] flex items-center justify-center p-3`}>
      <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="workspace-import-title" aria-describedby="workspace-import-description" tabIndex={-1}
        className={`${m.modal} ${m.border} border rounded-xl p-4 w-full max-w-2xl max-h-[90vh] overflow-y-auto flex flex-col gap-4`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 ref={headingRef} tabIndex={-1} id="workspace-import-title" className={`text-base font-bold ${m.text}`}>Review Library import</h2>
            <p className={`text-xs break-all ${m.textSub}`}>{preview.fileName}</p>
          </div>
          <button type="button" aria-label="Close import preview" disabled={applying} onClick={close} className={`min-h-11 min-w-11 rounded-lg ${m.btn} ${m.textBody}`}>×</button>
        </div>
        <p id="workspace-import-description" className={`text-sm ${m.textBody}`}>
          Destination: this device’s Library. Review conflicts before applying. Replace keeps the existing prompt ID and saves its previous content as a version.
        </p>
        {preview.notice && <p role="status" className="text-sm text-amber-500">{preview.notice}</p>}
        {preview.error && <p role="alert" className="text-sm text-red-500">{preview.error}</p>}
        {plan && <div className={`rounded-lg border ${m.border} p-3 text-sm ${m.textBody}`}>
          <p>{preview.rows.length} incoming prompts · {plan.importedCount} new · {plan.replacedCount || 0} replaced · {plan.skippedCount} skipped</p>
          <p>{plan.runs.length} runs · {plan.testCases.length} test cases · {plan.trash.length} recoverable trash entries</p>
          {(excludedRuns > 0 || excludedCases > 0) && <p>{excludedRuns} runs and {excludedCases} test cases excluded with skipped conflicting prompts.</p>}
          <p className="mt-2 text-xs">Exact duplicates reuse the existing prompt for related history. Skip on a different-body conflict excludes its incoming runs and test cases.</p>
          {preview.source?.scratch && <p className="mt-2 font-semibold">This file replaces this device’s Scratch notes.</p>}
          {preview.source?.packs && <p className="mt-2 font-semibold">This file replaces the imported pack registry.</p>}
        </div>}
        {!!plan?.warnings.length && <ul className="list-disc pl-5 text-xs text-amber-500">{plan.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
        {!preview.partial && <div className="flex flex-col gap-2">
          {(preview.rows || []).slice(page * pageSize, (page + 1) * pageSize).map(({ entry, kind, conflicts, choice }) => (
            <div key={entry.id} className={`border ${m.border} rounded-lg p-3 flex flex-col gap-2`}>
              <p className={`font-semibold text-sm break-words ${m.text}`}>{entry.title}</p>
              <p className={`text-xs ${m.textSub}`}>{kind === 'duplicate' ? 'Exact body duplicate' : kind === 'conflict' ? 'Title or ID conflict' : 'New prompt'}</p>
              <p className={`text-xs whitespace-pre-wrap break-words max-h-24 overflow-y-auto ${m.textBody}`}>{entry.enhanced}</p>
              {conflicts.length > 0 && <>
                <label className={`text-xs ${m.textBody}`}>
                  Conflict action for {entry.title}
                  <select aria-label={`Conflict action for ${entry.title}`} disabled={applying} value={choice?.action || ''}
                    onChange={event => onChoice(entry.id, { action: event.target.value, existingId: choice?.existingId || conflicts[0].id })}
                    className={`mt-1 block min-h-11 w-full rounded-lg border px-2 ${m.input} ${m.text}`}>
                    <option value="" disabled>Choose an action</option>
                    <option value="keep">Keep both</option>
                    <option value="replace">Replace existing</option>
                    <option value="skip">Skip incoming</option>
                  </select>
                </label>
                {choice?.action === 'replace' && <label className={`text-xs ${m.textBody}`}>
                  Replace target
                  <select aria-label={`Replace target for ${entry.title}`} disabled={applying} value={choice.existingId}
                    onChange={event => onChoice(entry.id, { action: 'replace', existingId: event.target.value })}
                    className={`mt-1 block min-h-11 w-full rounded-lg border px-2 ${m.input} ${m.text}`}>
                    {conflicts.map(target => <option key={target.id} value={target.id}>{target.title} ({target.id})</option>)}
                  </select>
                </label>}
              </>}
            </div>
          ))}
        </div>}
        {!preview.partial && pageCount > 1 && <nav aria-label="Import preview pages" className="flex items-center justify-between gap-2">
          <button type="button" disabled={page === 0 || applying} onClick={() => setPage(value => value - 1)} className={`min-h-11 px-3 rounded-lg ${m.btn} ${m.textBody}`}>Previous prompts</button>
          <span className={`text-xs ${m.textSub}`}>Page {page + 1} of {pageCount}</span>
          <button type="button" disabled={page + 1 >= pageCount || applying} onClick={() => setPage(value => value + 1)} className={`min-h-11 px-3 rounded-lg ${m.btn} ${m.textBody}`}>Next prompts</button>
        </nav>}
        {preview.partial && <div role="status" className={`text-sm ${m.textBody}`}>
          <p>{completed.length ? `Saved stages: ${completedLabels.join(', ')}.` : 'No import writes acknowledged yet.'}</p>
          <p>Retry applies the remaining stages. Closing retains this operation in this tab; it does not undo saved records.</p>
        </div>}
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={applying || (!preview.partial && !ready)} onClick={preview.partial ? onRetry : onApply}
            className="min-h-11 flex-1 rounded-lg px-3 py-2 text-sm font-semibold bg-orange-600 text-white disabled:opacity-40">
            {applying ? 'Applying import…' : preview.partial ? 'Retry remaining stages' : 'Apply import'}
          </button>
          <button type="button" disabled={applying} onClick={close} className={`min-h-11 rounded-lg px-4 py-2 text-sm ${m.btn} ${m.textBody}`}>{preview.partial ? 'Close' : 'Cancel'}</button>
        </div>
        {!preview.partial && <p className={`text-xs ${m.textSub}`}>{preview.unresolved ? `${preview.unresolved} conflict choices required.` : 'Cancel makes no import writes.'}</p>}
      </section>
    </div>
  );
}
