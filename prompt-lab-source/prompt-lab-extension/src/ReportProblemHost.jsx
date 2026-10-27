import { useEffect, useRef, useState } from 'react';
import useDialogA11y from './hooks/useDialogA11y.js';
import { collectReport, diagnostics } from './lib/diagnostics.js';
import './ReportProblem.css';

export function issueDraftUrl(report) {
  const url = new URL('https://github.com/DaveHomeAssist/prompt-lab/issues/new');
  url.searchParams.set('title', 'Prompt Lab problem report');
  // Neither the description nor diagnostic logs go into a URL.
  url.searchParams.set('body', `Report ID: ${report.reportId}\nBuild: ${report.version} (${report.revision})\nSurface: ${report.surface}\n\nDescribe what happened and what you expected. Attach your reviewed export if appropriate.`);
  return url.href;
}

function ReportDialog({ onClose }) {
  const [description, setDescription] = useState('');
  const [report, setReport] = useState(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [theme, setTheme] = useState(() => document.querySelector('.pl-app-shell')?.dataset.theme || 'light');
  const input = useRef(null);
  const dialogRef = useDialogA11y({ onClose, initialFocusRef: input });
  const preview = async () => {
    setBusy(true); setStatus('');
    try { setReport(await collectReport(description)); }
    catch { setStatus('Could not collect diagnostics. Your description is still here; try again or copy it manually.'); }
    finally { setBusy(false); }
  };
  const exportReport = async () => {
    if (!report) return;
    setBusy(true);
    try {
      if (globalThis.PromptLabDiagnosticsNative) {
        const path = await globalThis.PromptLabDiagnosticsNative.export(report);
        setStatus(`Report saved to ${path}`);
      } else {
        const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a'); link.href = url; link.download = `promptlab-report-${report.reportId}.json`;
        document.body.appendChild(link); link.click(); link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
        setStatus('Report download requested. Check your browser downloads to confirm it saved.');
      }
      diagnostics().record('report_export');
    } catch { setStatus('Export failed. Use Copy report, or desktop Help → Export diagnostics.'); }
    finally { setBusy(false); }
  };
  const copyReport = async () => {
    try { await navigator.clipboard.writeText(JSON.stringify(report, null, 2)); setStatus('Report copied. Review it before sharing.'); }
    catch { setStatus('Clipboard access failed. Select and copy the preview, or export a file.'); }
  };
  return <div className="pl-report-overlay">
    <section ref={dialogRef} tabIndex={-1} className="pl-report-dialog" data-theme={theme}
      role="dialog" aria-modal="true" aria-labelledby="pl-report-title" aria-describedby="pl-report-privacy">
      <header><h2 id="pl-report-title">Report a problem</h2>
        <button type="button" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>Use {theme === 'light' ? 'dark' : 'light'} mode</button>
        <button type="button" onClick={onClose} aria-label="Close problem report">Close</button>
      </header>
      <div className="pl-report-body">
        <p id="pl-report-privacy">Diagnostics include build information, event codes, timings and application stack frames. Prompt text, outputs, account details and API keys are not collected automatically. Nothing is uploaded by this form.</p>
        <label htmlFor="pl-report-description">What happened, and what did you expect?</label>
        <textarea ref={input} id="pl-report-description" maxLength={4000} rows={4} value={description}
          onChange={event => { setDescription(event.target.value); setReport(null); setStatus(''); }}
          placeholder="Describe the problem and any steps you remember. Do not include API keys or private prompt content." />
        <button type="button" disabled={busy} onClick={preview}>{busy ? 'Working…' : 'Preview diagnostic report'}</button>
        {report && <>
          <p>Report ID: <code>{report.reportId}</code><br />Build: {report.version} ({report.revision}) · {report.surface}</p>
          {[...report.warnings, ...(report.native?.writeOrReadFailures ? ['Some native diagnostic writes or reads failed; evidence may be incomplete.'] : [])].map(message => <p key={message} role="alert">{message}</p>)}
          <p>Your description is included exactly as entered. Review the complete report before sharing it.</p>
          <pre tabIndex={0} aria-label="Complete diagnostic report">{JSON.stringify(report, null, 2)}</pre>
          <div className="pl-report-actions">
            <button type="button" disabled={busy} onClick={exportReport}>Export report</button>
            <button type="button" disabled={busy} onClick={copyReport}>Copy report</button>
            <a href={issueDraftUrl(report)} target="_blank" rel="noopener noreferrer" onClick={async event => {
              if (!globalThis.PromptLabDiagnosticsNative?.openIssue) return;
              event.preventDefault();
              try { await globalThis.PromptLabDiagnosticsNative.openIssue(report.reportId); setStatus('Issue draft requested in your default browser. You choose what to attach and submit.'); }
              catch { setStatus('Could not open the browser. Copy or export the report, then open the PromptLab GitHub issue page manually.'); }
            }}>Open GitHub issue draft</a>
          </div>
          <p>The issue opens as a draft. You submit it yourself and choose whether to attach the reviewed export.</p>
        </>}
        <p role="status">{status}</p>
      </div>
    </section>
  </div>;
}

export default function ReportProblemHost({ launcher = false }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener('promptlab:report-problem', show);
    return () => window.removeEventListener('promptlab:report-problem', show);
  }, []);
  return <>
    {launcher && !open && <button type="button" className="pl-report-launcher" onClick={() => setOpen(true)}>Report a problem</button>}
    {open && <ReportDialog onClose={() => setOpen(false)} />}
  </>;
}
